import { describe, expect, it } from "vitest";
import { z } from "zod";
import { HttpError, type HttpErrorKind } from "../application/ports";
import { failureOf, isFatal, parseAnswer, ReadProblem } from "./service-support";

const shape = z.object({ id: z.number(), name: z.string(), nested: z.object({ at: z.string() }) });
const report = { root: "(root)", message: (fields: string) => `answer lacked ${fields}` };

describe("parseAnswer", () => {
  it("returns what the schema accepts", () => {
    const value = { id: 1, name: "x", nested: { at: "now" } };
    expect(parseAnswer(shape, value, report)).toEqual(value);
  });

  it("throws a ReadProblem naming each offending field once, by path", () => {
    expect(() => parseAnswer(shape, { id: "1", nested: {} }, report)).toThrow(new ReadProblem("answer lacked id, name, nested.at"));
  });

  it("never quotes a value it rejected", () => {
    try {
      parseAnswer(shape, { id: "secret-text", name: "x", nested: { at: "now" } }, report);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ReadProblem);
      expect((error as Error).message).not.toContain("secret-text");
    }
  });

  it("names the whole answer by the root when the issue has no path", () => {
    expect(() => parseAnswer(shape, "text", report)).toThrow("answer lacked (root)");
  });

  it("names at most the limit of fields", () => {
    expect(() => parseAnswer(shape, {}, { ...report, limit: 2 })).toThrow(new ReadProblem("answer lacked id, name"));
  });
});

describe("isFatal", () => {
  it("is true for a refused credential and a rate limit", () => {
    expect(isFatal(new HttpError("auth", "refused"))).toBe(true);
    expect(isFatal(new HttpError("rate-limit", "slow down"))).toBe(true);
  });

  it("is false for any other error, so it fails only its own item", () => {
    expect(isFatal(new HttpError("not-found", "gone"))).toBe(false);
    expect(isFatal(new ReadProblem("odd"))).toBe(false);
    expect(isFatal(new Error("boom"))).toBe(false);
    expect(isFatal(undefined)).toBe(false);
  });
});

describe("ReadProblem", () => {
  it("is an Error named for itself", () => {
    expect(new ReadProblem("x")).toBeInstanceOf(Error);
    expect(new ReadProblem("x").name).toBe("ReadProblem");
  });
});

describe("failureOf", () => {
  const error = (kind: HttpErrorKind) => new HttpError(kind, "x");
  it("kinds the failures that decide whether a fleet is watched", () => {
    expect(failureOf("#1", error("not-found"), "r")).toEqual({ ref: "#1", reason: "r", kind: "not-found" });
    expect(failureOf("#1", error("forbidden"), "r")).toEqual({ ref: "#1", reason: "r", kind: "forbidden" });
    expect(failureOf(null, error("network"), "r")).toEqual({ ref: null, reason: "r", kind: "unreachable" });
    expect(failureOf("#1", error("server"), "r")).toMatchObject({ kind: "unreachable" });
    expect(failureOf("#1", error("client"), "r")).toEqual({ ref: "#1", reason: "r" });
    expect(failureOf("#1", new DOMException("aborted", "AbortError"), "r")).toEqual({ ref: "#1", reason: "r", kind: "unreachable" });
    expect(failureOf("#1", new DOMException("timed out", "TimeoutError"), "r")).toMatchObject({ kind: "unreachable" });
    expect(failureOf("#1", new Error("x"), "r")).toEqual({ ref: "#1", reason: "r" });
  });
});
