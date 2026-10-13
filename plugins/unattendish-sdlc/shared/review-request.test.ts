import { afterEach, describe, expect, it } from "vitest";
import { clearReviewRequests, requestReview, REVIEW_REQUEST_TTL_MS, takeReview } from "./review-request";

afterEach(clearReviewRequests);

describe("a request to open the Fleet tab at what needs reviewing", () => {
  it("is taken once, for its own thread and fleet", () => {
    requestReview("thr_a", "org/wake", 0);
    expect(takeReview("thr_b", "org/wake", 1)).toBe(false);
    expect(takeReview("thr_a", "org/dash", 1)).toBe(false);
    expect(takeReview("thr_a", "org/wake", 1)).toBe(true);
    expect(takeReview("thr_a", "org/wake", 2)).toBe(false);
  });

  it("is replaced by a later request for another fleet of the thread", () => {
    requestReview("thr_a", "org/dash", 0);
    requestReview("thr_a", "org/wake", 0);
    expect(takeReview("thr_a", "org/dash", 1)).toBe(false);
    expect(takeReview("thr_a", "org/wake", 1)).toBe(true);
  });

  it("lapses when no tab takes it in time", () => {
    requestReview("thr_a", "org/wake", 0);
    expect(takeReview("thr_a", "org/wake", REVIEW_REQUEST_TTL_MS)).toBe(false);
  });
});
