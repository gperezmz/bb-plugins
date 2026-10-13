import { afterEach, describe, expect, it } from "vitest";
import { clearReviewRequests, requestReview, REVIEW_REQUEST_TTL_MS, takeReview } from "./review-request";

afterEach(clearReviewRequests);

describe("a request to open the Fleet tab at what needs reviewing", () => {
  it("is taken once, for its own thread", () => {
    requestReview("thr_a", 0);
    expect(takeReview("thr_b", 1)).toBe(false);
    expect(takeReview("thr_a", 1)).toBe(true);
    expect(takeReview("thr_a", 2)).toBe(false);
  });

  it("lapses when no tab takes it in time", () => {
    requestReview("thr_a", 0);
    expect(takeReview("thr_a", REVIEW_REQUEST_TTL_MS)).toBe(false);
  });
});
