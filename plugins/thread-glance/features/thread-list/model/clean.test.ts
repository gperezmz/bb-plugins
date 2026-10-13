// The Clean dialog's decisions: what each state shows and how its buttons read.
import { describe, expect, it } from "vitest";
import type { PreviewCleanOutput, RunCleanOutput } from "@/shared/ports";
import { cleanSummary, cleanView, stillListeningText, type CleanState } from "./clean";

const withThreads: PreviewCleanOutput = {
  token: "t",
  expiresAt: 1,
  threads: [{ threadId: "a", title: "A", terminals: 1, ports: [] }],
};
const empty: PreviewCleanOutput = { ...withThreads, threads: [] };
const result = (patch: Partial<RunCleanOutput> = {}): RunCleanOutput => ({ expired: false, closedTerminals: 0, portRequests: 0, stillListening: [], issues: [], ...patch });

describe("cleanView", () => {
  it("offers Cancel only, while the preview loads", () => {
    expect(cleanView({ phase: "loading" })).toMatchObject({ preview: null, found: false, finished: false, closeLabel: "Cancel", dismissible: true, showClean: false, showRefresh: false });
  });

  it("offers Clean resources and Cancel for a preview with threads", () => {
    expect(cleanView({ phase: "preview", preview: withThreads })).toMatchObject({
      found: true,
      finished: false,
      nothingFound: false,
      closeLabel: "Cancel",
      showClean: true,
      cleanLabel: "Clean resources",
      cleanDisabled: false,
      dismissible: true,
    });
  });

  it("is finished, with Close and no Clean resources, for a preview with nothing", () => {
    expect(cleanView({ phase: "preview", preview: empty })).toMatchObject({ found: false, finished: true, nothingFound: true, closeLabel: "Close", showClean: false });
  });

  it("shows Cleaning... disabled, and cannot be dismissed, while the run goes", () => {
    expect(cleanView({ phase: "running", preview: withThreads })).toMatchObject({ cleanLabel: "Cleaning...", cleanDisabled: true, dismissible: false, showClean: true, closeLabel: "Cancel" });
  });

  it("is finished with Close once there is a result", () => {
    expect(cleanView({ phase: "done", result: result() })).toMatchObject({ finished: true, closeLabel: "Close", showClean: false, dismissible: true });
  });

  it.each<CleanState>([{ phase: "expired" }, { phase: "failed", message: "x" }])("offers Refresh preview and Close for $phase", (state) => {
    expect(cleanView(state)).toMatchObject({ showRefresh: true, closeLabel: "Close", showClean: false, dismissible: true });
  });
});

describe("the result's texts", () => {
  it.each([
    [1, 1, "1 terminal closed · 1 port shutdown request sent"],
    [3, 1, "3 terminals closed · 1 port shutdown request sent"],
    [1, 0, "1 terminal closed · 0 port shutdown requests sent"],
    [0, 1, "0 terminals closed · 1 port shutdown request sent"],
    [2, 2, "2 terminals closed · 2 port shutdown requests sent"],
  ])("reads %i closed and %i port requests as '%s'", (closedTerminals, portRequests, text) => {
    expect(cleanSummary(result({ closedTerminals, portRequests }))).toBe(text);
  });

  it("reads that nothing was closed when neither count is above zero", () => {
    expect(cleanSummary(result())).toBe("No resources were closed.");
  });

  it("lists the ports still listening, or says nothing", () => {
    expect(stillListeningText(result({ stillListening: [5173, 3000] }))).toBe("Still listening after the request: :3000, :5173");
    expect(stillListeningText(result())).toBeNull();
  });
});
