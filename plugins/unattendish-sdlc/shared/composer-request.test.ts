import { afterEach, describe, expect, it } from "vitest";
import { clearComposerRequests, composerRequestSeq, failsRequest, holdComposerRequest, pendingComposerRequest, releaseComposerRequest, requestComposer, requestOnView, takeComposerRequest } from "./composer-request";
import { PENDING_OPEN_TTL_MS } from "./pending-open";

afterEach(clearComposerRequests);

const target = { fleet: "org/dash", rowId: "row_7", ref: "#7", what: "Which cache to use" };

describe("a request to open a row's composer on the Fleets page", () => {
  it("waits, numbered, until it is taken, and its number stays once it is", () => {
    requestComposer(target, 0);
    const request = pendingComposerRequest(1)!;
    expect(request).toEqual(expect.objectContaining(target));
    expect(composerRequestSeq()).toBe(request.seq);
    takeComposerRequest(request.seq, 1);
    expect(pendingComposerRequest(2)).toBeNull();
    expect(composerRequestSeq()).toBe(request.seq);
  });

  it("is replaced by a later request, which an earlier number does not take", () => {
    requestComposer(target, 0);
    const first = pendingComposerRequest(0)!;
    requestComposer({ ...target, fleet: "org/wake" }, 0);
    takeComposerRequest(first.seq, 0);
    expect(pendingComposerRequest(1)).toEqual(expect.objectContaining({ fleet: "org/wake", seq: first.seq + 1 }));
  });

  it("lapses when no Fleets page holds it in time", () => {
    requestComposer(target, 0);
    expect(pendingComposerRequest(PENDING_OPEN_TTL_MS)).toBeNull();
  });

  it("waits however long the page's view takes once a page holds it", () => {
    requestComposer(target, 0);
    holdComposerRequest(1);
    expect(pendingComposerRequest(PENDING_OPEN_TTL_MS * 10)).toEqual(expect.objectContaining(target));
  });

  it("lapses again once the page holding it lets it go", () => {
    requestComposer(target, 0);
    holdComposerRequest(1);
    releaseComposerRequest(5 * PENDING_OPEN_TTL_MS);
    expect(pendingComposerRequest(6 * PENDING_OPEN_TTL_MS - 1)).not.toBeNull();
    expect(pendingComposerRequest(6 * PENDING_OPEN_TTL_MS)).toBeNull();
  });

  it("is judged only on a view fetched after it was made, and dropped only by a fetch that failed after it was made", () => {
    requestComposer(target, 0);
    const request = pendingComposerRequest(0)!;
    expect(requestOnView(request, request.seq - 1)).toBeNull();
    expect(requestOnView(request, null)).toBeNull();
    expect(requestOnView(request, request.seq)).toBe(request);
    expect(requestOnView(null, request.seq)).toBeNull();
    expect(failsRequest(request, request.seq - 1)).toBe(false);
    expect(failsRequest(request, request.seq)).toBe(true);
  });
});
