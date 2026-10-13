import { afterEach, describe, expect, it } from "vitest";
import { clearComposerRequests, COMPOSER_REQUEST_TTL_MS, composerRequestSeq, holdComposerRequest, pendingComposerRequest, requestComposer, takeComposerRequest } from "./composer-request";

afterEach(clearComposerRequests);

const target = { fleet: "org/dash", rowId: "row_7", ref: "#7", what: "Which cache to use" };

describe("a request to open a row's composer on the Fleets page", () => {
  it("waits, numbered, until it is taken, and its number stays once it is", () => {
    requestComposer(target, 0);
    const request = pendingComposerRequest(1)!;
    expect(request).toEqual(expect.objectContaining(target));
    expect(composerRequestSeq()).toBe(request.seq);
    takeComposerRequest(request.seq);
    expect(pendingComposerRequest(2)).toBeNull();
    expect(composerRequestSeq()).toBe(request.seq);
  });

  it("is replaced by a later request, which an earlier number does not take", () => {
    requestComposer(target, 0);
    const first = pendingComposerRequest(0)!;
    requestComposer({ ...target, fleet: "org/wake" }, 0);
    takeComposerRequest(first.seq);
    expect(pendingComposerRequest(1)).toEqual(expect.objectContaining({ fleet: "org/wake", seq: first.seq + 1 }));
  });

  it("lapses when no Fleets page holds it in time", () => {
    requestComposer(target, 0);
    expect(pendingComposerRequest(COMPOSER_REQUEST_TTL_MS)).toBeNull();
  });

  it("waits however long the page's view takes once a page holds it", () => {
    requestComposer(target, 0);
    holdComposerRequest(1);
    expect(pendingComposerRequest(COMPOSER_REQUEST_TTL_MS * 10)).toEqual(expect.objectContaining(target));
  });
});
