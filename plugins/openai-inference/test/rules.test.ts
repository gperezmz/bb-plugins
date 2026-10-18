import { describe, expect, it } from "vitest";
import type { Endpoint } from "../src/endpoints.js";
import { clearsLiteralKey, planSave, type Draft } from "../src/rules.js";

const mac: Endpoint = { id: "mac", url: "http://192.168.1.5:8083/v1", model: "qwen3-4b", key: { kind: "none" } };
const mlx: Endpoint = { id: "mlx", url: "http://127.0.0.1:8080/v1", model: "qwen3-4b", key: { kind: "literal", set: true } };
const saved = [mac, mlx];

const draft = (over: Partial<Draft> = {}): Draft => ({ id: "new", url: "http://127.0.0.1:9000/v1", model: "m", key: { kind: "none" }, ...over });
const refused = (plan: ReturnType<typeof planSave>) => {
  if (plan.ok || !("fields" in plan)) throw new Error(`expected a field refusal: ${JSON.stringify(plan)}`);
  return plan.fields;
};

describe("what clears a literal key", () => {
  it("is a changed URL on an Endpoint whose literal key is set, and nothing else", () => {
    expect(clearsLiteralKey(mlx, "http://127.0.0.1:9/v1")).toBe(true);
    expect(clearsLiteralKey(mlx, ` ${mlx.url} `)).toBe(false);
    expect(clearsLiteralKey({ ...mlx, key: { kind: "literal", set: false } }, "http://x.example.com")).toBe(false);
    expect(clearsLiteralKey(mac, "http://x.example.com")).toBe(false);
    expect(clearsLiteralKey(undefined, "http://x.example.com")).toBe(false);
  });
});

describe("a new Endpoint", () => {
  it("is saved as typed, trimmed", () => {
    expect(planSave(draft({ id: " mlx2 ", url: " http://127.0.0.1:9000/v1 ", model: " m " }), saved, true)).toEqual({
      ok: true,
      endpoint: { id: "mlx2", url: "http://127.0.0.1:9000/v1", model: "m", key: { kind: "none" } },
      keyFile: { do: "keep" },
    });
  });

  it.each([
    ["an id already used", { id: "mac" }, "id"],
    ["an id with a capital", { id: "Mac2" }, "id"],
    ["an id with a slash", { id: "a/b" }, "id"],
    ["an id of one character", { id: "a" }, "id"],
    ["an id of more than 64 characters", { id: "a".repeat(65) }, "id"],
    ["the id automatic, which bb reserves", { id: "automatic" }, "id"],
    ["the id off, which bb reserves", { id: "off" }, "id"],
    ["an empty model", { model: "  " }, "model"],
    ["an empty URL", { url: "" }, "url"],
    ["a URL without a scheme", { url: "127.0.0.1:8080/v1" }, "url"],
    ["a URL that is not http", { url: "ftp://example.com/v1" }, "url"],
    ["a Variable key that is not a reference", { key: { kind: "variable", reference: "sk-plain" } }, "key"],
    ["a Variable key with more than a reference", { key: { kind: "variable", reference: "Bearer ${KEY}" } }, "key"],
    ["a Literal key with nothing typed", { key: { kind: "literal", value: null } }, "key"],
    ["a Literal key of spaces", { key: { kind: "literal", value: "   " } }, "key"],
  ] as const)("is refused for %s, naming %s", (_name, over, field) => {
    const fields = refused(planSave(draft(over as Partial<Draft>), saved, true));
    expect(Object.keys(fields)).toEqual([field]);
    expect(fields[field]).toBeTruthy();
  });

  it("is refused for every field that is wrong, not the first", () => {
    expect(Object.keys(refused(planSave(draft({ id: "mac", url: "x", model: "" }), saved, true))).sort()).toEqual(["id", "model", "url"]);
  });

  it.each(["http://127.0.0.1:8080/v1", "https://gateway.example.com/v1", "${GATEWAY_URL}", "https://${GATEWAY_HOST}/v1"])("accepts the URL %s", (url) => {
    expect(planSave(draft({ url }), saved, true).ok).toBe(true);
  });

  it("puts a Literal key typed, saving it as set", () => {
    expect(planSave(draft({ key: { kind: "literal", value: " sk-test " } }), saved, true)).toMatchObject({
      ok: true,
      endpoint: { key: { kind: "literal", set: true } },
      keyFile: { do: "put", key: "sk-test" },
    });
  });

  it("saves a Variable key as its reference", () => {
    expect(planSave(draft({ key: { kind: "variable", reference: "${MAC_INFERENCE_KEY}" } }), saved, true)).toMatchObject({
      ok: true,
      endpoint: { key: { kind: "variable", reference: "${MAC_INFERENCE_KEY}" } },
    });
  });
});

describe("an Endpoint already saved", () => {
  const edit = (over: Partial<Draft>) =>
    planSave({ id: "mlx", url: mlx.url, model: mlx.model!, key: { kind: "literal", value: null }, ...over }, saved, false);

  it("is refused where it is gone", () => {
    expect(planSave(draft({ id: "gone" }), saved, false)).toEqual({ ok: false, problem: expect.stringContaining('"gone"') });
  });

  it("does not check its id again", () => {
    expect(planSave({ ...draft({ id: "mac" }), url: mac.url }, saved, false).ok).toBe(true);
  });

  it("keeps its literal key when the key is left empty and the URL is the same", () => {
    expect(edit({ model: "other" })).toMatchObject({ ok: true, endpoint: { model: "other", key: { kind: "literal", set: true } }, keyFile: { do: "keep" } });
  });

  it("replaces its literal key with the one typed", () => {
    expect(edit({ key: { kind: "literal", value: "sk-new" } })).toMatchObject({ keyFile: { do: "put", key: "sk-new" } });
  });

  it("clears its literal key when the URL changes and no key is typed, leaving it Literal and not set", () => {
    expect(edit({ url: "http://127.0.0.1:9999/v1" })).toEqual({
      ok: true,
      endpoint: { ...mlx, url: "http://127.0.0.1:9999/v1", key: { kind: "literal", set: false } },
      keyFile: { do: "remove" },
    });
  });

  it("sets the key typed when the URL changes with it", () => {
    expect(edit({ url: "http://127.0.0.1:9999/v1", key: { kind: "literal", value: "sk-new" } })).toMatchObject({
      endpoint: { key: { kind: "literal", set: true } },
      keyFile: { do: "put", key: "sk-new" },
    });
  });

  it.each([
    ["None", { kind: "none" }, { kind: "none" }],
    ["Variable", { kind: "variable", reference: "${K}" }, { kind: "variable", reference: "${K}" }],
  ] as const)("deletes its literal key when saved with Key %s", (_name, key, stored) => {
    expect(edit({ key })).toMatchObject({ ok: true, endpoint: { key: stored }, keyFile: { do: "remove" } });
  });

  it("is refused a Literal key with nothing typed when none is saved", () => {
    expect(Object.keys(refused(planSave({ ...draft({ id: "mac" }), url: mac.url, key: { kind: "literal", value: null } }, saved, false)))).toEqual(["key"]);
    const unset: Endpoint = { ...mlx, key: { kind: "literal", set: false } };
    expect(Object.keys(refused(planSave({ id: "mlx", url: mlx.url, model: "m", key: { kind: "literal", value: null } }, [unset], false)))).toEqual(["key"]);
  });

  it("changes nothing in the plan when a field is refused", () => {
    expect(planSave({ id: "mlx", url: "nope", model: "m", key: { kind: "none" } }, saved, false)).toEqual({ ok: false, fields: { url: expect.any(String) } });
  });
});
