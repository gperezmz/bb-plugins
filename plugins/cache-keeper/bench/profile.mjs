// Sums a V8 CPU profile (from BENCH_PROF=1) by function, self and total time.
//
//   node bench/profile.mjs <file.cpuprofile> [top]
import { readFileSync } from "node:fs";

const profile = JSON.parse(readFileSync(process.argv[2], "utf8"));
const top = Number(process.argv[3] ?? 40);
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const parent = new Map();
for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
const self = new Map();
const dt = profile.timeDeltas;
for (let i = 0; i < profile.samples.length; i++) self.set(profile.samples[i], (self.get(profile.samples[i]) ?? 0) + (dt[i] ?? 0));
const name = (n) => `${n.callFrame.functionName || "(anon)"} ${n.callFrame.url.split("/").pop()}:${n.callFrame.lineNumber + 1}`;
const selfBy = new Map();
const totalBy = new Map();
for (const [id, us] of self) {
  const n = byId.get(id);
  selfBy.set(name(n), (selfBy.get(name(n)) ?? 0) + us);
  const seen = new Set();
  for (let at = id; at !== undefined; at = parent.get(at)) {
    const k = name(byId.get(at));
    if (seen.has(k)) continue;
    seen.add(k);
    totalBy.set(k, (totalBy.get(k) ?? 0) + us);
  }
}
const all = [...self.values()].reduce((a, b) => a + b, 0);
const show = (m, label) => {
  console.log(`\n${label} (of ${(all / 1000).toFixed(0)} ms sampled)`);
  for (const [k, us] of [...m].sort((a, b) => b[1] - a[1]).slice(0, top)) console.log(`${(us / 1000).toFixed(1).padStart(9)} ms  ${k}`);
};
show(selfBy, "self");
show(totalBy, "total");
