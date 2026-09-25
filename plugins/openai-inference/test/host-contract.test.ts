import { experimental_aiServicesHostContract } from "@get-bb/plugin-sdk/ai-services";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { hostContract } from "../src/host-contract.js";

// The copy must accept and refuse what the SDK's contract does.
describe("the AI-service schemas copied from the SDK", () => {
  it.each(["ai.inference.complete", "ai.voice.transcribe"] as const)("%s match the SDK's JSON Schema", (method) => {
    for (const side of ["input", "output"] as const) {
      expect(z.toJSONSchema(hostContract[method][side] as z.ZodType)).toEqual(
        z.toJSONSchema(experimental_aiServicesHostContract[method][side] as z.ZodType),
      );
    }
  });
});
