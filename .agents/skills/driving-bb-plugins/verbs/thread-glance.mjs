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

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Set by a verb's --all-archived: each load presses Load more archived threads until every archived thread is drawn. */
let allArchived = false;

/** Loads the web UI and waits for Thread Glance's list header. */
export async function ready(page, url) {
  await page.goto(url);
  await header(page).waitFor();
  await page.waitForLoadState("networkidle");
  await openDrawer(page);
  if (allArchived) await loadAllArchived(page);
}

/** With Show archived on, presses Load more archived threads until it is gone; how many times. */
export async function loadAllArchived(page) {
  const more = page.getByRole("button", { name: "Load more archived threads" });
  // A window behind another draws no frames, so the list never loads more there.
  await page.bringToFront();
  let presses = 0;
  for (; presses < 100 && (await more.count()) > 0; presses++) {
    await more.click();
    await page.waitForLoadState("networkidle");
    await sleep(300);
  }
  // Pressing scrolled the list to its end; a load starts at the top.
  await scrollTo(page, 0);
  await sleep(300);
  return presses;
}

/** On a phone, opens the sidebar's drawer, which is off-canvas until then; nothing on a desktop. */
export async function openDrawer(page) {
  // In view means on top: the closed drawer keeps its box, under the main area.
  const inView = () =>
    header(page).evaluate((button) => {
      const box = button.getBoundingClientRect();
      const top = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
      return top !== null && button.contains(top);
    });
  if (await inView()) return;
  await page.getByRole("button", { name: /^Toggle sidebar/ }).click();
  for (let i = 0; i < 20 && !(await inView()); i++) await sleep(100);
  await sleep(400);
}

/** The settings button, which only Thread Glance's list header draws. */
export const header = (page) => page.getByRole("button", { name: "Thread Glance settings" });

/** A row's link, by thread title. */
export const row = (page, title) =>
  // Scoped to the list's own rows: a phone's home screen lists threads under the same names.
  page.getByRole("link", { name: new RegExp(`^Open ${esc(title)} — `) }).and(page.locator("[data-sidebar-thread-id]"));

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
  const rows = await page.getByRole("link", { name: /^Open .+ — / }).and(page.locator("[data-sidebar-thread-id]")).evaluateAll((els) =>
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

/**
 * The run's threads by title, from bb. Run through the harness as `cli` runs
 * it, with a larger buffer: at several hundred threads the list passes the
 * 1 MB that `cli`'s execFileSync holds.
 */
function threads(cli, label) {
  const out = execFileSync(process.env.DBP_HARNESS, ["bb", "--run", process.env.DBP_RUN, label, "--", "thread", "list", "--json"], {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const listed = JSON.parse(out);
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


// ——— The windowed list (#159): scrolling, menus, drag, keys and timings ———

/** The sidebar's scroll area around the list: its nearest vertically scrolling ancestor. */
const SCROLLER = `(() => {
  const list = document.querySelector("[data-sidebar-virtual-list]");
  for (let node = list?.parentElement; node && node !== document.body; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay") return node;
  }
  return document.scrollingElement;
})()`;

/**
 * What the window mounts against where the view is: rows mounted outside the
 * view extended 240 px, rows inside it left to spacers, and bb's keyboard
 * walk (anchors and spacers in DOM order, More aside) as thread ids.
 */
export async function readWindow(page) {
  return page.evaluate((scroller) => {
    const area = eval(scroller);
    const box = area === document.scrollingElement ? { top: 0, bottom: innerHeight } : area.getBoundingClientRect();
    const top = Math.max(box.top, 0) - 240;
    const bottom = Math.min(box.bottom, innerHeight) + 240;
    const list = document.querySelector("[data-sidebar-virtual-list]");
    const anchors = [...list.querySelectorAll("[data-sidebar-thread-id]")];
    // The first nine rows bb's jump keys reach stay mounted wherever the list is scrolled.
    const jumps = new Set(anchors.slice(0, 9));
    const outside = anchors.filter((a) => {
      if (jumps.has(a)) return false;
      const r = a.getBoundingClientRect();
      return r.bottom < top || r.top > bottom;
    }).length;
    let missing = 0;
    for (const spacer of list.querySelectorAll("[data-sidebar-windowed-nav]")) {
      const r = spacer.getBoundingClientRect();
      if (r.bottom > Math.max(box.top, 0) && r.top < Math.min(box.bottom, innerHeight)) missing += spacer.dataset.sidebarWindowedNav.split(" ").length;
    }
    const walk = [...document.querySelectorAll("[data-sidebar-thread-shortcut-target], [data-sidebar-windowed-nav]")]
      .filter((e) => e.closest('[data-sidebar-overflow="true"]') === null)
      .flatMap((e) => (e.hasAttribute("data-sidebar-windowed-nav") ? e.dataset.sidebarWindowedNav.split(" ").map((p) => p.split(":")[0]) : [e.dataset.sidebarThreadId]));
    return {
      scrollTop: Math.round(area.scrollTop),
      scrollHeight: area.scrollHeight,
      mounted: anchors.length,
      outside,
      missing,
      spacers: list.querySelectorAll("[data-sidebar-windowed-nav]").length,
      walk,
    };
  }, SCROLLER);
}

const scrollTo = (page, top) => page.evaluate(([scroller, y]) => { eval(scroller).scrollTop = y; }, [SCROLLER, top]);
const frames = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

/** Scrolls until `title`'s row is mounted and in view. */
export async function reveal(page, title) {
  const target = row(page, title);
  if ((await target.count()) === 0) {
    const height = await page.evaluate((s) => eval(s).scrollHeight, SCROLLER);
    for (let y = 0; y <= height && (await target.count()) === 0; y += 300) {
      await scrollTo(page, y);
      await frames(page);
    }
  }
  await target.scrollIntoViewIfNeeded();
  await frames(page);
  return target;
}

/** A group header's "…" or collapse button, by the group's label. */
const groupButton = (page, label, what) =>
  what === "menu"
    ? page.getByRole("button", { name: `${label} actions`, exact: true })
    : page.getByRole("button", { name: new RegExp(`^(Expand|Collapse) ${esc(label)} section$`) });

/** Where on a row a drop lands: its top quarter, middle half or bottom quarter. */
const ZONES = { top: 0.1, middle: 0.5, bottom: 0.9 };

/**
 * Presses on `from`, moves in steps to a point of `to`, and releases there,
 * as a person drags. A target out of the sidebar's view is reached as a
 * person reaches it: the pointer waits at the edge toward it while the list
 * scrolls, then moves onto it.
 */
async function dragTo(page, from, to, at = 0.5, { during } = {}) {
  const a = await from.boundingBox();
  const start = { x: a.x + Math.min(40, a.width / 2), y: a.y + a.height / 2 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x, start.y + 6, { steps: 3 });
  const view = await page.evaluate((scroller) => {
    const area = eval(scroller);
    const box = area === document.scrollingElement ? { top: 0, bottom: innerHeight } : area.getBoundingClientRect();
    return { top: Math.max(box.top, 0), bottom: Math.min(box.bottom, innerHeight) };
  }, SCROLLER);
  for (let i = 0; i < 80; i++) {
    const b = await to.boundingBox();
    const y = b === null ? null : b.y + b.height * at;
    if (y !== null && y > view.top + 30 && y < view.bottom - 30) break;
    const edge = y === null || y > view.bottom - 30 ? view.bottom - 3 : view.top + 3;
    await page.mouse.move(start.x, edge + (i % 2), { steps: 2 });
    await sleep(80);
  }
  // Off the edge, so auto-scroll stops before the target is measured.
  await page.mouse.move(start.x, (view.top + view.bottom) / 2, { steps: 4 });
  await sleep(300);
  const b = await to.boundingBox();
  const end = { x: b.x + Math.min(60, b.width / 2), y: b.y + b.height * at };
  await page.mouse.move(end.x, end.y, { steps: 12 });
  await frames(page);
  const feedback = await page.evaluate(() => {
    const drawn = document.querySelector("[data-sidebar-nest-target], [data-sidebar-reorder-placement]");
    const header = document.querySelector('[data-sidebar="group-label"].bg-sidebar-accent');
    return {
      over: drawn?.getAttribute("data-drop-thread-id") ?? null,
      nest: drawn?.getAttribute("data-sidebar-nest-target") ?? null,
      placement: drawn?.getAttribute("data-sidebar-reorder-placement") ?? null,
      header: header?.closest("section")?.getAttribute("aria-label") ?? null,
      dimmed: document.querySelectorAll(".opacity-50[data-sidebar-rename-row], .opacity-50[data-sidebar='group-label']").length,
    };
  });
  await during?.();
  await page.mouse.up();
  await frames(page);
  return feedback;
}

/** A thread's place in bb: its parent, section and pin. */
function placeOf(cli, label, title) {
  const t = threads(cli, label).find((x) => x.title === title);
  if (t === undefined) throw new Error(`no thread titled "${title}" in the run`);
  return { id: t.id, parentThreadId: t.parentThreadId ?? null, sectionId: t.sectionId ?? null, pinned: t.pinnedAt != null || t.isPinned === true };
}

/** The menu open now, a menu or a phone's drawer: its items in order, with each one's disabled state and submenu. */
async function readMenu(page) {
  await page.getByRole("menuitem").first().waitFor();
  return page.getByRole("menuitem").evaluateAll((items) =>
    items.map((i) => ({ label: i.textContent.trim(), disabled: i.getAttribute("aria-disabled") === "true" || i.hasAttribute("data-disabled"), submenu: i.getAttribute("aria-haspopup") === "menu" })),
  );
}

/** Where focus is: the element's role and accessible name. */
const focused = (page) =>
  page.evaluate(() => {
    const e = document.activeElement;
    return e === null || e === document.body ? null : { tag: e.tagName, role: e.getAttribute("role"), name: e.getAttribute("aria-label") ?? e.textContent.trim().slice(0, 60) };
  });

const toggleTarget = (arg, current) => (arg === undefined ? !current : ["expand", "on", "open"].includes(arg));


/**
 * Every row of the list, scrolling the windowed list from top to bottom:
 * each row's thread id, its link's name, the text it draws (title, note
 * line, time) and its time's full label. With `details`, each row is hovered
 * and its hover card's text read too.
 */
export async function collectRows(page, { details = false } = {}) {
  const first = page.locator("a[data-sidebar-thread-id]").first();
  if ((await first.count()) === 0) return [];
  // The nearest ancestor that scrolls, tagged so each step finds it again.
  await first.evaluate((a) => {
    let el = a.parentElement;
    while (el && !(el.scrollHeight > el.clientHeight && /auto|scroll/.test(getComputedStyle(el).overflowY))) el = el.parentElement;
    (el ?? document.scrollingElement).setAttribute("data-dbp-scroller", "");
  });
  const scroller = page.locator("[data-dbp-scroller]").first();
  await scroller.evaluate((el) => (el.scrollTop = 0));
  await sleep(200);
  const rows = new Map();
  let atEnd = false;
  for (let step = 0; step < 400; step++) {
    const seen = await page.locator("a[data-sidebar-thread-id]").evaluateAll((els) =>
      els.map((a) => ({
        id: a.dataset.sidebarThreadId,
        name: a.getAttribute("aria-label"),
        text: a.parentElement.innerText.split("\n").map((t) => t.trim()).filter(Boolean),
        time: a.parentElement.querySelector("[data-trailing-slot] [aria-label]")?.getAttribute("aria-label") ?? null,
      })),
    );
    for (const r of seen) {
      if (rows.has(r.id)) continue;
      // Hovered while the window draws it: a windowed row scrolled past is gone.
      const card = details ? await hoverCard(page, r.id) : undefined;
      rows.set(r.id, { ...parseRow(r.name), id: r.id, text: r.text, time: r.time, ...(details ? { card } : {}) });
    }
    // Stops one step after the end is reached, so the last window is read settled.
    if (atEnd) break;
    atEnd = await scroller.evaluate((el) => {
      el.scrollTop += el.clientHeight * 0.4;
      return el.scrollTop + el.clientHeight >= el.scrollHeight - 2;
    });
    await sleep(300);
  }
  await scroller.evaluate((el) => (el.scrollTop = 0));
  return [...rows.values()];
}

/** Hovers a row by thread id and returns its hover card's text, or null when none opened. */
export async function hoverCard(page, threadId) {
  const link = page.locator(`a[data-sidebar-thread-id="${threadId}"]`);
  if ((await link.count()) === 0) return null;
  await page.mouse.move(1400, 880);
  await sleep(150);
  await link.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
  const box = await link.boundingBox();
  if (box === null) return null;
  await page.mouse.move(box.x + 40, box.y + box.height / 2);
  await page.mouse.move(box.x + 48, box.y + box.height / 2, { steps: 3 });
  const card = page.locator("[data-radix-popper-content-wrapper]").filter({ hasText: /Harness/ }).last();
  const text = await card.waitFor({ timeout: 3000 }).then(() => card.innerText(), () => null);
  await page.mouse.move(1400, 880);
  await card.waitFor({ state: "detached", timeout: 3000 }).catch(() => {});
  return text === null ? null : text.split("\n").map((t) => t.trim()).filter(Boolean);
}

/**
 * Records every fetch and XHR the page makes, with the scripts on its call
 * stack (async stacks included) through the Chrome DevTools Protocol, and
 * the calling script: the first plugin bundle on the stack, else the first
 * script. Start it before the page loads.
 */
export async function recordRequests(page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Debugger.enable");
  await cdp.send("Debugger.setAsyncCallStackDepth", { maxDepth: 64 });
  const log = [];
  const scriptsOf = (stack) => {
    const urls = [];
    for (let s = stack; s; s = s.parent) for (const f of s.callFrames ?? []) if (f.url && !urls.includes(f.url)) urls.push(f.url);
    return urls;
  };
  cdp.on("Network.requestWillBeSent", (e) => {
    if (!["Fetch", "XHR"].includes(e.type)) return;
    const scripts = scriptsOf(e.initiator?.stack);
    const plugin = scripts.find((u) => u.includes("/plugin-app-assets/"));
    const u = new URL(e.request.url);
    const body = u.pathname.startsWith("/api/v1/plugins/thread-glance/") ? (e.request.postData ?? "").slice(0, 300) : undefined;
    log.push({ at: Date.now(), method: e.request.method, path: u.pathname + u.search, caller: plugin ?? scripts[0] ?? e.initiator?.url ?? null, ...(body ? { body } : {}) });
  });
  return {
    mark: () => log.length,
    since: (i = 0) => log.slice(i),
  };
}

/** Requests grouped by calling script, then by method and path. */
export function byCaller(requests) {
  const groups = {};
  for (const r of requests) {
    const key = r.caller ?? "(none)";
    groups[key] ??= { count: 0, requests: {} };
    groups[key].count += 1;
    const k = `${r.method} ${r.path.replace(/\?.*/, "")}`;
    groups[key].requests[k] = (groups[key].requests[k] ?? 0) + 1;
  }
  return { total: requests.length, byCaller: groups };
}

/** Thread Glance's own requests: its RPC and what its bundle asked bb for. */
export function glanceRequests(requests) {
  const rpc = requests.filter((r) => r.path.startsWith("/api/v1/plugins/thread-glance/"));
  const t0 = requests[0]?.at ?? 0;
  return { rpc: rpc.map((r) => r.path.replace("/api/v1/plugins/thread-glance/rpc/", "")), count: rpc.length, calls: rpc.map((r) => ({ ms: r.at - t0, method: r.path.split("/").pop(), body: r.body })) };
}

/**
 * Runs a drive's actions: each a `bb` argument array, run through the
 * harness, or { sleep: ms }, or { harness: [...] } for a harness command
 * such as spawn. Returns what each printed.
 */
function runActions(ctx, label, actions) {
  const out = [];
  for (const a of actions ?? []) {
    if (Array.isArray(a)) out.push({ bb: a, stdout: ctx.cli(label, ...a).slice(0, 2000) });
    else if (a.sleep) execFileSync("sleep", [String(a.sleep / 1000)]);
    else if (a.harness) out.push({ harness: a.harness, stdout: execFileSync(process.env.DBP_HARNESS, [a.harness[0], "--run", process.env.DBP_RUN, ...a.harness.slice(1)], { encoding: "utf8" }).trim() });
  }
  return out;
}

const readActions = (flags) => (flags.actions ? JSON.parse(readFileSync(flags.actions, "utf8")) : []);
const titlesOf = (flags) => (flags.details ? String(flags.details).split(",") : []);

/** Hover cards of the rows titled `titles`, scrolling each into view. */
async function cardsOf(page, titles) {
  const cards = {};
  for (const title of titles) {
    const id = await page.locator(`a[aria-label^="Open ${title} — "]`).first().getAttribute("data-sidebar-thread-id", { timeout: 1000 }).catch(() => null);
    cards[title] = id === null ? await scrollToCard(page, title) : await hoverCard(page, id);
  }
  return cards;
}

async function scrollToCard(page, title) {
  const row = (await collectRows(page)).find((r) => r.title === title);
  if (row === undefined) return "no such row";
  const scroller = page.locator("[data-dbp-scroller]").first();
  for (let i = 0; i < 200; i++) {
    if ((await page.locator(`a[data-sidebar-thread-id="${row.id}"]`).count()) > 0) return hoverCard(page, row.id);
    await scroller.evaluate((el) => (el.scrollTop += el.clientHeight * 0.6));
    await sleep(120);
  }
  return "row never drawn";
}

/**
 * Arms a recorder of the list's first drawn state: from the moment its header
 * is next in the DOM, the rows' names and texts at each of the first few DOM
 * changes, before any paint, with the time since arming.
 */
async function armFirstDraw(page) {
  await page.evaluate(firstDrawRecorder);
}

/** The recorder armFirstDraw runs in the page; also an init script, for a first load. */
function firstDrawRecorder() {
  window.__dbpFirstDraw = [];
  const t0 = performance.now();
  const snap = () => ({
    ms: Math.round(performance.now() - t0),
    header: !!document.querySelector('button[aria-label="Thread Glance settings"]'),
    rows: [...document.querySelectorAll("a[data-sidebar-thread-id]")].map((a) => ({
      name: a.getAttribute("aria-label"),
      text: a.parentElement.innerText.split("\n").map((t) => t.trim()).filter(Boolean),
    })),
    settled: [...document.querySelectorAll("button")].map((b) => b.getAttribute("aria-label") ?? "").filter((n) => /settled thread tree/.test(n)),
  });
  const start = () => {
    const obs = new MutationObserver(() => {
      const s = snap();
      if (!s.header) return;
      const last = window.__dbpFirstDraw.at(-1);
      if (last && JSON.stringify(last.rows) === JSON.stringify(s.rows) && JSON.stringify(last.settled) === JSON.stringify(s.settled)) return;
      window.__dbpFirstDraw.push(s);
      if (window.__dbpFirstDraw.length >= 8) obs.disconnect();
    });
    obs.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["aria-label"] });
  };
  if (document.documentElement) start();
  else document.addEventListener("readystatechange", start, { once: true });
}

const firstDrawOf = async (page) =>
  (await page.evaluate(() => window.__dbpFirstDraw ?? [])).map((d) => ({ ...d, rows: d.rows.map((r) => ({ ...parseRow(r.name), text: r.text })) }));

/** Turns the popover's Branch line on in this browser, as a user does. */
async function branchLineOn(page) {
  await openSettings(page);
  const box = locate(page, "Branch line");
  if ((await box.getAttribute("aria-checked")) !== "true") await box.click();
  await page.getByRole("checkbox", { name: /^Branch line/, checked: true }).waitFor();
  await page.keyboard.press("Escape");
  await popover(page).waitFor({ state: "hidden" });
}

/** Leaves for bb's Settings page through its sidebar link, with no reload. */
async function leaveForSettings(page) {
  await page.getByRole("link", { name: /^Settings/ }).first().click();
  await page.waitForURL(/\/settings/);
  await header(page).waitFor({ state: "detached" });
}


/** Marks the page's JavaScript realm, so a later check tells whether it reloaded. */
const markRealm = (page) => page.evaluate(() => (window.__dbpRealm = Math.random()));
const realmOf = (page) => page.evaluate(() => window.__dbpRealm ?? null);

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
        // The list mounts only rows near the view: scroll the parent's into it.
        prepare: async (p) => {
          await row(p, parent).or(p.locator("[data-sidebar-virtual-list]")).first().waitFor({ timeout: 30_000 });
          await reveal(p, parent);
          await chip(p, parent).waitFor({ timeout: 30_000 });
        },
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
  rows: {
    usage: "[--details] [--requests] [--first-draw] [--advance <hours>]: every row of the windowed list, scrolled top to bottom (name, drawn text, time); --details hovers each for its card; --requests adds the load's requests by calling script; --first-draw records the list at each of its first DOM changes from the load on; --advance starts the page's clock that many hours ahead; --warm loads once first and measures a reload (a device holding its preferences mirror); --delay-sync holds each `sync` answer that many ms, noting how many list states were drawn before it; --delay-branches the same for bb's project and branch lookups; --delay-ws holds the realtime socket's connection that many ms; --idle <s> then counts the requests of that many idle seconds",
    valued: ["advance", "delay-sync", "delay-branches", "delay-ws", "idle"],
    async run({ page, url, capture, flags }) {
      const rec = flags.requests || flags.idle || flags["delay-ws"] ? await recordRequests(page) : null;
      if (flags.advance) await page.clock.install({ time: Date.now() + Number(flags.advance) * 3_600_000 });
      if (flags.warm) await ready(page, url);
      if (flags["first-draw"]) await page.addInitScript(firstDrawRecorder);
      const held = [];
      if (flags["delay-sync"]) {
        // Holds each `sync` answer, noting how many list states were drawn before it was let through.
        await page.route("**/api/v1/plugins/thread-glance/rpc/sync", async (route) => {
          await sleep(Number(flags["delay-sync"]));
          const drawn = await page.evaluate(() => (window.__dbpFirstDraw ?? []).filter((d) => d.rows.length > 0).length).catch(() => null);
          held.push({ drawnBeforeAnswer: drawn });
          await route.continue();
        });
      }
      if (flags["delay-branches"]) {
        // Holds bb's project and default-branch lookups, noting how many list states were drawn before each answer.
        await page.route(/\/api\/v1\/projects\/proj_[^/?]+(\/branches)?(\?|$)/, async (route) => {
          await sleep(Number(flags["delay-branches"]));
          const drawn = await page.evaluate(() => (window.__dbpFirstDraw ?? []).filter((d) => d.rows.length > 0).length).catch(() => null);
          held.push({ url: new URL(route.request().url()).pathname, drawnBeforeAnswer: drawn });
          await route.continue();
        });
      }
      const socketEvents = [];
      if (flags["delay-ws"]) {
        // Holds the realtime socket's connection back, noting when it was let through.
        await page.routeWebSocket(/\/ws$/, async (ws) => {
          await sleep(Number(flags["delay-ws"]));
          socketEvents.push({ at: Date.now(), event: "socket let through" });
          ws.connectToServer();
        });
      }
      if (flags["idle"]) flags.requests = true;
      if (flags.warm) {
        await page.reload();
        await header(page).waitFor();
        await page.waitForLoadState("networkidle");
      } else await ready(page, url);
      await sleep(1500);
      await capture("list", "the list, loaded");
      const result = { list: await readList(page), rows: await collectRows(page, { details: Boolean(flags.details) }) };
      if (flags["first-draw"]) result.firstDraw = await firstDrawOf(page);
      if (flags["delay-sync"] || flags["delay-branches"]) result.held = held;
      if (rec !== null) {
        const load = rec.since(0);
        result.requests = { ...byCaller(load), threadGlance: glanceRequests(load) };
        if (socketEvents.length > 0) {
          const t0 = load[0]?.at ?? 0;
          result.socket = socketEvents.map((e) => ({ ...e, ms: e.at - t0 }));
        }
      }
      if (flags.idle) {
        const mark = rec.mark();
        await sleep(Number(flags.idle) * 1000);
        const idle = rec.since(mark);
        result.idle = { seconds: Number(flags.idle), ...byCaller(idle), threadGlance: glanceRequests(idle) };
      }
      return result;
    },
  },

  away: {
    usage: "[--actions <json file>] [--details <title,title>] [--times <n>] [--branch-line] [--settings]: load (turning Branch line on first with --branch-line), leave for bb's Settings page by its sidebar link (no reload), run the actions (bb argument arrays, {sleep: ms}, {harness: [...]}) while away, come back by history back, and report the first drawn list, the list once quiet, hover cards of --details, and with --requests every fetch by calling script on first load and on each return",
    valued: ["actions", "details", "times"],
    async run(ctx) {
      const { page, url, capture, flags } = ctx;
      const rec = await recordRequests(page);
      await ready(page, url);
      await sleep(2000);
      const firstLoad = rec.since(0);
      if (flags["branch-line"]) {
        await branchLineOn(page);
        await sleep(1000);
      }
      await markRealm(page);
      const realm = await realmOf(page);
      const before = { list: await readList(page), rows: await collectRows(page), cards: await cardsOf(page, titlesOf(flags)) };
      await capture("before", "loaded, before leaving");
      const trips = [];
      const times = Number(flags.times ?? 1);
      for (let trip = 0; trip < times; trip++) {
        const mark = rec.mark();
        await leaveForSettings(page);
        await capture("away", "Settings, list unmounted");
        const actions = trip === 0 ? runActions(ctx, "thread-glance.away/cli", readActions(flags)) : [];
        const whileAway = rec.since(mark);
        await armFirstDraw(page);
        const back = rec.mark();
        await page.goBack();
        await header(page).waitFor();
        await page.waitForLoadState("networkidle");
        await sleep(2000);
        const firstDraw = await firstDrawOf(page);
        await capture("back", "back from Settings");
        const returned = rec.since(back);
        let settings;
        if (flags.settings) {
          await openSettings(page);
          settings = await controls(page);
          await capture("back-settings", "the settings popover, back from Settings");
          await page.keyboard.press("Escape");
        }
        trips.push({
          actions,
          sameRealm: (await realmOf(page)) === realm,
          firstDraw,
          requestsWhileAway: byCaller(whileAway),
          requestsOnReturn: { ...byCaller(returned), threadGlance: glanceRequests(returned) },
          ...(settings ? { settings, requestsWithSettings: glanceRequests(rec.since(back)).rpc } : {}),
        });
      }
      const after = { list: await readList(page), rows: await collectRows(page), cards: await cardsOf(page, titlesOf(flags)) };
      await capture("after", "the list once quiet");
      return {
        firstLoad: { ...byCaller(firstLoad), threadGlance: glanceRequests(firstLoad) },
        before,
        trips,
        after,
        importAnswer: await page.evaluate(() => Object.fromEntries(Object.keys(localStorage).filter((k) => /thread-glance|import/i.test(k)).map((k) => [k, localStorage.getItem(k)]))),
      };
    },
  },

  reconnect: {
    usage: "[--actions <json file>] [--details <title,title>] [--down <s>]: load, cut the page's realtime socket and refuse it back while the actions run, let it back, and report the list and cards once quiet with no reload, and the requests after it came back",
    valued: ["actions", "details", "down"],
    async run(ctx) {
      const { page, url, capture, flags } = ctx;
      const rec = await recordRequests(page);
      let blocked = false;
      const live = [];
      const sockets = { opened: 0, refused: 0 };
      await page.routeWebSocket(/\/ws$/, (ws) => {
        if (blocked) {
          sockets.refused += 1;
          ws.close({ code: 1011, reason: "drive: realtime down" });
          return;
        }
        sockets.opened += 1;
        const server = ws.connectToServer();
        live.push({ ws, server });
      });
      await ready(page, url);
      await sleep(2000);
      await markRealm(page);
      const realm = await realmOf(page);
      const before = { list: await readList(page), rows: await collectRows(page), cards: await cardsOf(page, titlesOf(flags)) };
      await capture("before", "connected");
      blocked = true;
      for (const { ws, server } of live.splice(0)) {
        await server.close().catch(() => {});
        await ws.close({ code: 1011, reason: "drive: realtime down" }).catch(() => {});
      }
      await sleep(1500);
      const actions = runActions(ctx, "thread-glance.reconnect/cli", readActions(flags));
      await sleep(Number(flags.down ?? 3) * 1000);
      const during = { list: await readList(page), rows: await collectRows(page) };
      await capture("down", "realtime down, after the actions");
      const mark = rec.mark();
      const openedBefore = sockets.opened;
      blocked = false;
      for (let i = 0; i < 120 && sockets.opened === openedBefore; i++) await sleep(500);
      await page.waitForLoadState("networkidle");
      await sleep(3000);
      const returned = rec.since(mark);
      const after = { list: await readList(page), rows: await collectRows(page), cards: await cardsOf(page, titlesOf(flags)) };
      await capture("after", "realtime back, no reload");
      return {
        sockets,
        sameRealm: (await realmOf(page)) === realm,
        actions,
        before,
        during,
        after,
        requestsAfterReconnect: { ...byCaller(returned), threadGlance: glanceRequests(returned) },
      };
    },
  },

  live: {
    usage: "[--actions <json file>] [--until <regex>] [--details <title,title>] [--second-window] [--frames]: load (and a second window), run the actions, wait until a row's name matches --until in every window with no reload, and report each window's rows and cards and how long it took; --frames adds each realtime frame naming thread-glance the first window got from the actions on",
    valued: ["actions", "until", "details"],
    async run(ctx) {
      const { page, url, capture, newPage, flags } = ctx;
      const windows = [page];
      const frames = [];
      if (flags.frames) {
        // Passes the realtime socket through, keeping each server frame that names thread-glance.
        await page.routeWebSocket(/\/ws$/, (ws) => {
          const server = ws.connectToServer();
          ws.onMessage((m) => server.send(m));
          server.onMessage((m) => {
            if (typeof m === "string" && m.includes("thread-glance")) frames.push({ at: Date.now(), frame: m.slice(0, 600) });
            ws.send(m);
          });
        });
      }
      await ready(page, url);
      if (flags["second-window"]) {
        const second = await newPage();
        await ready(second, url);
        windows.push(second);
      }
      await sleep(1500);
      for (const w of windows) await markRealm(w);
      const realms = await Promise.all(windows.map(realmOf));
      await capture("before", "before the actions");
      const t0 = Date.now();
      const actions = runActions(ctx, "thread-glance.live/cli", readActions(flags));
      const acted = Date.now();
      const until = flags.until ? new RegExp(flags.until) : null;
      const reached = [];
      for (const w of windows) {
        let ms = null;
        if (until !== null) {
          const hit = await w.waitForFunction(
            (src) => [...document.querySelectorAll("a[data-sidebar-thread-id]")].some((a) => new RegExp(src).test(a.getAttribute("aria-label") ?? "")),
            until.source,
            { timeout: 60_000, polling: 100 },
          ).then(() => true, () => false);
          ms = hit ? Date.now() - acted : null;
        }
        reached.push(ms);
      }
      await sleep(1500);
      const states = [];
      for (const [i, w] of windows.entries()) {
        await w.bringToFront();
        states.push({
          window: i + 1,
          sameRealm: (await realmOf(w)) === realms[i],
          untilReachedMsAfterActions: reached[i],
          list: await readList(w),
          rows: await collectRows(w),
          cards: await cardsOf(w, titlesOf(flags)),
        });
        await capture(`window-${i + 1}`, `window ${i + 1} after the actions, no reload`, w);
      }
      return { actionsMs: acted - t0, actions, windows: states, ...(flags.frames ? { frames: frames.filter((f) => f.at >= t0).map((f) => ({ ms: f.at - t0, frame: f.frame })) } : {}) };
    },
  },
  "import-once": {
    usage: "[--actions <json file>] [--fail-first]: one browser profile through a first load, a reload, a trip to Settings and back, the actions (a plugin reload or update) and a reload after them, counting `importPreferences` at each; --fail-first makes the first load's import fail in the network, so no answer arrives",
    valued: ["actions"],
    async run(ctx) {
      const { page, url, capture, flags } = ctx;
      const rec = await recordRequests(page);
      let failing = Boolean(flags["fail-first"]);
      await page.route("**/api/v1/plugins/thread-glance/rpc/importPreferences", (route) => (failing ? ((failing = false), route.abort("failed")) : route.continue()));
      const imports = (from) => rec.since(from).filter((r) => r.path.endsWith("/rpc/importPreferences")).length;
      const stored = () => page.evaluate(() => Object.fromEntries(Object.keys(localStorage).filter((k) => /thread-glance/i.test(k)).map((k) => [k, localStorage.getItem(k)?.slice(0, 200)])));
      const steps = [];
      let mark = rec.mark();
      await ready(page, url);
      await sleep(2000);
      steps.push({ step: "first load", imports: imports(mark), stored: await stored() });
      await capture("first-load", "first load");
      mark = rec.mark();
      await page.reload();
      await header(page).waitFor();
      await page.waitForLoadState("networkidle");
      await sleep(2000);
      steps.push({ step: "reload", imports: imports(mark), stored: await stored() });
      mark = rec.mark();
      await leaveForSettings(page);
      await page.goBack();
      await header(page).waitFor();
      await page.waitForLoadState("networkidle");
      await sleep(2000);
      steps.push({ step: "Settings and back", imports: imports(mark) });
      mark = rec.mark();
      const actions = runActions(ctx, "thread-glance.import-once/cli", readActions(flags));
      await sleep(3000);
      await header(page).waitFor({ timeout: 30_000 }).catch(() => {});
      await page.waitForLoadState("networkidle");
      steps.push({ step: "the actions, no reload", actions, imports: imports(mark) });
      mark = rec.mark();
      await page.reload();
      await header(page).waitFor();
      await page.waitForLoadState("networkidle");
      await sleep(2000);
      steps.push({ step: "reload after the actions", imports: imports(mark), stored: await stored() });
      await capture("end", "after the last reload");
      return { steps, allRpc: glanceRequests(rec.since(0)).rpc };
    },
  },

  scroll: {
    usage: "[--step <px>]: scroll the sidebar top to bottom and back; at each step the rows mounted outside the view and margin, rows left out inside it, and whether bb's keyboard walk matches the top's",
    valued: ["step"],
    async run({ page, url, capture, flags }) {
      await ready(page, url);
      const step = Number(flags.step ?? 400);
      const first = await readWindow(page);
      await capture("top", "the sidebar at its top");
      const steps = [];
      const tops = [];
      for (let y = 0; y <= first.scrollHeight; y += step) tops.push(y);
      for (const y of [...tops, ...[...tops].reverse()]) {
        await scrollTo(page, y);
        await frames(page);
        await frames(page);
        const seen = await readWindow(page);
        steps.push({ scrollTop: seen.scrollTop, mounted: seen.mounted, outside: seen.outside, missing: seen.missing, spacers: seen.spacers, walkSame: JSON.stringify(seen.walk) === JSON.stringify(first.walk) });
      }
      await capture("bottom-and-back", "scrolled to the bottom and back to the top");
      return {
        threads: first.walk.length,
        steps,
        worst: { outside: Math.max(...steps.map((s) => s.outside)), missing: Math.max(...steps.map((s) => s.missing)), mounted: Math.max(...steps.map((s) => s.mounted)) },
        walkAlwaysSame: steps.every((s) => s.walkSame),
      };
    },
  },

  menu: {
    usage: "<row title> [--context|--keyboard-context|--keyboard] | --group <label>: open a row's \"…\" menu (or its context menu by right-click or Shift+F10, or \"…\" by Enter), or a group header's, read its items, close it with Escape and report where focus went",
    valued: ["group"],
    async run({ page, url, capture, args, flags }) {
      await ready(page, url);
      let opener;
      if (flags.group) {
        const header = page.locator('[data-sidebar="group-label"]').filter({ has: groupButton(page, flags.group, "toggle") });
        await header.hover();
        opener = groupButton(page, flags.group, "menu");
        await opener.click();
      } else {
        const link = await reveal(page, args[0]);
        const rowBox = link.locator("..");
        if (flags.context) await rowBox.click({ button: "right", position: { x: 40, y: 8 } });
        else if (flags["keyboard-context"]) {
          await link.focus();
          await page.keyboard.press("Shift+F10");
        } else {
          opener = rowBox.getByRole("button", { name: "Thread actions" });
          // On a phone the button is for screen readers only: reach it from the keyboard.
          if (!flags.mobile) await rowBox.hover();
          if (flags.keyboard || flags.mobile) {
            await opener.focus();
            await page.keyboard.press("Enter");
          } else await opener.click();
        }
      }
      const items = await readMenu(page);
      await capture("open", `open the ${flags.group ? `${flags.group} group's` : `${args[0]} row's`} ${flags.context || flags["keyboard-context"] ? "context menu" : "menu"}`);
      await page.keyboard.press("Escape");
      await page.getByRole("menuitem").first().waitFor({ state: "detached" });
      await capture("closed", "Escape");
      return { items, focusAfterEscape: await focused(page) };
    },
  },

  drag: {
    usage: "<title> (--onto <row title> [--zone top|middle|bottom] | --onto-group <label>): drag a row with the pointer onto another row's zone or a group header; the drop feedback while over it, and the thread's parent, section and pin in bb after",
    valued: ["onto", "zone", "onto-group"],
    async run({ page, url, capture, cli, args, flags }) {
      const [title] = args;
      await ready(page, url);
      const label = "thread-glance.drag/cli";
      const before = placeOf(cli, label, title);
      const source = (await reveal(page, title)).locator("..");
      const target = flags["onto-group"]
        ? page.locator('[data-sidebar="group-label"]').filter({ has: groupButton(page, flags["onto-group"], "toggle") })
        : row(page, flags.onto).locator("..");
      await capture("before", `before dragging ${title}`);
      const feedback = await dragTo(page, source, target, ZONES[flags.zone ?? "middle"]);
      await capture("after", `drop ${title} on ${flags["onto-group"] ?? `${flags.onto} (${flags.zone ?? "middle"})`}`);
      let after = before;
      for (let i = 0; i < 20; i++) {
        after = placeOf(cli, label, title);
        if (JSON.stringify(after) !== JSON.stringify(before)) break;
        await sleep(500);
      }
      return { feedback, before, after, list: await readList(page) };
    },
  },

  "drag-group": {
    usage: "<label> --onto <label> [--zone top|bottom]: drag a group header onto another's upper or lower half; the saved group order after",
    valued: ["onto", "zone"],
    async run({ page, url, capture, cli, args, flags }) {
      await ready(page, url);
      const header = (name) => page.locator('[data-sidebar="group-label"]').filter({ has: groupButton(page, name, "toggle") });
      const order = async () =>
        page.locator("section[data-sidebar-visibility-group]").evaluateAll((els) => els.filter((e) => !e.closest('[data-sidebar-overflow="true"]')).map((e) => e.getAttribute("aria-label")));
      const before = await order();
      await capture("before", `before dragging ${args[0]}`);
      const feedback = await dragTo(page, header(args[0]), header(flags.onto), flags.zone === "bottom" ? 0.9 : 0.1);
      await page.waitForFunction((was) => JSON.stringify([...document.querySelectorAll("section[data-sidebar-visibility-group]")].map((e) => e.getAttribute("aria-label"))) !== was, JSON.stringify(before), { timeout: 10_000 }).catch(() => {});
      await capture("after", `drop the ${args[0]} header on ${flags.onto}`);
      const mode = JSON.parse(cli("thread-glance.drag-group/cli", "thread-glance", "prefs", "get", "organizationMode"));
      const key = { project: "sectionOrder", chronological: "manualSectionOrder", machine: "machineSectionOrder" }[mode];
      return { feedback, before, after: await order(), stored: { key, value: await prefUntil(cli, "thread-glance.drag-group/cli", key) } };
    },
  },

  enter: {
    usage: "<title>: focus the row's link and press Enter; the row that is current after, and on a phone whether the drawer closed",
    async run({ page, url, capture, args, flags }) {
      await ready(page, url);
      const link = await reveal(page, args[0]);
      await link.focus();
      await capture("before", `focus ${args[0]}`);
      await page.keyboard.press("Enter");
      await row(page, args[0]).and(page.locator('[aria-current="page"]')).waitFor({ state: "attached" });
      await sleep(500);
      await capture("after", "Enter");
      // On a phone, opening a thread closes the drawer.
      const listInView = await header(page).evaluate((button) => {
        const box = button.getBoundingClientRect();
        const top = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
        return top !== null && button.contains(top);
      });
      return { url: page.url(), current: (await readList(page)).rows.find((r) => r.current)?.title ?? null, listInView };
    },
  },

  shortcut: {
    usage: "<n>|next|previous [--from <title>] [--scroll <px>] [--keys <chord>]: with the sidebar scrolled, press bb's jump key n (Control+Shift+n on the web) or next or previous thread (Control+Shift+] or [) from --from's thread; the thread opened against bb's keyboard walk",
    valued: ["from", "scroll", "keys"],
    async run({ page, url, capture, args, flags }) {
      await ready(page, url);
      if (flags.from) {
        await (await reveal(page, flags.from)).click();
        await row(page, flags.from).and(page.locator('[aria-current="page"]')).waitFor();
      }
      await scrollTo(page, Number(flags.scroll ?? 0));
      await frames(page);
      await frames(page);
      const { walk } = await readWindow(page);
      const current = page.url().match(/threads\/([^/?#]+)/)?.[1] ?? null;
      const step = { next: 1, previous: -1 }[args[0]];
      const next = step !== undefined;
      const chord = flags.keys ?? (step === 1 ? "Control+Shift+BracketRight" : step === -1 ? "Control+Shift+BracketLeft" : `Control+Shift+Digit${args[0]}`);
      await capture("before", `before ${chord}`);
      await page.keyboard.press(chord);
      await page.waitForURL((u) => !current || !u.href.includes(current), { timeout: 5_000 }).catch(() => {});
      await sleep(500);
      await capture("after", chord);
      const opened = page.url().match(/threads\/([^/?#]+)/)?.[1] ?? null;
      const expected = next ? walk[(walk.indexOf(current) + step + walk.length) % walk.length] : walk[Number(args[0]) - 1];
      const mounted = await page.locator(`[data-sidebar-thread-id="${expected}"]`).count();
      return { chord, current, expected, expectedWasMounted: mounted > 0, opened, same: opened === expected };
    },
  },

  split: {
    usage: "<title> [--from <title>] [--ctrl-click]: with --from's thread open, drag the row out of the sidebar onto the main area's right edge (or Ctrl+click it); the rows drawing their split mini-map after",
    valued: ["from"],
    async run({ page, url, capture, args, flags }) {
      await ready(page, url);
      if (flags.from) {
        await (await reveal(page, flags.from)).click();
        await row(page, flags.from).and(page.locator('[aria-current="page"]')).waitFor();
      }
      const link = await reveal(page, args[0]);
      await capture("before", `before splitting ${args[0]}`);
      if (flags["ctrl-click"]) await link.click({ modifiers: [process.platform === "darwin" ? "Meta" : "Control"] });
      else {
        const box = await link.boundingBox();
        const viewport = page.viewportSize();
        await page.mouse.move(box.x + 40, box.y + box.height / 2);
        await page.mouse.down();
        await page.mouse.move(box.x + 60, box.y + box.height / 2, { steps: 4 });
        await page.mouse.move(viewport.width - 60, viewport.height / 2, { steps: 20 });
        await sleep(300);
        await capture("dragging", "drag the row onto the main area's right edge");
        await page.mouse.up();
      }
      await sleep(1500);
      await capture("after", flags["ctrl-click"] ? "Ctrl+click" : "drop");
      const miniMaps = await page.locator("[data-sidebar-thread-id]").evaluateAll((els) =>
        els.filter((a) => a.parentElement.querySelector('[aria-label*="open in split"], [aria-label*="— open in split"]')).map((a) => a.getAttribute("aria-label")),
      );
      // bb's panes, one composer each.
      const panes = await page.getByRole("textbox").count();
      return { url: page.url(), rowsWithMiniMap: miniMaps, composers: panes };
    },
  },

  "long-press": {
    usage: "<title> [--move <px>]: on a phone (--mobile), press the row for 800 ms (moving the finger <px> first); the menu that opened, and what lifting chose",
    valued: ["move"],
    async run({ page, url, capture, args, flags }) {
      await ready(page, url);
      const link = await reveal(page, args[0]);
      const box = await link.boundingBox();
      const session = await page.context().newCDPSession(page);
      // One finger throughout: a point with no id reads as a new touch, not a move.
      const at = (dy) => [{ x: box.x + 40, y: box.y + box.height / 2 + dy, id: 1 }];
      await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: at(0) });
      if (flags.move) await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: at(Number(flags.move)) });
      await sleep(800);
      const items = (await page.getByRole("menuitem").count()) > 0 ? await readMenu(page) : null;
      await capture("pressed", `long-press ${args[0]}${flags.move ? `, moving ${flags.move} px` : ""}`);
      const before = page.url();
      await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await sleep(400);
      await capture("lifted", "lift the finger");
      // Lifting chooses nothing: the menu stays open, no item ran, and no thread opened.
      return { items, openAfterLift: (await page.getByRole("menuitem").count()) > 0, detailsOpened: (await page.getByRole("dialog", { name: args[0] }).count()) > 0, navigated: page.url() !== before };
    },
  },

  drawer: {
    usage: "[--open <title>]: on a phone (--mobile), open a thread from the sidebar's drawer, which closes it; the rows mounted with it closed, then open again",
    valued: ["open"],
    async run({ page, url, capture, flags }) {
      await ready(page, url);
      const title = flags.open ?? (await readList(page)).rows[0].title;
      await (await reveal(page, title)).click();
      await page.getByRole("dialog", { name: "Sidebar" }).waitFor({ state: "hidden" }).catch(() => {});
      await sleep(800);
      const mounted = () => page.locator("[data-sidebar-thread-id]").count();
      const closed = {
        mounted: await mounted(),
        listOnTop: await header(page).evaluate((button) => {
          const box = button.getBoundingClientRect();
          const top = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
          return top !== null && button.contains(top);
        }),
      };
      await capture("closed", `open ${title}, which closes the drawer`);
      await openDrawer(page);
      await sleep(400);
      const open = await readWindow(page);
      await capture("open", "open the drawer");
      return { closed, open: { mounted: open.mounted, outside: open.outside, missing: open.missing, walk: open.walk.length } };
    },
  },

  "key-drag": {
    usage: "<title> | --group <label>: focus a row's link (or a group header's collapse button) and press what starts a drag by keyboard (Space, then Enter on a header), arrows and Space again, then Escape; whether any drag feedback or pick-up was drawn, whether the thread's place or the group order changed, and every element in the list that carries aria-disabled",
    valued: ["group"],
    async run({ page, url, capture, cli, args, flags }) {
      await ready(page, url);
      const label = "thread-glance.key-drag/cli";
      const order = () =>
        page.locator("section[data-sidebar-visibility-group]").evaluateAll((els) => els.filter((e) => !e.closest('[data-sidebar-overflow="true"]')).map((e) => e.getAttribute("aria-label")));
      const ariaDisabled = () =>
        page.evaluate(() =>
          [...document.querySelectorAll("[aria-disabled]")]
            .filter((e) => e.closest("[data-sidebar-virtual-list], [data-sidebar='group-label'], section[data-sidebar-visibility-group]") !== null)
            .map((e) => ({ tag: e.tagName, role: e.getAttribute("role"), name: (e.getAttribute("aria-label") ?? e.textContent.trim()).slice(0, 80), value: e.getAttribute("aria-disabled") })),
        );
      const feedback = () =>
        page.evaluate(() => ({
          drop: document.querySelectorAll("[data-sidebar-nest-target], [data-sidebar-reorder-placement]").length,
          header: document.querySelectorAll('[data-sidebar="group-label"].bg-sidebar-accent').length,
          overlay: document.querySelectorAll("[data-dnd-overlay], [data-sidebar-drag-overlay]").length,
          announced: [...document.querySelectorAll('[role="status"], [aria-live]')].map((e) => e.textContent.trim()).filter((t) => /pick|drag|drop/i.test(t)),
        }));
      const before = flags.group ? { order: await order() } : placeOf(cli, label, args[0]);
      const target = flags.group ? groupButton(page, flags.group, "toggle") : await reveal(page, args[0]);
      await target.focus();
      const focusedBefore = await focused(page);
      await capture("focused", `focus ${flags.group ? `the ${flags.group} header` : args[0]}`);
      const seen = [];
      const keys = flags.group ? ["Space", "ArrowDown", "ArrowDown", "Space", "Enter", "ArrowUp", "Enter"] : ["Space", "ArrowDown", "ArrowDown", "Space"];
      for (const key of keys) {
        await page.keyboard.press(key);
        await frames(page);
        seen.push({ key, ...(await feedback()) });
      }
      await capture("pressed", `press ${keys.join(", ")}`);
      await page.keyboard.press("Escape");
      await sleep(1500);
      let after;
      if (flags.group) after = { order: await order() };
      else after = placeOf(cli, label, args[0]);
      // A header's Space and Enter toggle it; toggle it back where it moved.
      if (flags.group && (await groupButton(page, flags.group, "toggle").getAttribute("aria-expanded")) === "false") await groupButton(page, flags.group, "toggle").click();
      return {
        focusedBefore,
        steps: seen,
        dragStarted: seen.some((s) => s.drop > 0 || s.header > 0 || s.overlay > 0 || s.announced.length > 0),
        before,
        after,
        changed: JSON.stringify(before) !== JSON.stringify(after),
        url: page.url(),
        ariaDisabled: await ariaDisabled(),
      };
    },
  },
  "mark-all-read-home": {
    usage: "(--mobile): the phone home screen's Recent list, the unread threads it shows before Mark all read, right after it and 6 s later with no reload, and after a reload, beside the list's own",
    async run({ page, url, capture }) {
      const recentUnread = () =>
        page
          .getByRole("region", { name: "Recent" })
          .getByRole("link")
          .evaluateAll((els) => els.map((a) => a.getAttribute("aria-label") ?? "").filter((n) => / — Unread/.test(n)).map((n) => n.replace(/^Open /, "").replace(/ — .*/, "")));
      const closeDrawer = async () => {
        await page.keyboard.press("Escape");
        await page.getByRole("dialog", { name: "Sidebar" }).waitFor({ state: "hidden" }).catch(() => {});
        await sleep(400);
      };
      await page.goto(url);
      await header(page).waitFor();
      await page.waitForLoadState("networkidle");
      await sleep(1000);
      const before = await recentUnread();
      await capture("before", "the home screen before Mark all read");
      await openDrawer(page);
      const button = page.getByRole("button", { name: "Mark all read", exact: true });
      await button.click();
      const confirm = page.getByRole("alertdialog").getByRole("button", { name: "Mark all read" });
      if (await confirm.isVisible({ timeout: 1000 }).catch(() => false)) await confirm.click();
      await button.waitFor({ state: "detached" });
      const listUnread = (await readList(page)).rows.filter((r) => r.unread).map((r) => r.title);
      await closeDrawer();
      const after = await recentUnread();
      await capture("after", "Mark all read in the drawer, then the home screen with no reload");
      // bb refetches its sidebar data every few seconds, which also brings read state.
      await sleep(6000);
      const afterRefetch = await recentUnread();
      await page.reload();
      await header(page).waitFor();
      await page.waitForLoadState("networkidle");
      await sleep(1000);
      const reloaded = await recentUnread();
      await capture("reloaded", "the home screen after a reload");
      return { recentUnreadBefore: before, listUnreadAfter: listUnread, recentUnreadAfter: after, recentUnreadAfter6s: afterRefetch, recentUnreadAfterReload: reloaded };
    },
  },
};

// --all-archived on any verb: each load draws every archived thread first.
for (const verb of Object.values(verbs)) {
  const run = verb.run;
  verb.run = (ctx) => {
    allArchived = Boolean(ctx.flags["all-archived"]);
    return run(ctx);
  };
}
