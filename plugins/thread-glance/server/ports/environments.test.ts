import { describe, expect, it } from "vitest";
import { createSdkEnvironments } from "./environments";

interface FakeEnvironment {
  id: string;
  hostId: string;
  path: string | null;
}

/** `bb.sdk.environments` over a list of environments; `getFails` makes `get` reject for those ids, `listFails` the listing. */
function fakeBb(environments: FakeEnvironment[], options: { getFails?: (id: string) => boolean; listFails?: boolean } = {}) {
  const calls = { list: [] as { limit?: number; offset?: number }[], get: [] as string[] };
  const bb = {
    sdk: {
      environments: {
        async list(args: { limit?: number; offset?: number } = {}) {
          calls.list.push(args);
          if (options.listFails) throw new Error("list failed");
          return environments.slice(args.offset ?? 0, (args.offset ?? 0) + (args.limit ?? 100));
        },
        async get({ environmentId }: { environmentId: string }) {
          calls.get.push(environmentId);
          if (options.getFails?.(environmentId)) throw new Error("get failed");
          const found = environments.find((candidate) => candidate.id === environmentId);
          if (found === undefined) throw new Error("not found");
          return found;
        },
      },
    },
  };
  return { source: createSdkEnvironments(bb as never), calls };
}

const environment = (index: number, path: string | null = `/p/${index}`): FakeEnvironment => ({ id: `e${index}`, hostId: "h", path });

describe("createSdkEnvironments", () => {
  it("asks for a few environments one by one and maps a missing path to null", async () => {
    const { source, calls } = fakeBb([environment(1), environment(2, null), environment(3, "")]);
    const read = await source.read(["e1", "e2", "e3"]);
    expect([...read.found]).toEqual(
      expect.arrayContaining([
        ["e1", { hostId: "h", path: "/p/1" }],
        ["e2", null],
        ["e3", null],
      ]),
    );
    expect(read.failed.size).toBe(0);
    expect(calls.list).toEqual([]);
    expect(calls.get.sort()).toEqual(["e1", "e2", "e3"]);
  });

  it("reads many environments from listing pages of 500, without asking one by one", async () => {
    const all = Array.from({ length: 520 }, (_, index) => environment(index));
    const { source, calls } = fakeBb(all);
    const wanted = all.slice(0, 17).map((item) => item.id).concat("e519");
    const read = await source.read(wanted);
    expect(calls.list).toEqual([{ limit: 500, offset: 0 }, { limit: 500, offset: 500 }]);
    expect(calls.get).toEqual([]);
    expect(read.found.get("e519")).toEqual({ hostId: "h", path: "/p/519" });
    expect(read.found.size).toBe(wanted.length);
  });

  it("asks one by one for what a listing did not show", async () => {
    const all = Array.from({ length: 20 }, (_, index) => environment(index));
    const { source, calls } = fakeBb(all);
    // The listing stops at a page smaller than a page; ids it lacks are asked for one by one, and the unknown one fails.
    const read = await source.read([...all.map((item) => item.id), "unknown"]);
    expect(calls.get).toEqual(["unknown"]);
    expect([...read.failed]).toEqual(["unknown"]);
    expect(read.found.size).toBe(20);
  });

  it("reports the ids bb failed to answer for, and answers for the rest", async () => {
    const { source } = fakeBb([environment(1), environment(2)], { getFails: (id) => id === "e2" });
    const read = await source.read(["e1", "e2"]);
    expect([...read.failed]).toEqual(["e2"]);
    expect([...read.found.keys()]).toEqual(["e1"]);
  });

  it("rejects when bb fails for every environment", async () => {
    const { source } = fakeBb([environment(1), environment(2)], { getFails: () => true });
    await expect(source.read(["e1", "e2"])).rejects.toThrow("bb could not answer for any environment");
  });

  it("rejects when the listing fails", async () => {
    const all = Array.from({ length: 20 }, (_, index) => environment(index));
    const { source } = fakeBb(all, { listFails: true });
    await expect(source.read(all.map((item) => item.id))).rejects.toThrow("list failed");
  });
});
