import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { lstat, readFile, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, isAbsolute } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MAX_ICON_BYTES } from "../shared/project-icon";
import { extractIconHref, findProjectIcon, pathsForHref, plainIconPath, type ProjectFiles } from "./favicon";
import { gif, ico, png, svg } from "./testing/images";

/** Project files held in memory by relative path; reads are logged. */
function memoryFiles(files: Record<string, Buffer | string | Error>) {
  const reads: string[] = [];
  const port: ProjectFiles = {
    async read(path) {
      reads.push(path);
      const file = files[path];
      if (file instanceof Error) throw file;
      return file === undefined ? null : Buffer.from(file);
    },
  };
  return { port, reads };
}

describe("finding a project's icon (AC25)", () => {
  it("takes the first usual favicon file, in the order of the list", async () => {
    const { port } = memoryFiles({ "public/favicon.png": png(), "favicon.ico": ico(), "assets/icon.svg": svg() });
    expect((await findProjectIcon(port)).icon).toMatchObject({ path: "favicon.ico", mime: "image/x-icon" });
  });

  it("prefers a usual favicon file over the icon link of the index page", async () => {
    const { port } = memoryFiles({ "index.html": '<link rel="icon" href="/logo.svg">', "logo.svg": svg(), "icon.png": png() });
    expect((await findProjectIcon(port)).icon?.path).toBe("icon.png");
  });

  it("falls back to the icon link in the index page, under public/ first", async () => {
    const { port } = memoryFiles({ "index.html": '<link rel="shortcut icon" href="/brand/mark.gif?v=2">', "public/brand/mark.gif": gif(), "brand/mark.gif": png() });
    expect((await findProjectIcon(port)).icon).toMatchObject({ path: "public/brand/mark.gif", mime: "image/gif" });
  });

  it("falls back to the icon link in a root route file", async () => {
    const route = `export const Route = createRootRoute({ head: () => ({ links: [{ rel: "icon", href: "/mark.svg" }] }) });`;
    const { port } = memoryFiles({ "src/routes/__root.tsx": route, "public/mark.svg": svg() });
    expect((await findProjectIcon(port)).icon?.path).toBe("public/mark.svg");
  });

  it("finds nothing in a project without an icon", async () => {
    expect(await findProjectIcon(memoryFiles({ "README.md": "hi" }).port)).toEqual({ icon: null, unreadable: false });
  });

  it("skips a file over 1 MB and a file that is not an image", async () => {
    const big = Buffer.concat([png(), Buffer.alloc(MAX_ICON_BYTES)]);
    const { port } = memoryFiles({ "favicon.svg": big, "favicon.ico": "<html>not an icon</html>", "favicon.png": png() });
    expect((await findProjectIcon(port)).icon?.path).toBe("favicon.png");
  });

  it("does not follow a link to a URL, a path above the project or an absolute path", async () => {
    for (const href of ["https://example.com/i.svg", "//cdn.example.com/i.svg", "/../secret.png", "../secret.png", "/etc/passwd.png", "C:/x.png", "data:image/png;base64,AAAA"]) {
      const { port, reads } = memoryFiles({ "index.html": `<link rel="icon" href="${href}">` });
      expect((await findProjectIcon(port)).icon).toBeNull();
      expect(reads.filter((path) => path.includes("..") || path.startsWith("/") || path.includes(":"))).toEqual([]);
    }
  });

  it("says when a source could not be read, and still returns an icon found elsewhere", async () => {
    const { port } = memoryFiles({ "favicon.svg": new Error("machine offline"), "icon.png": png() });
    expect(await findProjectIcon(port)).toMatchObject({ icon: { path: "icon.png" }, unreadable: true });
    expect(await findProjectIcon(memoryFiles({ "favicon.svg": new Error("machine offline") }).port)).toEqual({ icon: null, unreadable: true });
  });
});

describe("icon link parsing", () => {
  it("reads HTML and JSX links in any attribute order and either quote", () => {
    expect(extractIconHref(`<link href='/a.svg' rel='icon'>`)).toBe("/a.svg");
    expect(extractIconHref(`<link rel="stylesheet" href="/s.css"><link rel="icon" type="image/png" href="/b.png" />`)).toBe("/b.png");
    expect(extractIconHref(`<link rel="apple-touch-icon" href="/c.png">`)).toBeNull();
  });

  it("reads route objects", () => {
    expect(extractIconHref(`links: [{ rel: 'stylesheet', href: '/s.css' }, { rel: 'icon', href: '/d.svg' }]`)).toBe("/d.svg");
  });

  it("maps an href to project paths only for plain relative images", () => {
    expect(pathsForHref("/img/a.svg?x=1#y")).toEqual(["public/img/a.svg", "img/a.svg"]);
    expect(pathsForHref("./a.png")).toEqual(["public/a.png", "a.png"]);
    expect(pathsForHref("/a%2Fb.png")).toEqual(["public/a/b.png", "a/b.png"]);
    expect(pathsForHref("/a.txt")).toEqual([]);
    expect(pathsForHref("/%E0%A4%A.png")).toEqual([]);
    expect(plainIconPath("a//b.png")).toBeNull();
    expect(plainIconPath("a\\..\\b.png")).toBeNull();
  });
});

describe("containment in the project's path (AC25)", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  /**
   * The project file route of bb, in miniature: a regular file whose resolved
   * path, symlinks followed, lies inside the project's path. bb's host daemon
   * enforces this on the machine; this stands in for it so the lookup is seen
   * to carry on past a refused file.
   */
  function rootedFiles(root: string): ProjectFiles {
    return {
      async read(path) {
        try {
          const real = await realpath(join(root, path));
          const inside = relative(await realpath(root), real);
          if (inside.startsWith("..") || isAbsolute(inside)) return null;
          if (!(await lstat(real)).isFile()) return null;
          return await readFile(real);
        } catch {
          return null;
        }
      },
    };
  }

  it("skips a favicon that is a symlink out of the project and takes the next candidate", async () => {
    const outer = mkdtempSync(join(tmpdir(), "glance-icon-"));
    dirs.push(outer);
    const project = join(outer, "project");
    mkdirSync(join(project, "public"), { recursive: true });
    writeFileSync(join(outer, "secret.svg"), svg("<!-- outside -->"));
    symlinkSync(join(outer, "secret.svg"), join(project, "favicon.svg"));
    writeFileSync(join(project, "public", "favicon.png"), png());
    expect((await findProjectIcon(rootedFiles(project))).icon?.path).toBe("public/favicon.png");
  });

  it("takes a symlink that stays inside the project", async () => {
    const outer = mkdtempSync(join(tmpdir(), "glance-icon-"));
    dirs.push(outer);
    mkdirSync(join(outer, "assets"));
    writeFileSync(join(outer, "assets", "real.svg"), svg());
    symlinkSync(join(outer, "assets", "real.svg"), join(outer, "favicon.svg"));
    expect((await findProjectIcon(rootedFiles(outer))).icon?.path).toBe("favicon.svg");
  });

  it("skips a directory named like an icon", async () => {
    const outer = mkdtempSync(join(tmpdir(), "glance-icon-"));
    dirs.push(outer);
    mkdirSync(join(dirname(join(outer, "favicon.ico")), "favicon.ico"));
    writeFileSync(join(outer, "icon.png"), png());
    expect((await findProjectIcon(rootedFiles(outer))).icon?.path).toBe("icon.png");
  });
});
