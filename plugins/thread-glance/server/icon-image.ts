// Recognising an icon image from its bytes and checking an upload. The type
// comes from the bytes, never from a name or a declared type, so an icon
// served from here is always one of the allowed image types.
import { createHash } from "node:crypto";
import { ICON_TYPES_LABEL, MAX_ICON_BYTES } from "../shared/project-icon";

export type IconMime =
  | "image/svg+xml"
  | "image/png"
  | "image/x-icon"
  | "image/jpeg"
  | "image/gif"
  | "image/avif"
  | "image/webp";

const startsWith = (bytes: Uint8Array, signature: readonly number[], offset = 0) =>
  bytes.length >= offset + signature.length && signature.every((byte, index) => bytes[offset + index] === byte);

const ascii = (bytes: Uint8Array, start: number, end: number) => Buffer.from(bytes.subarray(start, end)).toString("latin1");

/** SVG text begins, past a byte order mark, whitespace, an XML declaration, comments and a doctype, with `<svg`. */
function isSvg(bytes: Uint8Array): boolean {
  let text = Buffer.from(bytes.subarray(0, 8192)).toString("utf8").replace(/^﻿/, "");
  for (;;) {
    const next = text
      .replace(/^\s+/, "")
      .replace(/^<\?xml[^>]*\?>/i, "")
      .replace(/^<!--[\s\S]*?-->/, "")
      .replace(/^<!DOCTYPE[^[>]*(\[[\s\S]*?\])?\s*>/i, "");
    if (next === text) break;
    text = next;
  }
  return /^<svg[\s>/]/i.test(text);
}

/** The icon type of `bytes`, or null for anything else. */
export function detectIconMime(bytes: Uint8Array): IconMime | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  const head = ascii(bytes, 0, 6);
  if (head === "GIF87a" || head === "GIF89a") return "image/gif";
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") return "image/webp";
  if (ascii(bytes, 4, 8) === "ftyp") {
    const boxEnd = Math.min(bytes.length, new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0));
    const brands = ascii(bytes, 8, Math.max(8, boxEnd));
    if (brands.includes("avif") || brands.includes("avis")) return "image/avif";
  }
  if (startsWith(bytes, [0, 0, 1, 0]) && bytes.length >= 6 && bytes[4]! > 0) return "image/x-icon";
  if (isSvg(bytes)) return "image/svg+xml";
  return null;
}

/** The strong ETag of an image's bytes. */
export function entityTag(bytes: Uint8Array): string {
  return `"${createHash("sha256").update(bytes).digest("hex").slice(0, 32)}"`;
}

export type IconUpload =
  | { ok: true; name: string; mime: IconMime; data: Buffer }
  | { ok: false; message: string };

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
const MAX_NAME_LENGTH = 120;

/** A file name safe to keep: no path, no control characters, not empty. */
function cleanName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, MAX_NAME_LENGTH);
  return cleaned === "" ? "icon" : cleaned;
}

/**
 * Checks an uploaded icon. The image must be one of the allowed types by its
 * bytes and at most 1 MB; the declared type is not trusted.
 */
export function checkIconUpload(input: { name: string; dataBase64: string }): IconUpload {
  const tooLarge = `The image is larger than ${MAX_ICON_BYTES / (1024 * 1024)} MB.`;
  // Refuse before decoding what could not fit.
  if (input.dataBase64.length > Math.ceil((MAX_ICON_BYTES * 4) / 3) + 4) return { ok: false, message: tooLarge };
  if (!BASE64.test(input.dataBase64)) return { ok: false, message: "The image could not be read." };
  const data = Buffer.from(input.dataBase64, "base64");
  if (data.length === 0) return { ok: false, message: "The image is empty." };
  if (data.length > MAX_ICON_BYTES) return { ok: false, message: tooLarge };
  const mime = detectIconMime(data);
  if (mime === null) return { ok: false, message: `Use an ${ICON_TYPES_LABEL} image.` };
  return { ok: true, name: cleanName(input.name), mime, data };
}
