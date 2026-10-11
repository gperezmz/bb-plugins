import { describe, expect, it } from "vitest";
import { MAX_ICON_BYTES } from "../shared/project-icon";
import { checkIconUpload, detectIconMime } from "./icon-image";
import { avif, gif, ico, jpeg, png, svg, webp } from "./testing/images";

const base64 = (bytes: Uint8Array | string) => Buffer.from(bytes).toString("base64");

describe("icon images", () => {
  it.each([
    ["image/svg+xml", svg()],
    ["image/png", png()],
    ["image/x-icon", ico()],
    ["image/jpeg", jpeg()],
    ["image/gif", gif()],
    ["image/avif", avif()],
    ["image/webp", webp()],
  ] as const)("recognises %s by its bytes", (mime, bytes) => {
    expect(detectIconMime(bytes)).toBe(mime);
  });

  it("recognises an SVG behind an XML declaration, a comment, a doctype and a byte order mark", () => {
    const text = '\uFEFF<?xml version="1.0"?>\n<!-- logo -->\n<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "x.dtd">\n<svg xmlns="http://www.w3.org/2000/svg"/>';
    expect(detectIconMime(Buffer.from(text))).toBe("image/svg+xml");
  });

  it.each([
    ["html", "<html><svg></svg></html>"],
    ["plain text", "hello"],
    ["a script", "<script>alert(1)</script>"],
    ["a bmp", "BM\u0000\u0000\u0000\u0000"],
    ["a pdf", "%PDF-1.7"],
    ["empty", ""],
  ])("does not take %s for an icon", (_name, text) => {
    expect(detectIconMime(Buffer.from(text))).toBeNull();
  });
});

describe("an uploaded icon (AC25)", () => {
  it.each([svg(), png(), ico(), jpeg(), gif(), avif(), webp()])("accepts each allowed type", (bytes) => {
    const checked = checkIconUpload({ name: "logo", dataBase64: base64(bytes) });
    expect(checked).toMatchObject({ ok: true, name: "logo" });
  });

  it("takes the type from the bytes, whatever the name says", () => {
    expect(checkIconUpload({ name: "logo.svg", dataBase64: base64(png()) })).toMatchObject({ ok: true, mime: "image/png" });
  });

  it("refuses another type with a message naming the allowed ones", () => {
    const checked = checkIconUpload({ name: "doc.pdf", dataBase64: base64("%PDF-1.7 not an image") });
    expect(checked).toEqual({ ok: false, message: "Use an SVG, PNG, ICO, JPEG, GIF, AVIF or WebP image." });
  });

  it("accepts an image of exactly 1 MB and refuses one byte more", () => {
    const filler = (size: number) => Buffer.concat([png(), Buffer.alloc(size - png().length)]);
    expect(checkIconUpload({ name: "a.png", dataBase64: base64(filler(MAX_ICON_BYTES)) }).ok).toBe(true);
    expect(checkIconUpload({ name: "a.png", dataBase64: base64(filler(MAX_ICON_BYTES + 1)) })).toEqual({
      ok: false,
      message: "The image is larger than 1 MB.",
    });
  });

  it("refuses data far over the limit without decoding it", () => {
    expect(checkIconUpload({ name: "a.png", dataBase64: "A".repeat(MAX_ICON_BYTES * 2) })).toEqual({
      ok: false,
      message: "The image is larger than 1 MB.",
    });
  });

  it("refuses an empty image and data that is not base64", () => {
    expect(checkIconUpload({ name: "a.png", dataBase64: "" })).toEqual({ ok: false, message: "The image is empty." });
    expect(checkIconUpload({ name: "a.png", dataBase64: "not base64!" })).toEqual({ ok: false, message: "The image could not be read." });
  });

  it("keeps only a plain file name", () => {
    expect(checkIconUpload({ name: "C:\\Users\\me\\..\\logo\u0000.png", dataBase64: base64(png()) })).toMatchObject({ name: "logo.png" });
    expect(checkIconUpload({ name: "///", dataBase64: base64(png()) })).toMatchObject({ name: "icon" });
  });
});
