/**
 * zod keeps its locale on globalThis, and the SDK's test host loads full zod,
 * which sets English. Cleared, the locale comes from what the plugin loads.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as z from "zod/mini";

beforeEach(() => {
  z.config({ localeError: undefined });
  vi.resetModules();
});

describe("zod's locale", () => {
  it.each(["../../server", "../../src/host/contract"])("is English once %s loads", async (path) => {
    await import(path);
    expect(z.number().check(z.minimum(0)).safeParse(-1).error?.issues[0]?.message).toBe(
      "Too small: expected number to be >=0",
    );
  });

  it("stays as another module set it", async () => {
    const localeError = () => "set elsewhere";
    z.config({ localeError });
    await import("../../server");
    expect(z.config().localeError).toBe(localeError);
  });
});
