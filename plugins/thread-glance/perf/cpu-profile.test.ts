// B28 counts the plugin's script only: the CPU profile's attribution by URL.
import { expect, it } from "vitest";
import { attribute, ownerOf } from "./harness/cpu-profile";

const at = (url: string, functionName = "f") => ownerOf({ url: `http://localhost:63315${url}?v=1`, functionName });
const deps = "/node_modules/.vite/vitest/da39/deps";

it("counts the plugin's modules, React and the libraries Vite bundles as the plugin's", () => {
  expect(at("/features/thread-list/store/list-store.ts")).toBe("pluginMs");
  expect(at("/components/ui/popover.tsx")).toBe("pluginMs");
  expect(at(`${deps}/react.esm-Bar33BbW.js`)).toBe("pluginMs");
  expect(at(`${deps}/dist-BQA0ApUO.js`)).toBe("pluginMs");
});

it("counts the fake bb, the test runner and native time apart", () => {
  expect(at("/perf/harness/fake-host.tsx")).toBe("fakeHostMs");
  expect(at(`${deps}/@get-bb_plugin-sdk_testing_app.js`)).toBe("fakeHostMs");
  expect(at("/node_modules/@vitest/browser/dist/locators-BaWxQJd7.js")).toBe("restMs");
  expect(at(`${deps}/@testing-library_react.js`)).toBe("restMs");
  expect(ownerOf({ url: "", functionName: "(garbage collector)" })).toBe("restMs");
  expect(ownerOf({ url: "", functionName: "(idle)" })).toBe("idle");
});

it("sums each sample's time by owner, idle left out", () => {
  const profile = {
    nodes: [
      { id: 1, callFrame: { url: "", functionName: "(idle)" } },
      { id: 2, callFrame: { url: "http://h/features/x.ts", functionName: "a" } },
      { id: 3, callFrame: { url: "http://h/perf/harness/fake-host.tsx", functionName: "b" } },
    ],
    samples: [1, 2, 2, 3],
    timeDeltas: [5_000, 1_000, 1_500, 700],
  };
  expect(attribute(profile)).toEqual({ pluginMs: 2.5, fakeHostMs: 0.7, restMs: 0 });
});
