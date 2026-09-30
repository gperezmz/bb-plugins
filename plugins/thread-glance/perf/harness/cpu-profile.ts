// Whose script ran: a DevTools CPU profile's samples, attributed by the URL
// of the function each one landed in.

/** Script time in ms: the plugin's (its modules, the libraries it bundles, and React rendering it), the fake bb's, and the rest. */
export interface ScriptAttribution {
  pluginMs: number;
  fakeHostMs: number;
  /** The test runner, the harness, and native time with no script URL (garbage collection, DOM calls). */
  restMs: number;
}

interface ProfileNode {
  id: number;
  callFrame: { functionName: string; url: string };
}

/** `Profiler.stop`'s profile, as far as attribution reads it. */
export interface CpuProfile {
  nodes: ProfileNode[];
  samples: number[];
  /** Microseconds from each sample to the one before. */
  timeDeltas: number[];
}

type Owner = keyof ScriptAttribution | "idle";

/** Who a function belongs to, by its script's URL as Vite serves it. */
export function ownerOf({ functionName, url }: ProfileNode["callFrame"]): Owner {
  if (functionName === "(idle)") return "idle";
  const path = url.replace(/[?#].*$/, "");
  if (/\/perf\/harness\/fake-host\.tsx$/.test(path) || /get-bb_plugin-sdk/.test(path)) return "fakeHostMs";
  // Vite's pre-bundled libraries: React and what the plugin bundles, and
  // shared chunks no URL names, counted as the plugin's so the figure errs high.
  if (/\/node_modules\/\.vite\//.test(path) && !/\/(@vitest|@testing-library|vitest)[^/]*$/.test(path)) return "pluginMs";
  if (/\/(features|components|shared|lib|hooks)\//.test(path) && !/node_modules/.test(path)) return "pluginMs";
  return "restMs";
}

/** Sums the profile's samples by owner, idle time left out. */
export function attribute(profile: CpuProfile): ScriptAttribution {
  const owners = new Map(profile.nodes.map((node) => [node.id, ownerOf(node.callFrame)]));
  const totals: Record<Owner, number> = { pluginMs: 0, fakeHostMs: 0, restMs: 0, idle: 0 };
  profile.samples.forEach((id, index) => {
    totals[owners.get(id) ?? "restMs"] += (profile.timeDeltas[index] ?? 0) / 1000;
  });
  const round = (ms: number) => Number(ms.toFixed(1));
  return { pluginMs: round(totals.pluginMs), fakeHostMs: round(totals.fakeHostMs), restMs: round(totals.restMs) };
}
