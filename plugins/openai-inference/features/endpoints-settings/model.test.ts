import { describe, expect, it } from "vitest";
import type { Endpoint } from "@/src/endpoints";
import { blankForm, clearsKey, draftOf, formOf, holdsLiteralKey, isEdited, removeQuestion, showsKeySet } from "./model";

const mlx: Endpoint = { id: "mlx", url: "http://127.0.0.1:8080/v1", model: "qwen3-4b", key: { kind: "literal", set: true } };
const mac: Endpoint = { id: "mac", url: "http://192.168.1.5:8083/v1", model: "m", key: { kind: "variable", reference: "${MAC_KEY}" } };

describe("what a card holds", () => {
  it("is the saved Endpoint, with a saved literal key left out", () => {
    expect(formOf(mlx)).toEqual({ id: "mlx", url: mlx.url, model: "qwen3-4b", keyKind: "literal", variable: "", literal: "", replacing: false });
    expect(formOf(mac)).toMatchObject({ keyKind: "variable", variable: "${MAC_KEY}" });
    expect(formOf({ ...mac, model: null }).model).toBe("");
  });

  it("is edited only where it differs from the saved Endpoint", () => {
    expect(isEdited(formOf(mlx), mlx)).toBe(false);
    expect(isEdited({ ...formOf(mlx), model: "other" }, mlx)).toBe(true);
    expect(isEdited({ ...formOf(mlx), url: "http://x.example.com" }, mlx)).toBe(true);
    expect(isEdited({ ...formOf(mlx), replacing: true }, mlx)).toBe(true);
    expect(isEdited({ ...formOf(mlx), literal: "sk-new" }, mlx)).toBe(true);
    expect(isEdited({ ...formOf(mlx), keyKind: "none" }, mlx)).toBe(true);
    expect(isEdited({ ...formOf(mac), variable: "${OTHER}" }, mac)).toBe(true);
    expect(isEdited(blankForm(), null)).toBe(true);
  });

  it("shows a saved literal key as set until Replace", () => {
    expect(showsKeySet(formOf(mlx), mlx)).toBe(true);
    expect(showsKeySet({ ...formOf(mlx), replacing: true }, mlx)).toBe(false);
    expect(showsKeySet(formOf(mac), mac)).toBe(false);
    expect(showsKeySet({ ...formOf(mac), keyKind: "literal" }, mac)).toBe(false);
    expect(holdsLiteralKey({ ...mlx, key: { kind: "literal", set: false } })).toBe(false);
  });

  it("says a Save clears the saved key when the URL changes and no key is typed", () => {
    const moved = { ...formOf(mlx), url: "http://127.0.0.1:9/v1" };
    expect(clearsKey(moved, mlx)).toBe(true);
    expect(clearsKey({ ...moved, literal: "sk-new" }, mlx)).toBe(false);
    expect(clearsKey(formOf(mlx), mlx)).toBe(false);
    expect(clearsKey({ ...formOf(mac), url: "http://x.example.com" }, mac)).toBe(false);
  });

  it("sends nothing typed for a literal key left empty, and what was typed otherwise", () => {
    expect(draftOf({ ...formOf(mlx) }).key).toEqual({ kind: "literal", value: null });
    expect(draftOf({ ...formOf(mlx), literal: "sk-new" }).key).toEqual({ kind: "literal", value: "sk-new" });
    expect(draftOf(formOf(mac)).key).toEqual({ kind: "variable", reference: "${MAC_KEY}" });
    expect(draftOf({ ...formOf(mac), keyKind: "none" }).key).toEqual({ kind: "none" });
  });

  it("asks the question the spec words", () => {
    expect(removeQuestion("mac")).toBe("Remove mac? If it's selected for an AI task, select another under Settings → AI services first, or that task stops.");
  });
});
