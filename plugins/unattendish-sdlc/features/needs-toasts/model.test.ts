import { describe, expect, it } from "vitest";
import { parseFleetNeeds, toastId, toastTitle } from "./model";

const signal = { fleet: "other-org/x", managerThreadId: "thr_x", role: "forge", text: "other-org/x needs a GitHub account that can read other-org" } as const;

describe("a fleet-needs signal", () => {
  it("is read as the signal the server publishes", () => {
    expect(parseFleetNeeds(signal)).toEqual(signal);
  });

  it("is refused when it is not that", () => {
    expect(parseFleetNeeds(null)).toBeNull();
    expect(parseFleetNeeds({ ...signal, role: "both" })).toBeNull();
    expect(parseFleetNeeds({ fleet: "a" })).toBeNull();
  });

  it("identifies a toast by its fleet and half", () => {
    expect(toastId(signal)).toBe("needs:other-org/x:forge");
    expect(toastId({ ...signal, role: "tracker" })).not.toBe(toastId(signal));
  });

  it("is titled by the fleet that can't be read", () => {
    expect(toastTitle(signal)).toBe("other-org/x can't be read");
  });
});
