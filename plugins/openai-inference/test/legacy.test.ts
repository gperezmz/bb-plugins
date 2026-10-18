import { describe, expect, it } from "vitest";
import { readLegacy } from "../src/legacy.js";

describe("the settings 0.3 saved", () => {
  it("reads an Endpoint with a key reference, a literal key and a model", () => {
    const read = readLegacy(
      '[{"id": "mac", "url": "http://192.168.1.5:8083/v1", "key": "${MAC_INFERENCE_KEY}", "model": "m"}, {"id": "mlx", "url": "http://127.0.0.1:8080/v1", "model": "q"}, {"id": "bare", "url": "http://b.example.com/v1", "model": "q"}]',
      '{"mlx": " sk-mlx ", "gone": "sk-gone"}',
    );
    expect(read).toEqual({
      ok: true,
      items: [
        { endpoint: { id: "mac", url: "http://192.168.1.5:8083/v1", model: "m", key: { kind: "variable", reference: "${MAC_INFERENCE_KEY}" } }, literalKey: null },
        { endpoint: { id: "mlx", url: "http://127.0.0.1:8080/v1", model: "q", key: { kind: "literal", set: true } }, literalKey: "sk-mlx" },
        { endpoint: { id: "bare", url: "http://b.example.com/v1", model: "q", key: { kind: "none" } }, literalKey: null },
      ],
    });
  });

  it("trims a URL, so the Endpoint is saved with the URL a later Save would store", () => {
    const read = readLegacy('[{"id": "mlx", "url": "http://x.example.com:8080/v1 ", "model": "m"}]', '{"mlx": "sk-mlx"}');
    expect(read).toMatchObject({ ok: true, items: [{ endpoint: { url: "http://x.example.com:8080/v1" } }] });
  });

  it.each(["HTTP://127.0.0.1:18451/v1", " http://127.0.0.1:18451/v1", "Https://gw.example.com/v1 "])("reads the URL %j that 0.3 accepted", (url) => {
    const read = readLegacy(JSON.stringify([{ id: "mlx", url, model: "m" }]), undefined);
    expect(read).toMatchObject({ ok: true, items: [{ endpoint: { url: url.trim() } }] });
  });

  it("lets a literal key win over the Endpoint's own reference", () => {
    const read = readLegacy('[{"id": "gw", "url": "${U}", "key": "${K}", "model": "m"}]', '{"gw": "sk-wins"}');
    expect(read).toMatchObject({ ok: true, items: [{ endpoint: { key: { kind: "literal", set: true } }, literalKey: "sk-wins" }] });
  });

  it("reads an Endpoint with no model as having none", () => {
    expect(readLegacy('[{"id": "old", "url": "http://127.0.0.1:1/v1"}]', undefined)).toMatchObject({ ok: true, items: [{ endpoint: { id: "old", model: null } }] });
  });

  it.each([undefined, "", "  ", "[]"])("reads %j as no Endpoints", (text) => {
    expect(readLegacy(text, undefined)).toEqual({ ok: true, items: [] });
  });

  it.each([
    ["JSON that is not JSON", "[{", undefined, "endpoints"],
    ["an id with a capital", '[{"id": "MLX", "url": "http://a.example.com", "model": "m"}]', undefined, "endpoints"],
    ["an id twice", '[{"id": "a", "url": "http://a.example.com"}, {"id": "a", "url": "http://b.example.com"}]', undefined, "endpoints"],
    ["a literal key in an Endpoint", '[{"id": "a", "url": "http://a.example.com", "key": "sk-plain"}]', undefined, "endpoints"],
    ["keys that are not an object", "[]", '["sk"]', "keys"],
    ["keys that are not JSON", "[]", "{", "keys"],
  ])("cannot read %s, naming the %s setting and no key", (_name, endpoints, keys, setting) => {
    const read = readLegacy(endpoints, keys);
    expect(read.ok).toBe(false);
    if (!read.ok) {
      expect(read.reason).toContain(`The ${setting} setting`);
      expect(read.reason).not.toContain("sk-");
    }
  });
});
