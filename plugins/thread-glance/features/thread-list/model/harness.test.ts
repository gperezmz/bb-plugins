import { describe, expect, it } from "vitest";
import { modelDisplayName, modelLine, reasoningLevelLabel } from "./harness";

const ready = (model: string | null, reasoningLevel: string | null) => ({ status: "ready" as const, model, reasoningLevel });

describe("AC1: model and effort on one line", () => {
  it("reads the model's name then the level's name", () => {
    expect(modelLine(ready("GPT 6.1 Sol", "Medium"))).toBe("GPT 6.1 Sol Medium");
  });

  it("shows the name alone when no level is set", () => {
    expect(modelLine(ready("GPT 6.1 Sol", null))).toBe("GPT 6.1 Sol");
  });

  it("shows the raw model id and the level for a model bb has no display name for", () => {
    const name = modelDisplayName("mystery-model", [{ id: "a", model: "a", displayName: "A" }]);
    expect(modelLine(ready(name, "High"))).toBe("mystery-model High");
  });

  it("says what is missing", () => {
    expect(modelLine({ status: "loading" })).toBe("Loading…");
    expect(modelLine({ status: "unavailable" })).toBe("Unavailable");
    expect(modelLine(ready(null, null))).toBe("Not set");
  });
});

describe("AC1: the level in bb's name for it", () => {
  const catalog = [
    { id: "m", model: "m", displayName: "M", supportedReasoningEfforts: [{ reasoningEffort: "ultra", label: "Ultracode" }, { reasoningEffort: "none", label: "Off" }, { reasoningEffort: "medium" }] },
  ];

  it("takes the catalog's label, as written, for a level that has one", () => {
    expect(reasoningLevelLabel("m", "ultra", catalog)).toBe("Ultracode");
  });

  it("capitalises the level where the catalog has no label, no entry or no model", () => {
    expect(reasoningLevelLabel("m", "medium", catalog)).toBe("Medium");
    expect(reasoningLevelLabel("m", "xhigh", catalog)).toBe("Xhigh");
    expect(reasoningLevelLabel("other", "ultra", catalog)).toBe("Ultra");
  });

  it("is null for no level, whatever the catalog labels", () => {
    expect(reasoningLevelLabel("m", null, catalog)).toBeNull();
    expect(reasoningLevelLabel("m", "", catalog)).toBeNull();
    expect(reasoningLevelLabel("m", "none", catalog)).toBeNull();
  });
});
