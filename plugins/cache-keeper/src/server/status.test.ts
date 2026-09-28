import { describe, expect, it } from "vitest";
import { view } from "../../features/cache-keeper/model/view.test.helpers";
import { describe as statusOf, statusJson } from "./status";

const unread = view({ model: null, lifetime: null, priceOrigin: null, rates: null });
const unpriced = view({ model: "claude-unknown-9", priceOrigin: null, rates: null });

describe("price source", () => {
  it("names the list a priced model's price came from", () => {
    expect(statusOf(view({ priceOrigin: "bundled" }), 0, null)).toContain("price source: bundled");
    expect(statusJson(view({ priceOrigin: "litellm" }), 0, null, null).priceSource).toBe("LiteLLM");
  });

  it("says a model not read yet has no price source yet, and never that it has no price", () => {
    const text = statusOf({ ...unread, waiting: true }, 0, null);
    expect(text).toContain("price source: none yet: model not read");
    expect(text).not.toContain("no price");
    expect(statusJson(unread, 0, null, null).priceSource).toBe("none yet: model not read");
  });

  it("says a model that was read and has no price has none, as before", () => {
    expect(statusOf(unpriced, 0, null)).toContain("price source: none: the model has no price");
    expect(statusJson(unpriced, 0, null, null).priceSource).toBe("none: the model has no price");
  });
});
