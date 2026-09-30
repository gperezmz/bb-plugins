// Thread Glance's feature verbs: each drives one sub-feature of
// features/thread-glance.md through the sidebar, with the selectors the
// plugin gives its elements, and returns what the list showed before and
// after, what bb stored, and, with --second-window or --reload, what a second
// window showed with no reload or the same window after one.
//
//   drive-bb-plugins thread-glance --run <run> <verb> [args] [--second-window] [--reload] [--mobile] [--label <label>]
//
// The exported helpers (ready, readList, row, chip, openSettings, controls,
// CONTROLS) serve a new verb, and a `drive-bb-plugins ui` script looking at
// a screen before its verb exists, which imports them from
// process.env.DBP_SKILL + "/verbs/thread-glance.mjs".

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Loads the web UI and waits for Thread Glance's list header. */
export async function ready(page, url) {
  await page.goto(url);
  await header(page).waitFor();
  await page.waitForLoadState("networkidle");
}

/** The settings button, which only Thread Glance's list header draws. */
export const header = (page) => page.getByRole("button", { name: "Thread Glance settings" });

/** A row's link, by thread title. */
export const row = (page, title) => page.getByRole("link", { name: new RegExp(`^Open ${esc(title)} — `) });

/** A parent's children chip, by the parent's title, whatever its count and suffix. */
export const chip = (page, title) =>
  page.getByRole("button", { name: new RegExp(`^(Show|Collapse) (\\d+ child threads?|hidden child threads) of ${esc(title)}(,|$)`) });

/** Splits "Open <title> — <State>; <Provider>; child of <parent>; unread" into its parts. */
function parseRow(name) {
  const body = name.replace(/^Open /, "");
  const cut = body.lastIndexOf(" — ");
  const [state, provider, ...details] = body.slice(cut + 3).split("; ");
  const childOf = details.find((d) => d.startsWith("child of "))?.slice(9) ?? null;
  return { title: body.slice(0, cut), state, provider, childOf, unread: state === "Unread" || details.includes("unread"), details };
}

/** What the list shows: its heading, need-you button, Mark all read, groups, settled folds and rows. */
export async function readList(page) {
  const heading = await page.getByRole("heading", { level: 2 }).evaluateAll((els) =>
    els.map((e) => e.textContent.trim()).find((t) => ["Projects", "Sections", "Machines"].includes(t)) ?? null,
  );
  const needYouButton = page.getByRole("button", { name: /^\d+ need you$/ });
  const needYou = (await needYouButton.count()) > 0
    ? { count: Number((await needYouButton.textContent()).match(/\d+/)[0]), pressed: (await needYouButton.getAttribute("aria-pressed")) === "true" }
    : null;
  const rows = await page.getByRole("link", { name: /^Open .+ — / }).evaluateAll((els) =>
    els.map((a) => ({
      name: a.getAttribute("aria-label") ?? a.textContent,
      current: a.getAttribute("aria-current") === "page",
      group: a.closest("section[aria-label]")?.getAttribute("aria-label") ?? null,
    })),
  );
  const buttons = async (re) => page.getByRole("button", { name: re }).evaluateAll((els) =>
    els.map((b) => ({ name: b.getAttribute("aria-label") ?? b.textContent.trim(), expanded: b.getAttribute("aria-expanded") === "true" })),
  );
  return {
    heading,
    needYou,
    markAllRead: (await page.getByRole("button", { name: "Mark all read", exact: true }).count()) > 0,
    empty: (await page.getByText("No threads yet.").count()) > 0,
    rows: rows.map((r) => ({ ...parseRow(r.name), current: r.current, group: r.group })),
    chips: await buttons(/^(Show|Collapse) (\d+ child threads?|hidden child threads) of /),
    settled: await buttons(/^(Show|Hide) \d+ settled thread trees?$/),
  };
}

/**
 * The popover's controls: each with its kind, the stored preference (`key`
 * on the bb server, `client` in the browser's bb.thread-glance.client.v1) and
 * the stored value of each option the popover names.
 */
export const CONTROLS = {
  "Group by": { kind: "radio", key: "organizationMode", options: { Project: "project", Custom: "chronological", Machine: "machine" } },
  "Sort by": { kind: "radio", key: "chronologicalSort", options: { Updated: "updated", Created: "created", "A–Z": "alpha" } },
  "Sort order": { kind: "reverse", key: "sortDirection" },
  "Worktrees as folders": { kind: "checkbox", key: "environmentGrouping", options: { on: true, off: false } },
  "Settle after": { kind: "radio", key: "settleAfter", options: { "12h": "12h", "1d": "1d", "3d": "3d", "1w": "1w", Never: "never" } },
  Density: { kind: "radio", client: "density", options: { Compact: "compact", Comfortable: "comfortable" } },
  "Branch line": { kind: "checkbox", client: "branchLine", options: { on: true, off: false } },
  "Harness icon": { kind: "radio", key: "harnessIcon", options: { Muted: "muted", Colour: "colour" } },
  "Needs attention counts every child": { kind: "checkbox", key: "childAttention", options: { on: "everything", off: "blocked" } },
};

function control(name) {
  const found = Object.keys(CONTROLS).find((c) => c.toLowerCase() === String(name).toLowerCase());
  if (found === undefined) throw new Error(`no control "${name}"; controls: ${Object.keys(CONTROLS).join(", ")}`);
  return found;
}

/** The option a control's argument names, by its label or its stored value. */
function option(name, value) {
  const { options } = CONTROLS[name];
  const hit = Object.entries(options).find(([label, stored]) => [label.toLowerCase(), String(stored).toLowerCase()].includes(String(value).toLowerCase()));
  if (hit === undefined) throw new Error(`"${name}" has no option "${value}"; options: ${Object.keys(options).join(", ")}`);
  return { label: hit[0], stored: hit[1] };
}

const popover = (page) => page.getByRole("radiogroup", { name: "Group by" });

/** Opens the settings popover, unless it is open. */
export async function openSettings(page) {
  // A popover opened as the list's data first lands closes again; reopen it.
  for (let i = 0; i < 3; i++) {
    if (!(await popover(page).isVisible())) {
      await header(page).click();
      await popover(page).waitFor();
    }
    await sleep(1000);
    if (await popover(page).isVisible()) return;
  }
  throw new Error("the settings popover closed on its own three times");
}

function locate(page, name) {
  const c = CONTROLS[name];
  if (c.kind === "radio") return page.getByRole("radiogroup", { name });
  if (c.kind === "checkbox") return page.getByRole("checkbox", { name: new RegExp(`^${esc(name)}`) });
  return page.getByRole("button", { name: /^Sort order: / });
}

/** Every control's state in the open popover: the checked option's label, on/off, or the sort order. */
export async function controls(page) {
  const state = {};
  for (const name of Object.keys(CONTROLS)) {
    const el = locate(page, name);
    const kind = CONTROLS[name].kind;
    if (kind === "radio") state[name] = (await el.getByRole("radio", { checked: true }).textContent()).trim();
    else if (kind === "checkbox") state[name] = (await el.getAttribute("aria-checked")) === "true" ? "on" : "off";
    else state[name] = (await el.getAttribute("aria-label")).replace(/^Sort order: (.*)\. Reverse$/, "$1");
  }
  return state;
}

/** Waits for a control to show an option. */
async function awaitControl(page, name, label) {
  const c = CONTROLS[name];
  if (c.kind === "radio") await locate(page, name).getByRole("radio", { name: label, exact: true, checked: true }).waitFor();
  else await page.getByRole("checkbox", { name: new RegExp(`^${esc(name)}`), checked: label === "on" }).waitFor();
}

/** The browser's own preferences, which the CLI cannot read. */
const clientPrefs = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("bb.thread-glance.client.v1") ?? "null"));

/** Polls `prefs get` until it prints `want` (the popover writes after a debounce); the last value read. */
async function prefUntil(cli, label, key, want) {
  let value;
  for (let i = 0; i < 20; i++) {
    value = JSON.parse(cli(label, "thread-glance", "prefs", "get", key));
    if (want === undefined || JSON.stringify(value) === JSON.stringify(want)) return value;
    await sleep(500);
  }
  return value;
}

/** The run's threads by title, from bb. */
function threads(cli, label) {
  const listed = JSON.parse(cli(label, "thread", "list", "--json"));
  return Array.isArray(listed) ? listed : listed.threads;
}

function threadId(cli, label, title) {
  const t = threads(cli, label).find((x) => x.title === title);
  if (t === undefined) throw new Error(`no thread titled "${title}" in the run`);
  return t.id;
}

/**
 * The shape every stateful verb shares: prepare a page, observe it, act,
 * wait for the result, read back what bb stored, then report what a second
 * window (opened before the action) shows without a reload, and what this
 * window shows after one.
 */
async function drive(ctx, { name, prepare = async () => {}, observe, act, settle, stored = async () => null }) {
  const { page, url, capture, newPage, flags } = ctx;
  await ready(page, url);
  await prepare(page);
  let second = null;
  if (flags["second-window"]) {
    second = await newPage();
    await ready(second, url);
    await prepare(second);
    await capture("second-before", "a second window, opened before the action", second);
    // Focusing a window closes the other's popover, so each is prepared again once in front.
    await page.bringToFront();
    await prepare(page);
  }
  const before = await observe(page);
  await capture("before", `before ${name}`);
  await act(page);
  await settle(page);
  const after = await observe(page);
  await capture("after", name);
  const result = { before, after, stored: await stored(page) };
  if (second !== null) {
    // Some state is per window (the need-you filter, Density, Branch line):
    // the second window reports whether it followed rather than failing.
    await second.bringToFront();
    await prepare(second);
    const followed = await Promise.race([settle(second).then(() => true, () => false), sleep(10_000).then(() => false)]);
    result.secondWindow = { followed, state: await observe(second) };
    await capture("second-after", `the second window, no reload (${followed ? "followed" : "did not follow within 10 s"})`, second);
  }
  if (flags.reload) {
    await page.reload();
    await header(page).waitFor();
    await prepare(page);
    const state = await observe(page);
    result.reloaded = { kept: JSON.stringify(state) === JSON.stringify(result.after), state };
    await capture("reloaded", "after a reload");
  }
  return result;
}

const toggleTarget = (arg, current) => (arg === undefined ? !current : ["expand", "on", "open"].includes(arg));

export const verbs = {
  list: {
    usage: "[--open <title>] [--wait <title>]: the list header, rows, chips and settled folds; --wait first waits for a row, --open clicks it",
    valued: ["open", "wait"],
    async run({ page, url, capture, flags }) {
      await ready(page, url);
      if (flags.wait) await row(page, flags.wait).waitFor({ timeout: 30_000 });
      if (flags.open) {
        await row(page, flags.open).click();
        await row(page, flags.open).and(page.locator('[aria-current="page"]')).waitFor();
      }
      await capture("list", flags.open ? `open ${flags.open}` : "the list");
      return readList(page);
    },
  },

  children: {
    usage: "<parent title> [expand|collapse]: click the parent's children chip (toggles without a direction)",
    async run(ctx) {
      const [parent, direction] = ctx.args;
      if (!parent) throw new Error("usage: children <parent title> [expand|collapse]");
      let want;
      const observe = async (p) => {
        const c = chip(p, parent);
        return {
          chip: await c.getAttribute("aria-label").catch(async () => (await c.textContent()).trim()),
          expanded: (await c.getAttribute("aria-expanded")) === "true",
          children: (await readList(p)).rows.filter((r) => r.childOf === parent).map((r) => r.title),
        };
      };
      return drive(ctx, {
        name: `click the children chip of ${parent}`,
        prepare: async (p) => chip(p, parent).waitFor({ timeout: 30_000 }),
        observe,
        act: async (p) => {
          want = toggleTarget(direction, (await observe(p)).expanded);
          if ((await observe(p)).expanded !== want) await chip(p, parent).click();
        },
        settle: async (p) => p.getByRole("button", { name: new RegExp(`^${want ? "Collapse" : "Show"} .* of ${esc(parent)}(,|$)`) }).waitFor(),
        stored: async () => {
          const id = threadId(ctx.cli, "thread-glance.children/cli", parent);
          const expandedChildren = await prefUntil(ctx.cli, "thread-glance.children/cli", "expandedChildren");
          return { parentId: id, expandedChildren, holdsParent: expandedChildren.includes(id) };
        },
      });
    },
  },

  "need-you": {
    usage: "[on|off]: press the `N need you` filter (toggles without a direction)",
    async run(ctx) {
      let want;
      const button = (p) => p.getByRole("button", { name: /^\d+ need you$/ });
      return drive(ctx, {
        name: "press N need you",
        prepare: async (p) => button(p).waitFor({ timeout: 30_000 }),
        observe: readList,
        act: async (p) => {
          want = toggleTarget(ctx.args[0], (await button(p).getAttribute("aria-pressed")) === "true");
          if (((await button(p).getAttribute("aria-pressed")) === "true") !== want) await button(p).click();
        },
        settle: async (p) => p.locator(`button[aria-pressed="${want}"]`).filter({ hasText: /need you$/ }).waitFor(),
      });
    },
  },

  "mark-all-read": {
    usage: ": click Mark all read (and its confirmation above 20 threads)",
    async run(ctx) {
      const button = (p) => p.getByRole("button", { name: "Mark all read", exact: true });
      return drive(ctx, {
        name: "click Mark all read",
        prepare: async (p) => button(p).waitFor({ timeout: 30_000 }),
        observe: readList,
        act: async (p) => {
          await button(p).click();
          const confirm = p.getByRole("alertdialog").getByRole("button", { name: "Mark all read" });
          if (await confirm.isVisible({ timeout: 1000 }).catch(() => false)) await confirm.click();
        },
        settle: async (p) => button(p).waitFor({ state: "detached" }),
        stored: async () =>
          threads(ctx.cli, "thread-glance.mark-all-read/cli").map((t) => ({ title: t.title, read: (t.lastReadAt ?? 0) >= (t.latestAttentionAt ?? 0) })),
      });
    },
  },

  settings: {
    usage: ": open the settings popover and read every control, the server's prefs and the browser's",
    async run({ page, url, capture, cli }) {
      await ready(page, url);
      await openSettings(page);
      await capture("settings", "open Thread Glance settings");
      return {
        controls: await controls(page),
        prefs: JSON.parse(cli("thread-glance.settings/cli", "thread-glance", "prefs", "list", "--json")),
        client: await clientPrefs(page),
      };
    },
  },

  set: {
    usage: "<control> <option|on|off|reverse>: change one popover control, e.g. set \"Settle after\" 12h",
    async run(ctx) {
      const name = control(ctx.args[0]);
      const c = CONTROLS[name];
      let target;
      return drive(ctx, {
        name: `set ${name} to ${ctx.args[1]}`,
        prepare: openSettings,
        observe: async (p) => (await controls(p))[name],
        act: async (p) => {
          if (c.kind === "reverse") {
            target = await locate(p, name).getAttribute("aria-label");
            await locate(p, name).click();
            return;
          }
          target = option(name, ctx.args[1]);
          if (c.kind === "radio") await locate(p, name).getByRole("radio", { name: target.label, exact: true }).click();
          else if ((await locate(p, name).getAttribute("aria-checked")) !== String(target.label === "on")) await locate(p, name).click();
        },
        settle: async (p) => {
          if (c.kind === "reverse") await p.getByRole("button", { name: /^Sort order: / }).and(p.locator(`:not([aria-label="${target}"])`)).waitFor();
          else await awaitControl(p, name, target.label);
        },
        stored: async (p) =>
          c.client
            ? { client: c.client, value: (await clientPrefs(p))?.[c.client] ?? null }
            : { key: c.key, value: await prefUntil(ctx.cli, "thread-glance.set/cli", c.key, target?.stored) },
      });
    },
  },

  "prefs-live": {
    usage: "<key> <value>: `bb thread-glance prefs set` while the popover is open, and wait for the popover to follow with no reload",
    async run(ctx) {
      const [key, value] = ctx.args;
      const name = Object.keys(CONTROLS).find((n) => CONTROLS[n].key === key && CONTROLS[n].kind !== "reverse");
      if (name === undefined) throw new Error(`no popover control shows ${key}; keys: ${Object.values(CONTROLS).map((c) => c.key).filter(Boolean).join(", ")}`);
      const target = option(name, value);
      return drive(ctx, {
        name: `bb thread-glance prefs set ${key} ${value}`,
        prepare: openSettings,
        observe: async (p) => (await controls(p))[name],
        act: async () => ctx.cli("thread-glance.prefs-cli/cli", "thread-glance", "prefs", "set", key, JSON.stringify(target.stored)),
        settle: async (p) => awaitControl(p, name, target.label),
        stored: async () => ({ key, value: await prefUntil(ctx.cli, "thread-glance.prefs-cli/cli", key) }),
      });
    },
  },

  settled: {
    usage: "[expand|collapse] [--advance <hours>]: click the first Settled (N) fold; --advance moves the page's clock forward that many hours first",
    valued: ["advance"],
    async run(ctx) {
      const hours = Number(ctx.flags.advance ?? 0);
      const fold = (p) => p.getByRole("button", { name: /^(Show|Hide) \d+ settled thread trees?$/ }).first();
      // Thread Glance reads Date.now() for settling; the page's clock moves it.
      const forward = async (p) => {
        if (hours > 0) await p.clock.fastForward(hours * 3_600_000);
      };
      if (hours > 0) {
        await ctx.page.clock.install();
        const original = ctx.newPage;
        ctx.newPage = async () => {
          const p = await original();
          await p.clock.install();
          return p;
        };
      }
      let want;
      return drive(ctx, {
        name: "click the Settled fold",
        prepare: async (p) => {
          await forward(p);
          await fold(p).waitFor({ timeout: 90_000 });
        },
        observe: async (p) => ({
          fold: await fold(p).getAttribute("aria-label"),
          text: (await fold(p).textContent()).trim(),
          expanded: (await fold(p).getAttribute("aria-expanded")) === "true",
          list: await readList(p),
        }),
        act: async (p) => {
          want = toggleTarget(ctx.args[0], (await fold(p).getAttribute("aria-expanded")) === "true");
          if (((await fold(p).getAttribute("aria-expanded")) === "true") !== want) await fold(p).click();
        },
        settle: async (p) => p.getByRole("button", { name: new RegExp(`^${want ? "Hide" : "Show"} \\d+ settled thread trees?$`) }).first().waitFor(),
        stored: async () => ({ openSettledFolds: await prefUntil(ctx.cli, "thread-glance.settled/cli", "openSettledFolds") }),
      });
    },
  },

  remount: {
    usage: "[--via automatic]: Settings → Appearance → Sidebar thread list → Thread list (built-in), then back to Thread Glance (or Automatic)",
    valued: ["via"],
    async run({ page, url, capture, cli, flags }) {
      const pick = async (item) => {
        await page.goto(`${url}settings/appearance`);
        await page.getByRole("button", { name: "Sidebar thread list" }).click();
        await page.getByRole("menuitem", { name: item }).click();
        await page.getByRole("menu", { name: "Sidebar thread list" }).waitFor({ state: "detached" });
      };
      const provider = () => JSON.parse(cli("thread-glance.remount/cli", "settings", "ui", "get", "sidebar.threadListProvider"));
      await ready(page, url);
      const before = { provider: provider(), list: await readList(page) };
      await capture("before", "Thread Glance mounted");
      await pick(/^Thread list \(built-in\)/);
      await page.goto(url);
      await page.getByRole("button", { name: "Thread Glance settings" }).waitFor({ state: "detached" });
      const away = { provider: provider(), threadGlanceShown: await header(page).isVisible() };
      await capture("unmounted", "Sidebar thread list → Thread list (built-in)");
      await pick(flags.via === "automatic" ? /^Automatic/ : /^Thread Glance /);
      await ready(page, url);
      const after = { provider: provider(), list: await readList(page) };
      await capture("remounted", `Sidebar thread list → ${flags.via === "automatic" ? "Automatic" : "Thread Glance"}`);
      return { before, away, after };
    },
  },
};
