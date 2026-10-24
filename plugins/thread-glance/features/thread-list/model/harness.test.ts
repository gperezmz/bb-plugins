import { describe, expect, it } from "vitest";
import { modelDisplayName, modelLine } from "./harness";

const ready = (model: string | null, reasoningLevel: string | null) => ({ status: "ready" as const, model, reasoningLevel });

describe("AC1: model and effort on one line", () => {
  it("reads the model's name then the level capitalised", () => {
    expect(modelLine(ready("GPT 6.1 Sol", "medium"))).toBe("GPT 6.1 Sol Medium");
  });

  it("shows the name alone when no level is set", () => {
    expect(modelLine(ready("GPT 6.1 Sol", null))).toBe("GPT 6.1 Sol");
    expect(modelLine(ready("GPT 6.1 Sol", "none"))).toBe("GPT 6.1 Sol");
  });

  it("shows the raw model id and the level for a model bb has no display name for", () => {
    const name = modelDisplayName("mystery-model", [{ id: "a", model: "a", displayName: "A" }]);
    expect(modelLine(ready(name, "high"))).toBe("mystery-model High");
  });

  it("says what is missing", () => {
    expect(modelLine({ status: "loading" })).toBe("Loading…");
    expect(modelLine({ status: "unavailable" })).toBe("Unavailable");
    expect(modelLine(ready(null, null))).toBe("Not set");
  });
});
