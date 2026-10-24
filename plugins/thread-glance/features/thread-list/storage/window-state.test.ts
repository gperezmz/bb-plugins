import { describe, expect, it } from "vitest";
import type { StorageLike } from "./device-storage";
import { readScope, writeScope } from "./window-state";

function memory(initial: Record<string, string> = {}): StorageLike & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

describe("the scope a window keeps", () => {
  it("reads back what it wrote", () => {
    const storage = memory();
    writeScope(storage, ["proj_a", "proj_b"]);
    expect(readScope(storage)).toEqual(["proj_a", "proj_b"]);
  });

  it("is All projects in a window that saved nothing, and when the saved scope empties", () => {
    const storage = memory();
    expect(readScope(storage)).toEqual([]);
    writeScope(storage, ["proj_a"]);
    writeScope(storage, []);
    expect(readScope(storage)).toEqual([]);
    expect(storage.data.size).toBe(0);
  });

  it("keeps only the project ids of what it finds, without repeats", () => {
    const storage = memory({ "thread-glance:scope": JSON.stringify(["proj_a", 3, "", null, "proj_a", "proj_b"]) });
    expect(readScope(storage)).toEqual(["proj_a", "proj_b"]);
  });

  it("is All projects for a value that is not a list or not JSON", () => {
    expect(readScope(memory({ "thread-glance:scope": '"proj_a"' }))).toEqual([]);
    expect(readScope(memory({ "thread-glance:scope": "{" }))).toEqual([]);
  });

  it("is All projects, and writes nothing, where the browser gives no storage or refuses the write", () => {
    expect(readScope(null)).toEqual([]);
    writeScope(null, ["proj_a"]);
    const refusing: StorageLike = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("full");
      },
      removeItem: () => {
        throw new Error("denied");
      },
    };
    expect(readScope(refusing)).toEqual([]);
    expect(() => writeScope(refusing, ["proj_a"])).not.toThrow();
  });
});
