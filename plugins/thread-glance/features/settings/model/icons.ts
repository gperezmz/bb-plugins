// Rules of the Customize a project controls that need no rendering.
import { MAX_ICON_BYTES } from "@/shared/project-icon";
import { projectColourSchema, type Appearance } from "@/shared/signals";

/** Says where a project's icon comes from: its upload, else what the server finds in the project. */
export function iconSourceLine(upload: Appearance["icons"][string] | undefined): string {
  return upload === undefined ? "Found automatically from the project's favicon." : `Uploaded: ${upload.name}`;
}

/**
 * Why a file is not sent, or null. Only the size is checked here (so a huge
 * file is not read into memory); the server reads the type from the bytes and
 * its refusal is shown as it words it.
 */
export function iconSizeError(bytes: number): string | null {
  return bytes > MAX_ICON_BYTES ? "The image is larger than 1 MB." : null;
}

/** Why a typed colour cannot be saved, or null. A colour is `#rrggbb`; capitals are lowered first. */
export function colourError(typed: string): string | null {
  const parsed = projectColourSchema.safeParse(typed.trim().toLowerCase());
  return parsed.success ? null : (parsed.error.issues[0]?.message ?? "Use a colour like #1a2b3c.");
}
