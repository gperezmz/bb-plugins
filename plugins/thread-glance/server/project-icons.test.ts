import { describe, expect, it } from "vitest";
import { MAX_ICON_BYTES, projectIconUrl } from "../shared/project-icon";
import { createAppearanceStore } from "./appearance-store";
import type { ProjectFiles } from "./favicon";
import { createProjectIcons, createSdkProjectFiles } from "./project-icons";
import { memoryDatabase } from "./testing/fakes";
import { gif, png, svg } from "./testing/images";

function setup(files: Record<string, Buffer | Error> = {}) {
  const appearance = createAppearanceStore(memoryDatabase());
  let now = 1_700_000_000_000;
  const reads: string[] = [];
  let held = files;
  const icons = createProjectIcons({
    appearance,
    files: (): ProjectFiles => ({
      async read(path) {
        reads.push(path);
        const file = held[path];
        if (file instanceof Error) throw file;
        return file ?? null;
      },
    }),
    now: () => now,
  });
  return {
    icons,
    appearance,
    reads,
    advance: (ms: number) => (now += ms),
    setFiles: (next: Record<string, Buffer | Error>) => (held = next),
    get: (project: string | null, headers: HeadersInit = {}) =>
      icons.serve(new Request(`http://bb.local/api/v1/plugins/thread-glance/http/project-icon${project === null ? "" : `?project=${project}`}`, { headers })),
  };
}

const upload = (icons: ReturnType<typeof setup>["icons"], projectId: string, bytes: Buffer, name = "logo") =>
  icons.upload({ projectId, name, dataBase64: bytes.toString("base64") });

describe("the project icon route (AC25)", () => {
  it("serves an uploaded icon with private, revalidated, sandboxed, nosniff headers", async () => {
    const { icons, get } = setup();
    upload(icons, "p1", png());
    const response = await get("p1");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toBe("private, no-cache");
    expect(response.headers.get("content-security-policy")).toBe("sandbox");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("etag")).toMatch(/^"[0-9a-f]{32}"$/);
    expect(new Date(response.headers.get("last-modified")!).getTime()).toBe(Math.floor(1_700_000_000_000 / 1000) * 1000);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(png());
  });

  it("lets an uploaded icon win over a favicon in the project, without reading the project's files", async () => {
    const { icons, get, reads } = setup({ "favicon.svg": svg() });
    upload(icons, "p1", gif());
    expect((await get("p1")).headers.get("content-type")).toBe("image/gif");
    expect(reads).toEqual([]);
  });

  it("serves the project's favicon when nothing is uploaded, with the same headers", async () => {
    const { get } = setup({ "public/favicon.png": png() });
    const response = await get("p1");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toBe("private, no-cache");
    expect(response.headers.get("content-security-policy")).toBe("sandbox");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("etag")).not.toBeNull();
    expect(response.headers.get("last-modified")).not.toBeNull();
  });

  it("answers 404 when the project has no icon, so the browser draws the monogram, and does not cache the answer", async () => {
    const { get } = setup();
    const response = await get("p1");
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("answers 400 without a project", async () => {
    expect((await setup().get(null)).status).toBe(400);
  });

  it("answers 304 to a matching ETag, a weak one, or an If-Modified-Since at or after the last change", async () => {
    const { icons, get } = setup();
    upload(icons, "p1", png());
    const first = await get("p1");
    const etag = first.headers.get("etag")!;
    const lastModified = first.headers.get("last-modified")!;
    const matching: Record<string, string>[] = [
      { "if-none-match": etag },
      { "if-none-match": `W/${etag}` },
      { "if-none-match": `"x", ${etag}` },
      { "if-modified-since": lastModified },
    ];
    for (const headers of matching) {
      const response = await get("p1", headers);
      expect(response.status).toBe(304);
      expect(response.headers.get("etag")).toBe(etag);
      expect(response.headers.get("cache-control")).toBe("private, no-cache");
      expect(response.headers.get("content-security-policy")).toBe("sandbox");
    }
    expect((await get("p1", { "if-none-match": '"other"' })).status).toBe(200);
  });

  it("gives a replaced upload a new ETag", async () => {
    const { icons, get } = setup();
    upload(icons, "p1", png());
    const before = (await get("p1")).headers.get("etag");
    upload(icons, "p1", gif());
    expect((await get("p1", { "if-none-match": before! })).status).toBe(200);
  });

  it("reads the project's files once for requests within the minute, and again after", async () => {
    const { get, reads, advance } = setup({ "favicon.png": png() });
    await get("p1");
    const afterFirst = reads.length;
    await get("p1");
    await get("p1");
    expect(reads).toHaveLength(afterFirst);
    advance(61_000);
    await get("p1");
    expect(reads.length).toBeGreaterThan(afterFirst);
  });

  it("shares one read among requests that arrive together", async () => {
    const { get, reads } = setup({ "favicon.png": png() });
    await Promise.all([get("p1"), get("p1"), get("p1")]);
    expect(reads.filter((path) => path === "favicon.svg")).toHaveLength(1);
  });

  it("shows a favicon that is added within seconds of a miss, but not before the miss expires", async () => {
    const { get, setFiles, advance } = setup();
    expect((await get("p1")).status).toBe(404);
    setFiles({ "favicon.png": png() });
    expect((await get("p1")).status).toBe(404);
    advance(16_000);
    expect((await get("p1")).status).toBe(200);
  });

  it("answers 503 and remembers nothing when bb could not read the project's files", async () => {
    const { get, setFiles } = setup({ "favicon.svg": new Error("machine offline") });
    const failed = await get("p1");
    expect(failed.status).toBe(503);
    expect(failed.headers.get("cache-control")).toBe("no-store");
    setFiles({ "favicon.png": png() });
    expect((await get("p1")).status).toBe(200);
  });

  it("keeps Last-Modified while the favicon is unchanged and moves it when it changes", async () => {
    const { get, setFiles, advance } = setup({ "favicon.png": png() });
    const first = (await get("p1")).headers.get("last-modified");
    advance(120_000);
    expect((await get("p1")).headers.get("last-modified")).toBe(first);
    setFiles({ "favicon.png": Buffer.concat([png(), Buffer.from("x")]) });
    advance(120_000);
    expect((await get("p1")).headers.get("last-modified")).not.toBe(first);
  });
});

describe("uploading and clearing", () => {
  it("refuses another type and an image over 1 MB with a message, storing nothing", () => {
    const { icons, appearance } = setup();
    expect(() => upload(icons, "p1", Buffer.from("%PDF-1.7"))).toThrow("Use an SVG, PNG, ICO, JPEG, GIF, AVIF or WebP image.");
    expect(() => upload(icons, "p1", Buffer.concat([png(), Buffer.alloc(MAX_ICON_BYTES)]))).toThrow("The image is larger than 1 MB.");
    expect(appearance.read().icons).toEqual({});
  });

  it("records the upload for sync and clears it back to the favicon", async () => {
    const { icons, appearance, get } = setup({ "favicon.png": png() });
    upload(icons, "p1", gif(), "mark.gif");
    expect(appearance.read().icons.p1).toEqual({ name: "mark.gif", mime: "image/gif", updatedAt: 1_700_000_000_000 });
    expect(icons.clear("p1")).toBe(true);
    expect(icons.clear("p1")).toBe(false);
    expect((await get("p1")).headers.get("content-type")).toBe("image/png");
  });

  it("forgets a removed project's colour and icon, and what was found in its files", async () => {
    const { icons, appearance, get, setFiles } = setup({ "favicon.png": png() });
    appearance.setColour("p1", "#aabbcc");
    upload(icons, "p1", gif());
    await get("p1");
    expect(icons.forget("p1")).toBe(true);
    expect(appearance.read()).toEqual({ colours: {}, icons: {} });
    expect(appearance.readIcon("p1")).toBeNull();
    setFiles({});
    expect((await get("p1")).status).toBe(404);
    expect(icons.forget("p1")).toBe(false);
  });

  it("forgets a colour with no icon too", () => {
    const { icons, appearance } = setup();
    appearance.setColour("p1", "#aabbcc");
    expect(icons.forget("p1")).toBe(true);
    expect(appearance.read().colours).toEqual({});
  });
});

describe("the icon URL", () => {
  it("is a same-origin path under bb's plugin route, versioned by the upload", () => {
    expect(projectIconUrl("p 1")).toBe("/api/v1/plugins/thread-glance/http/project-icon?project=p+1");
    expect(projectIconUrl("p1", 42)).toBe("/api/v1/plugins/thread-glance/http/project-icon?project=p1&v=42");
  });
});

describe("a project's files through bb", () => {
  const sdk = (fileContent: (args: { projectId: string; path: string }) => Promise<unknown>, sources = [{}]) =>
    ({ sdk: { projects: { get: async () => ({ sources }), fileContent } } }) as never;

  it("decodes base64 and text content", async () => {
    const files = createSdkProjectFiles(
      sdk(async ({ path }) =>
        path === "a.png"
          ? { content: png().toString("base64"), contentEncoding: "base64", mimeType: "image/png", sizeBytes: png().length }
          : { content: "<svg/>", contentEncoding: "utf8", mimeType: "image/svg+xml", sizeBytes: 6 },
      ),
      "p1",
    );
    expect(await files.read("a.png")).toEqual(png());
    expect((await files.read("b.svg"))?.toString()).toBe("<svg/>");
  });

  it("reads a file over 1 MB as absent", async () => {
    const files = createSdkProjectFiles(sdk(async () => ({ content: "", contentEncoding: "utf8", mimeType: "x", sizeBytes: MAX_ICON_BYTES + 1 })), "p1");
    expect(await files.read("a.png")).toBeNull();
  });

  it("reads what bb refuses for being missing, outside the project's path or not a regular file as absent", async () => {
    for (const refusal of [
      Object.assign(new Error("not there"), { status: 404 }),
      Object.assign(new Error('Path "../x" escapes read root'), { code: "invalid_path" }),
      new Error("Path is not a regular file"),
      new Error("ENOENT: no such file"),
    ]) {
      const files = createSdkProjectFiles(sdk(async () => Promise.reject(refusal)), "p1");
      expect(await files.read("a.png")).toBeNull();
    }
  });

  it("lets any other failure through, so it is not taken for a miss", async () => {
    const files = createSdkProjectFiles(sdk(async () => Promise.reject(new Error("machine offline"))), "p1");
    await expect(files.read("a.png")).rejects.toThrow("machine offline");
  });

  it("reads nothing for a project without a path", async () => {
    let asked = false;
    const files = createSdkProjectFiles(sdk(async () => ((asked = true), {}), []), "p1");
    expect(await files.read("a.png")).toBeNull();
    expect(asked).toBe(false);
  });
});
