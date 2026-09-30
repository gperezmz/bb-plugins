// Seeds a run's quiet threads from a shape file, over bb's HTTP API, with no
// turn: drive-bb-plugins seed calls it before it makes the threads a turn or
// a fork has to make.
//
//   seed.mjs <shape.json>
//
// It reads DBP_URL (the bb server), DBP_PROJECT, DBP_HOST and DBP_EXISTING, a
// JSON file of what the run already has: { titles: [], sections: [{ id,
// name }] }. A section the run has is reused. Each thread is
// created `pending`, its first message due in 2099, with its parent and
// section set at creation, and that message is then deleted, so the thread
// never runs and Thread Glance draws it as a read Idle row finished when it
// was created. An archived tree is archived through its root. Prints what it
// made as JSON: { sections: {name: id}, trees: [{ title, id, archived,
// section, children: [{ title, id }] }], created, archived, ms }.
import { readFileSync } from "node:fs";

const { DBP_URL: server, DBP_PROJECT: projectId, DBP_HOST: hostId, DBP_EXISTING } = process.env;
const existing = DBP_EXISTING ? JSON.parse(readFileSync(DBP_EXISTING, "utf8")) : { titles: [], sections: [] };
const api = new URL("api/v1/", server).href;
const shape = JSON.parse(readFileSync(process.argv[2], "utf8"));
// 8 wide is the width bb 0.44 was seen creating threads at without error.
const WIDTH = 8;
const SEND_AT = Date.UTC(2099, 0, 1);

async function call(method, path, body) {
  const res = await fetch(api + path, {
    method,
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path}: HTTP ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

/** Runs `fn` on every item, at most WIDTH at once, and returns the results in order. */
async function pool(items, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(WIDTH, items.length) }, worker));
  return out;
}

async function createQuiet({ title, parentThreadId, sectionId }) {
  const thread = await call("POST", "threads", {
    projectId,
    providerId: "claude-code",
    model: "claude-opus-5-5[1m]",
    origin: "cli",
    title,
    input: [{ type: "text", text: "seeded", mentions: [] }],
    environment: {
      type: "provider",
      environmentProviderId: "project-checkout",
      machine: { type: "existing", hostId },
      inputs: {},
    },
    ...(parentThreadId && { parentThreadId }),
    ...(sectionId && { sectionId }),
    sendAt: SEND_AT,
  });
  if (thread.status !== "pending") throw new Error(`${title} is ${thread.status}, not pending`);
  for (const message of await call("GET", `threads/${thread.id}/queued-messages`)) {
    await call("DELETE", `threads/${thread.id}/queued-messages/${message.id}`);
  }
  return thread.id;
}

const started = Date.now();
const groups = shape.trees ?? [];
for (const g of groups) {
  if (!Number.isInteger(g.count) || g.count < 1) throw new Error(`a tree group's count must be a positive whole number: ${JSON.stringify(g)}`);
  if (!Number.isInteger(g.children ?? 0) || g.children < 0) throw new Error(`children must be a whole number: ${JSON.stringify(g)}`);
}

const sections = {};
for (const name of new Set(groups.map((g) => g.section).filter(Boolean))) {
  sections[name] = existing.sections.find((s) => s.name === name)?.id ?? (await call("POST", "thread-sections", { name })).id;
}

// Archived groups first, so the live ones are the newer rows. Titles number
// on per title, across groups and past the titles the run already has, so
// every title is unique.
const ordered = [...groups.filter((g) => g.archived), ...groups.filter((g) => !g.archived)];
const numbers = {};
for (const title of existing.titles) {
  const m = /^(.*) (\d+)$/.exec(title);
  if (m) numbers[m[1]] = Math.max(numbers[m[1]] ?? 0, Number(m[2]));
}
const trees = ordered.flatMap((g) => {
  const base = g.title ?? (g.archived ? "archived" : "quiet");
  return Array.from({ length: g.count }, () => {
    const title = `${base} ${(numbers[base] = (numbers[base] ?? 0) + 1)}`;
    return {
      title,
      archived: !!g.archived,
      section: g.section ?? null,
      children: Array.from({ length: g.children ?? 0 }, (_, k) => ({ title: `${title}.${k + 1}` })),
    };
  });
});

await pool(trees, async (t) => {
  t.id = await createQuiet({ title: t.title, sectionId: sections[t.section] });
});
const children = trees.flatMap((t) => t.children.map((c) => ({ c, parentThreadId: t.id, sectionId: sections[t.section] })));
await pool(children, async ({ c, parentThreadId, sectionId }) => {
  c.id = await createQuiet({ title: c.title, parentThreadId, sectionId });
});
const archivedRoots = trees.filter((t) => t.archived);
await pool(archivedRoots, (t) => call("POST", `threads/${t.id}/archive-all`));

console.log(
  JSON.stringify({
    sections,
    trees,
    created: trees.length + children.length,
    archived: archivedRoots.reduce((n, t) => n + 1 + t.children.length, 0),
    ms: Date.now() - started,
  }),
);
