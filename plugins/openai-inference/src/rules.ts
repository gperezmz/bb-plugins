/**
 * What a card's Save, and the plugin's command, may do to the Endpoints: the
 * rules an Endpoint must meet and what changing one does to the literal key it
 * holds. Pure: it reads the saved Endpoints and answers with the Endpoint to
 * store and what the host entry's key file must do, and names no framework.
 */
import type { Endpoint, EndpointKey } from "./endpoints.js";

/** What a card holds for the key: the kind chosen and what was typed. */
export type KeyDraft =
  | { kind: "none" }
  | { kind: "variable"; reference: string }
  /** `value` is the key typed; null when nothing was typed, which keeps the key saved. */
  | { kind: "literal"; value: string | null };

/** What a card holds when Save is pressed. */
export interface Draft {
  id: string;
  url: string;
  model: string;
  key: KeyDraft;
}

export type Field = "id" | "url" | "model" | "key";
export type FieldErrors = Partial<Record<Field, string>>;

/** What the key file must do for the Endpoint to hold the key it is saved with. */
export type VaultAction = { do: "keep" } | { do: "put"; key: string } | { do: "remove" };

export type Plan =
  | { ok: true; endpoint: Endpoint; vault: VaultAction }
  /** A field is refused; `fields` names each with why. */
  | { ok: false; fields: FieldErrors }
  /** Not a field's fault: the Endpoint to edit is gone, or is already there. */
  | { ok: false; problem: string };

const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const VARIABLE = /^\$\{[A-Za-z_][A-Za-z0-9_]*\}$/;
/** bb refuses a service id outside these lengths, and these two ids. */
const ID_LENGTH = { min: 2, max: 64 };
const RESERVED_IDS = ["automatic", "off"];

const isHttpUrl = (url: string): boolean => {
  try {
    return /^https?:$/.test(new URL(url).protocol);
  } catch {
    return false;
  }
};

/** Whether `key` is a `${NAME}` reference. */
export const isVariableReference = (key: string): boolean => VARIABLE.test(key);

/** Why `id` is not an Endpoint id, or null. */
export function idError(id: string): string | null {
  if (!ID_PATTERN.test(id)) return "An id is lowercase letters, digits and dashes.";
  if (id.length < ID_LENGTH.min || id.length > ID_LENGTH.max) return `An id is ${ID_LENGTH.min} to ${ID_LENGTH.max} characters.`;
  if (RESERVED_IDS.includes(id)) return `"${id}" is reserved by bb.`;
  return null;
}

/** Why `url` is not an Endpoint url, or null. */
export function urlError(url: string): string | null {
  return url.includes("${") || isHttpUrl(url) ? null : "A URL is an http:// or https:// URL, or references a variable as ${NAME}.";
}

/**
 * Decides what saving `draft` does.
 *
 * A literal key typed is kept. A literal key left empty keeps the saved key,
 * unless the URL changed: a key only reaches the server it was typed for, so a
 * changed URL clears it and the Endpoint is left Literal and not set. Saving
 * None or Variable over a literal key deletes it.
 *
 * Args:
 *   draft: What the card or the command holds.
 *   saved: The Endpoints as saved.
 *   create: Whether the draft is a new Endpoint, which needs an id no Endpoint
 *     has; otherwise it edits the Endpoint with its id.
 */
export function planSave(draft: Draft, saved: readonly Endpoint[], create: boolean): Plan {
  const id = draft.id.trim();
  const existing = saved.find((e) => e.id === id);
  const fields: FieldErrors = {};

  if (create) {
    const why = idError(id);
    if (why !== null) fields.id = why;
    else if (existing !== undefined) fields.id = `An Endpoint "${id}" already exists.`;
  } else if (existing === undefined) {
    return { ok: false, problem: `There is no Endpoint "${id}" to change.` };
  }

  const url = draft.url.trim();
  const urlWhy = url === "" ? "A URL is required." : urlError(url);
  if (urlWhy !== null) fields.url = urlWhy;

  const model = draft.model.trim();
  if (model === "") fields.model = "A model is a model name the server serves.";

  const key = draft.key;
  const urlChanged = existing !== undefined && existing.url !== url;
  const held = existing?.key.kind === "literal" && existing.key.set;
  let stored: EndpointKey = { kind: "none" };
  let vault: VaultAction = held ? { do: "remove" } : { do: "keep" };
  if (key.kind === "variable") {
    const reference = key.reference.trim();
    if (!isVariableReference(reference)) fields.key = "A variable key is a reference to bb's environment, as ${NAME}.";
    stored = { kind: "variable", reference };
  } else if (key.kind === "literal") {
    const typed = key.value?.trim() ?? "";
    if (typed !== "") {
      stored = { kind: "literal", set: true };
      vault = { do: "put", key: typed };
    } else if (held) {
      stored = { kind: "literal", set: !urlChanged };
      vault = urlChanged ? { do: "remove" } : { do: "keep" };
    } else {
      fields.key = "Type the key, or choose None or Variable.";
      stored = { kind: "literal", set: false };
    }
  }

  if (Object.keys(fields).length > 0) return { ok: false, fields };
  return { ok: true, endpoint: { id, url, model, key: stored }, vault };
}
