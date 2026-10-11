// Project icons: the uploads, and the HTTP route that serves a project's icon.
// An uploaded image wins; otherwise the project's own favicon is looked for in
// its files, and with neither the route answers 404 so the browser draws the
// monogram. The response is private and revalidated, sandboxed and nosniff.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { MAX_ICON_BYTES } from "../shared/project-icon";
import type { AppearanceStore } from "./appearance-store";
import { findProjectIcon, type FoundIcon, type ProjectFiles } from "./favicon";
import { checkIconUpload, entityTag, type IconMime } from "./icon-image";

/** How long a found favicon is trusted before the project's files are read again. */
const FOUND_TTL_MS = 60_000;
/** How long a project without a favicon is trusted; short, so a favicon that is added shows soon. */
const MISSING_TTL_MS = 15_000;

/** The headers every answer carries. `Cache-Control: private, no-cache` lets the browser keep the image but ask before each use. */
const SAFE_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "sandbox",
};

export interface ProjectIcons {
  /** Stores an uploaded icon.
   * @throws Error with a message to show when the image is refused. */
  upload(input: { projectId: string; name: string; dataBase64: string }): void;
  /** Removes an uploaded icon. Returns whether there was one. */
  clear(projectId: string): boolean;
  /** Forgets everything held for the project: its upload and what was found in its files. */
  forget(projectId: string): boolean;
  /** Answers a GET for `?project=<id>`. */
  serve(request: Request): Promise<Response>;
}

export interface ProjectIconsDeps {
  appearance: AppearanceStore;
  /** The files of a project. */
  files(projectId: string): ProjectFiles;
  now?: () => number;
  warn?: (message: string) => void;
}

interface Resolved {
  data: Buffer;
  mime: IconMime;
  etag: string;
  /** When this content was uploaded or first seen, in epoch ms. */
  lastModified: number;
}

type Resolution = { kind: "found"; icon: Resolved } | { kind: "missing" } | { kind: "unreadable" };

const withHeaders = (status: number, headers: Record<string, string>, body: BodyInit | null = null) =>
  new Response(body, { status, headers: { ...SAFE_HEADERS, ...headers } });

/** Whether the request's validators say the browser's copy is current. */
function isFresh(request: Request, etag: string, lastModified: number): boolean {
  const ifNoneMatch = request.headers.get("if-none-match");
  if (ifNoneMatch !== null) {
    return ifNoneMatch
      .split(",")
      .map((tag) => tag.trim().replace(/^W\//, ""))
      .some((tag) => tag === "*" || tag === etag);
  }
  const since = Date.parse(request.headers.get("if-modified-since") ?? "");
  return !Number.isNaN(since) && Math.floor(lastModified / 1000) * 1000 <= since;
}

export function createProjectIcons(deps: ProjectIconsDeps): ProjectIcons {
  const { appearance } = deps;
  const now = deps.now ?? Date.now;
  const warn = deps.warn ?? (() => undefined);
  /** What the project's files held when last read, by project id. */
  const found = new Map<string, { expiresAt: number; resolution: Resolution }>();
  const pending = new Map<string, Promise<Resolution>>();
  /** When each project's favicon content was first seen, for Last-Modified. */
  const seen = new Map<string, { etag: string; at: number }>();
  /** Bumped when a project's files must be read again, so a read already under way does not store its result. */
  const generations = new Map<string, number>();

  const invalidate = (projectId: string) => {
    generations.set(projectId, (generations.get(projectId) ?? 0) + 1);
    found.delete(projectId);
    pending.delete(projectId);
    seen.delete(projectId);
  };

  async function readFiles(projectId: string): Promise<Resolution> {
    let result: Awaited<ReturnType<typeof findProjectIcon>>;
    try {
      result = await findProjectIcon(deps.files(projectId));
    } catch (error) {
      warn(`could not read the files of ${projectId}: ${error instanceof Error ? error.message : String(error)}`);
      return { kind: "unreadable" };
    }
    if (result.icon === null) return result.unreadable ? { kind: "unreadable" } : { kind: "missing" };
    return { kind: "found", icon: favicon(projectId, result.icon) };
  }

  function favicon(projectId: string, icon: FoundIcon): Resolved {
    const etag = entityTag(icon.data);
    const previous = seen.get(projectId);
    const at = previous?.etag === etag ? previous.at : now();
    seen.set(projectId, { etag, at });
    return { data: icon.data, mime: icon.mime, etag, lastModified: at };
  }

  function resolveFavicon(projectId: string): Promise<Resolution> {
    const cached = found.get(projectId);
    if (cached !== undefined && cached.expiresAt > now()) return Promise.resolve(cached.resolution);
    const inFlight = pending.get(projectId);
    if (inFlight !== undefined) return inFlight;
    const generation = generations.get(projectId) ?? 0;
    const read = readFiles(projectId).then((resolution) => {
      if (pending.get(projectId) === read) pending.delete(projectId);
      if ((generations.get(projectId) ?? 0) === generation && resolution.kind !== "unreadable") {
        found.set(projectId, { expiresAt: now() + (resolution.kind === "found" ? FOUND_TTL_MS : MISSING_TTL_MS), resolution });
      }
      return resolution;
    });
    pending.set(projectId, read);
    return read;
  }

  async function resolve(projectId: string): Promise<Resolution> {
    const upload = appearance.readIcon(projectId);
    if (upload !== null) {
      return {
        kind: "found",
        icon: { data: upload.data, mime: upload.mime as IconMime, etag: entityTag(upload.data), lastModified: upload.updatedAt },
      };
    }
    return resolveFavicon(projectId);
  }

  return {
    upload({ projectId, name, dataBase64 }) {
      const checked = checkIconUpload({ name, dataBase64 });
      if (!checked.ok) throw new Error(checked.message);
      invalidate(projectId);
      appearance.setIcon(projectId, { name: checked.name, mime: checked.mime, data: checked.data }, now());
    },
    clear(projectId) {
      invalidate(projectId);
      return appearance.setIcon(projectId, null, now());
    },
    forget(projectId) {
      invalidate(projectId);
      return appearance.forget(projectId);
    },

    async serve(request) {
      const projectId = new URL(request.url).searchParams.get("project")?.trim();
      if (!projectId) return withHeaders(400, { "Cache-Control": "no-store" }, "Missing project");
      const resolution = await resolve(projectId);
      if (resolution.kind === "unreadable") return withHeaders(503, { "Cache-Control": "no-store" });
      if (resolution.kind === "missing") return withHeaders(404, { "Cache-Control": "no-store" });
      const { icon } = resolution;
      const headers = {
        "Cache-Control": "private, no-cache",
        ETag: icon.etag,
        "Last-Modified": new Date(icon.lastModified).toUTCString(),
      };
      if (isFresh(request, icon.etag, icon.lastModified)) return withHeaders(304, headers);
      return withHeaders(200, { ...headers, "Content-Type": icon.mime, "Content-Length": String(icon.data.length) }, new Uint8Array(icon.data));
    },
  };
}

/** Whether bb's refusal means the file is not there to read, as opposed to bb being unable to answer. */
function isAbsence(error: unknown): boolean {
  if (error === null || typeof error !== "object") return false;
  const { status, code, message } = error as { status?: unknown; code?: unknown; message?: unknown };
  return (
    status === 404 ||
    status === 400 ||
    status === 413 ||
    code === "ENOENT" ||
    code === "invalid_path" ||
    code === "file_too_large" ||
    (typeof message === "string" &&
      /ENOENT|not found|does not exist|invalid_path|escapes read root|not a regular file|is a directory|file_too_large/i.test(message))
  );
}

/**
 * A project's files through bb's project file route, which reads only a
 * regular file whose resolved path, symlinks followed, lies inside the
 * project's path on its machine.
 */
export function createSdkProjectFiles(bb: Pick<BbPluginApi, "sdk">, projectId: string): ProjectFiles {
  let hasPath: Promise<boolean> | null = null;
  return {
    async read(path) {
      hasPath ??= bb.sdk.projects.get({ projectId }).then((project) => project.sources.length > 0);
      if (!(await hasPath)) return null;
      try {
        const file = await bb.sdk.projects.fileContent({ projectId, path });
        if (file.sizeBytes > MAX_ICON_BYTES) return null;
        return Buffer.from(file.content, file.contentEncoding === "base64" ? "base64" : "utf8");
      } catch (error) {
        if (isAbsence(error)) return null;
        throw error;
      }
    },
  };
}
