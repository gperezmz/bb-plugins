import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ManifestRead } from "../domain/model";

// The parser is the domain's; here it only shows what text it was given.
const parseManifest = vi.hoisted(() => vi.fn<(text: string) => ManifestRead>());
vi.mock("../domain/manifest", () => ({ parseManifest }));

import { FileManifests, MAX_MANIFEST_BYTES } from "./manifest-file";

const MANIFEST: ManifestRead = { status: "ok", manifest: { repo: "github.com/org/repo", inbox: [], inFlight: [], blocked: [], landed: [], unreadable: [] } };

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "manifest-file-"));
});
afterAll(async () => {
  await chmod(join(dir, "locked.md"), 0o600).catch(() => undefined);
  await rm(dir, { recursive: true, force: true });
});
beforeEach(() => {
  parseManifest.mockReset();
  parseManifest.mockReturnValue(MANIFEST);
});

describe("FileManifests.read", () => {
  it("hands the file's text to the domain's parser and returns what it gives", async () => {
    const path = join(dir, "manifest.md");
    await writeFile(path, "# Fleet: github.com/org/repo\n\nInbox is empty.\n");
    expect(await new FileManifests().read(path)).toBe(MANIFEST);
    expect(parseManifest).toHaveBeenCalledWith("# Fleet: github.com/org/repo\n\nInbox is empty.\n");
  });

  it("passes the parser's own unreadable answer on", async () => {
    parseManifest.mockReturnValue({ status: "unreadable", reason: "the first line is not `# Fleet: <host>/<path>`" });
    const path = join(dir, "headless.md");
    await writeFile(path, "no heading");
    expect(await new FileManifests().read(path)).toEqual({ status: "unreadable", reason: "the first line is not `# Fleet: <host>/<path>`" });
  });

  it("is missing for a file not written yet, and for a directory that does not exist yet", async () => {
    expect(await new FileManifests().read(join(dir, "nope.md"))).toEqual({ status: "missing" });
    expect(await new FileManifests().read(join(dir, "fleet", "manifest.md"))).toEqual({ status: "missing" });
    expect(parseManifest).not.toHaveBeenCalled();
  });

  it("is unreadable for a relative path, without looking at the disk", async () => {
    const result = await new FileManifests().read("fleet/manifest.md");
    expect(result).toMatchObject({ status: "unreadable" });
    expect(parseManifest).not.toHaveBeenCalled();
  });

  it("is unreadable for a directory", async () => {
    const path = join(dir, "adir");
    await mkdir(path);
    expect(await new FileManifests().read(path)).toMatchObject({ status: "unreadable" });
  });

  it("is unreadable for a file over 1 MiB, and never parses it", async () => {
    const path = join(dir, "big.md");
    await writeFile(path, "x".repeat(MAX_MANIFEST_BYTES + 1));
    expect(await new FileManifests().read(path)).toEqual({ status: "unreadable", reason: "the manifest is over 1 MiB" });
    expect(parseManifest).not.toHaveBeenCalled();
  });

  it("reads a file of exactly 1 MiB", async () => {
    const path = join(dir, "limit.md");
    await writeFile(path, "x".repeat(MAX_MANIFEST_BYTES));
    expect(await new FileManifests().read(path)).toBe(MANIFEST);
  });

  it("is unreadable for bytes that are not UTF-8", async () => {
    const path = join(dir, "binary.md");
    await writeFile(path, Buffer.from([0xff, 0xfe, 0x00, 0x41]));
    expect(await new FileManifests().read(path)).toEqual({ status: "unreadable", reason: "the manifest is not valid UTF-8" });
    expect(parseManifest).not.toHaveBeenCalled();
  });

  it.skipIf(process.getuid?.() === 0)("is unreadable for a file it may not read, naming the error code but not the content", async () => {
    const path = join(dir, "locked.md");
    await writeFile(path, "SECRET CONTENT");
    await chmod(path, 0o000);
    const result = await new FileManifests().read(path);
    expect(result).toEqual({ status: "unreadable", reason: "the manifest cannot be read (EACCES)" });
  });

  it("is unreadable when the parser throws, without quoting the file", async () => {
    parseManifest.mockImplementation(() => {
      throw new Error("bad row: SECRET CONTENT");
    });
    const path = join(dir, "throws.md");
    await writeFile(path, "SECRET CONTENT");
    const result = await new FileManifests().read(path);
    expect(result).toEqual({ status: "unreadable", reason: "the manifest cannot be parsed" });
  });

  it("follows a symlink to a manifest, as the manager may keep it elsewhere", async () => {
    const target = join(dir, "real.md");
    await writeFile(target, "# Fleet: github.com/org/repo\n");
    const link = join(dir, "link.md");
    await symlink(target, link);
    expect(await new FileManifests().read(link)).toBe(MANIFEST);
  });
});
