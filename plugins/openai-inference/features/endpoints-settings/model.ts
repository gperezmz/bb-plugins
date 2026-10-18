// What the Endpoints section decides, as plain functions over plain values: what a card holds, when it counts as edited, what Save sends, and the words the section says.
import type { Endpoint } from "@/src/endpoints";
import { clearsLiteralKey, holdsLiteralKey } from "@/src/rules";

/** What the section says under its heading, which bb draws. */
export const SECTION_TITLE = "Endpoints";
export const SECTION_DESCRIPTION =
  "Each Endpoint is an AI service: select it for thread titles or commit messages under Settings → AI services. After changing a variable an Endpoint references, reload the plugin.";

export type KeyKind = "none" | "variable" | "literal";

/** What a card's fields hold. */
export interface Form {
  id: string;
  url: string;
  model: string;
  keyKind: KeyKind;
  /** The `${NAME}` typed for a Variable key. */
  variable: string;
  /** The literal key typed; never filled from a saved key. */
  literal: string;
  /** Whether Replace was pressed, which empties the field for a saved literal key. */
  replacing: boolean;
}

export const blankForm = (): Form => ({ id: "", url: "", model: "", keyKind: "none", variable: "", literal: "", replacing: false });

/** The form for an Endpoint as saved. */
export function formOf(endpoint: Endpoint): Form {
  const { key } = endpoint;
  return {
    id: endpoint.id,
    url: endpoint.url,
    model: endpoint.model ?? "",
    keyKind: key.kind,
    variable: key.kind === "variable" ? key.reference : "",
    literal: "",
    replacing: false,
  };
}

/** Whether the key field is shown as "set", with Replace, rather than as an empty masked field. */
export const showsKeySet = (form: Form, saved: Endpoint | null): boolean => form.keyKind === "literal" && holdsLiteralKey(saved) && !form.replacing;

/** Whether a Save with this form clears the saved literal key, because the URL changed and no key is typed. */
export function clearsKey(form: Form, saved: Endpoint | null): boolean {
  return form.keyKind === "literal" && form.literal.trim() === "" && clearsLiteralKey(saved, form.url);
}

/** Whether the card differs from the Endpoint as saved, which is when it shows Save and Cancel. */
export function isEdited(form: Form, saved: Endpoint | null): boolean {
  if (saved === null) return true;
  const was = formOf(saved);
  return (
    form.url !== was.url ||
    form.model !== was.model ||
    form.keyKind !== was.keyKind ||
    (form.keyKind === "variable" && form.variable !== was.variable) ||
    (form.keyKind === "literal" && (form.literal !== "" || form.replacing))
  );
}

/** What Save sends for the form. */
export function draftOf(form: Form) {
  const key =
    form.keyKind === "variable"
      ? ({ kind: "variable", reference: form.variable } as const)
      : form.keyKind === "literal"
        ? ({ kind: "literal", value: form.literal === "" ? null : form.literal } as const)
        : ({ kind: "none" } as const);
  return { id: form.id, url: form.url, model: form.model, key };
}

/** The question Remove asks. */
export const removeQuestion = (id: string): string =>
  `Remove ${id}? If it's selected for an AI task, select another under Settings → AI services first, or that task stops.`;

