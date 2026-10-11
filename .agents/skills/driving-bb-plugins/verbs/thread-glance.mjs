// Thread Glance's feature verbs: each drives one sub-feature of
// features/thread-glance.md through the sidebar or the settings page, with the
// roles and names the plugin gives its elements, and returns what the list
// showed before and after, what the plugin stored, and, with --second-window or
// --reload, what a second window showed with no reload or the same window
// after one.
//
//   drive-bb-plugins thread-glance --run <run> <verb> [args] [--second-window] [--reload] [--mobile] [--label <label>]
//
// The exported helpers (ready, readList, row, reveal, hoverCard, toasts) serve
// a new verb, and a `drive-bb-plugins ui` script looking at a screen before its
// verb exists, which imports them from
// process.env.DBP_SKILL + "/verbs/thread-glance.mjs".

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The project scope picker, the first thing the list draws. */
export const scopeButton = (page) => page.getByRole("button", { name: /^Project scope: / });

/** The shelf a verb's --shelf flag names: `ready` opens it on every load, so a row on a collapsed shelf is drawn. */
let shelfToOpen;

/** Loads the web UI and waits for Thread Glance's list. */
export async function ready(page, url) {
  await page.goto(url);
  await scopeButton(page).waitFor();
  await page.waitForLoadState("networkidle");
  await openDrawer(page);
  await openShelf(page, shelfToOpen);
}

/** On a phone, opens the sidebar's drawer, which is off-canvas until then; nothing on a desktop. */
export async function openDrawer(page) {
  // In view means on top: the closed drawer keeps its box, under the main area.
  const inView = () =>
    scopeButton(page).evaluate((button) => {
      const box = button.getBoundingClientRect();
      const top = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
      return top !== null && button.contains(top);
    });
  if (await inView()) return;
  await page.getByRole("button", { name: /^Toggle sidebar/ }).click();
  for (let i = 0; i < 20 && !(await inView()); i++) await sleep(100);
  await sleep(400);
}

/** A row's link, by thread title. */
export const row = (page, title) => page.locator("a[data-sidebar-thread-id]").and(page.getByRole("link", { name: title, exact: true }));

/** A row's card element: the frame holding its lines, buttons and chip. */
export const cardOf = (page, title) => row(page, title).locator("xpath=ancestor::div[@data-thread-id]");

/**
 * What the list shows: the scope, each shelf header, every mounted row in order
 * with the shelf it sits on and what its card draws, group headers, "Load N
 * more", and the states the list takes in place of rows.
 */
export async function readList(page) {
  // The list draws a change a frame or two after the server's signal reaches it.
  await frames(page);
  await sleep(300);
  await frames(page);
  return page.evaluate(() => {
    const lines = (el) => (el?.innerText ?? "").split("\n").map((t) => t.trim()).filter(Boolean);
    // The upper group (Pinned, Active) and the lower one (Working to Settled) are two lists.
    const lists = [...document.querySelectorAll("[data-item-list]")];
    const shelves = [];
    const groups = [];
    const rows = [];
    let shelf = null;
    let group = null;
    let more = null;
    for (const el of lists.flatMap((list) => [...list.children])) {
      if (el.dataset.shelf !== undefined) {
        shelf = el.dataset.shelf;
        group = null;
        const toggle = el.querySelector("button[aria-expanded]");
        shelves.push({
          shelf,
          label: toggle.innerText.trim(),
          expanded: toggle.getAttribute("aria-expanded") === "true",
          sort: el.querySelector("select")?.value ?? null,
          clean: el.querySelector("button")?.parentElement?.querySelector('button[aria-label="Close terminals and ports of settled threads"]') != null,
        });
      } else if (el.dataset.groupKey !== undefined) {
        const toggle = el.querySelector("button[aria-expanded]");
        group = toggle.getAttribute("aria-label");
        groups.push({ shelf, label: group, expanded: toggle.getAttribute("aria-expanded") === "true", text: lines(toggle) });
      } else if (el.dataset.rowId !== undefined) {
        const card = el.querySelector("[data-thread-id]");
        if (card === null) continue;
        const link = card.querySelector("a[data-sidebar-thread-id]");
        const titleEl = card.querySelector("[data-title]");
        const chip = card.querySelector("[data-children-chip]");
        const indicator = card.querySelector("[data-port-indicator]");
        rows.push({
          id: card.dataset.threadId,
          title: link?.getAttribute("aria-label") ?? titleEl?.textContent ?? null,
          shelf,
          group,
          card: card.dataset.card,
          current: link?.getAttribute("aria-current") === "page",
          openElsewhere: card.hasAttribute("data-open-elsewhere"),
          bold: titleEl === null ? null : Number(getComputedStyle(titleEl).fontWeight) >= 600,
          status: lines(card.querySelector("[data-status-slot]")).join(" "),
          woke: card.querySelector("[data-woke]") !== null,
          ports: indicator?.getAttribute("aria-label") ?? null,
          chip: chip === null ? null : { label: chip.getAttribute("aria-label"), expanded: chip.getAttribute("aria-expanded") === "true" },
          labels: [...card.querySelectorAll("[aria-label]")]
            .filter((e) => e.tagName !== "BUTTON" && e.tagName !== "A" && e !== indicator)
            .map((e) => e.getAttribute("aria-label")),
          buttons: [...card.querySelectorAll("button[aria-label]")].map((b) => b.getAttribute("aria-label")),
          text: lines(card),
          children: [...el.querySelectorAll("li[data-child-id]")].map((li) => ({
            id: li.dataset.childId,
            parent: li.dataset.childOfThread ?? null,
            title: li.querySelector("a")?.innerText.trim() ?? null,
            status: lines(li.querySelector("a")?.nextElementSibling).join(" "),
          })),
        });
      } else if (/^Load \d+ more$/.test(el.innerText.trim())) {
        more = el.innerText.trim();
      }
    }
    const body = document.body.innerText;
    return {
      scope: document.querySelector('button[aria-label^="Project scope: "]')?.getAttribute("aria-label").replace("Project scope: ", "") ?? null,
      shelves,
      groups,
      rows,
      loadMore: more,
      allClear: body.includes("All clear. Time to touch some grass."),
      loading: body.includes("Loading threads…"),
      failed: body.includes("Could not load threads."),
    };
  });
}

/** The toasts on screen: their lines and button labels. */
export const toasts = (page) =>
  page.locator("[data-sonner-toast]").evaluateAll((els) =>
    els.map((e) => ({
      lines: e.innerText.split("\n").map((t) => t.trim()).filter(Boolean),
      buttons: [...e.querySelectorAll("button")].map((b) => b.innerText.trim()).filter(Boolean),
    })),
  );

/** Waits up to `ms` for a toast whose text matches `re`; the toast's lines, else null. */
async function toastMatching(page, re, ms = 6000) {
  const toast = page.locator("[data-sonner-toast]").filter({ hasText: re }).first();
  return toast.waitFor({ timeout: ms }).then(
    async () => (await toasts(page)).find((t) => re.test(t.lines.join("\n"))) ?? null,
    () => null,
  );
}

/** The run's threads, from bb. */
function threads(cli, label) {
  const listed = JSON.parse(cli(label, "thread", "list", "--json"));
  return Array.isArray(listed) ? listed : listed.threads;
}

function threadId(cli, label, title) {
  const t = threads(cli, label).find((x) => x.title === title);
  if (t === undefined) throw new Error(`no thread titled "${title}" in the run`);
  return t.id;
}

/** An RPC of the plugin, called with a JSON input; its parsed answer. */
function rpc(cli, label, method, input) {
  const file = join(tmpdir(), `dbp-tg-${process.pid}-${method}.json`);
  writeFileSync(file, JSON.stringify(input));
  return JSON.parse(cli(label, "plugin", "rpc", "call", "thread-glance", method, "--input-file", file, "--json"));
}

/** What the plugin's server holds: settings, lifecycle rows by thread, the manual order. */
function synced(cli, label) {
  return rpc(cli, label, "sync", { since: null });
}

/** The workspace ports snapshot, read fresh from the machines. */
function portsSnapshot(cli, label) {
  return rpc(cli, label, "ports", { fresh: true });
}

/** Whether something accepts a connection on `port` of this machine, where the run's machine is. */
function listening(port) {
  const attempt = (host) =>
    new Promise((resolve) => {
      const socket = net.connect({ port, host });
      socket.once("connect", () => (socket.destroy(), resolve(true)));
      socket.once("error", () => resolve(false));
    });
  return Promise.all([attempt("127.0.0.1"), attempt("::1")]).then(([a, b]) => a || b);
}

async function waitListening(port, want, ms = 10_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if ((await listening(port)) === want) return true;
    await sleep(250);
  }
  return false;
}

/** The browser's own record of a device choice under `thread-glance:<key>`. */
const deviceState = (page, key) => page.evaluate((k) => JSON.parse(localStorage.getItem(`thread-glance:${k}`) ?? "null"), key);

/**
 * The shape every stateful verb shares: prepare a page, observe it, act,
 * wait for the result, read back what was stored, then report what a second
 * window (opened before the action) shows without a reload, and what this
 * window shows after one.
 */
async function drive(ctx, { name, prepare = async () => {}, observe, act, settle, stored = async () => null }) {
  const { page, url, capture, newPage, flags } = ctx;
  const load = ctx.ready ?? ready;
  await load(page, url);
  await prepare(page);
  let second = null;
  if (flags["second-window"]) {
    second = await newPage();
    await load(second, url);
    await prepare(second);
    await capture("second-before", "a second window, opened before the action", second);
    await page.bringToFront();
  }
  const before = await observe(page);
  await capture("before", `before ${name}`);
  await act(page);
  await settle(page);
  const after = await observe(page);
  await capture("after", name);
  const result = { before, after, stored: await stored(page) };
  if (second !== null) {
    await second.bringToFront();
    const followed = await Promise.race([settle(second).then(() => true, () => false), sleep(10_000).then(() => false)]);
    result.secondWindow = { followed, state: await observe(second) };
    await capture("second-after", `the second window, no reload (${followed ? "followed" : "did not follow within 10 s"})`, second);
  }
  if (flags.reload) {
    await page.reload();
    await (load === ready ? scopeButton(page).waitFor() : page.getByRole("combobox", { name: "Port link machine" }).waitFor());
    await prepare(page);
    const state = await observe(page);
    result.reloaded = { kept: JSON.stringify(state) === JSON.stringify(result.after), state };
    await capture("reloaded", "after a reload");
  }
  return result;
}


// ——— The windowed list: scrolling ———

/** The sidebar's scroll area around the list: the first `data-scroller` (the one scroller, or the upper one while shelves dock to the bottom). */
const SCROLLER = `(document.querySelector("[data-scroller]") ?? document.scrollingElement)`;

/**
 * What the window mounts against where the view is: rows mounted outside the
 * view extended 240 px, rows inside it left to spacers, and bb's keyboard
 * walk (anchors and spacers in DOM order) as thread ids.
 */
export async function readWindow(page) {
  return page.evaluate((scroller) => {
    const area = eval(scroller);
    const box = area === document.scrollingElement ? { top: 0, bottom: innerHeight } : area.getBoundingClientRect();
    const top = Math.max(box.top, 0) - 240;
    const bottom = Math.min(box.bottom, innerHeight) + 240;
    const lists = [...document.querySelectorAll("[data-item-list]")];
    const anchors = lists.flatMap((list) => [...list.querySelectorAll("a[data-sidebar-thread-id]")]);
    // The first nine rows bb's jump keys reach stay mounted wherever the list is scrolled.
    const jumps = new Set(anchors.slice(0, 9));
    const outside = anchors.filter((a) => {
      if (jumps.has(a)) return false;
      const r = a.getBoundingClientRect();
      return r.bottom < top || r.top > bottom;
    }).length;
    let missing = 0;
    const spacers = lists.flatMap((list) => [...list.querySelectorAll("[data-sidebar-windowed-nav]")]);
    for (const spacer of spacers) {
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
      spacers: spacers.length,
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
  if ((await target.count()) === 0) throw new Error(`no row "${title}" is drawn; if its shelf is collapsed, pass --shelf <name>`);
  await target.scrollIntoViewIfNeeded();
  await frames(page);
  return target;
}

/** Opens a collapsed shelf (by name) so its rows are drawn; nothing when `name` is undefined or the shelf is open. */
export async function openShelf(page, name) {
  if (name === undefined) return;
  const toggle = page.locator(`[data-shelf="${name}"] button[aria-expanded]`);
  if ((await toggle.getAttribute("aria-expanded")) === "false") {
    await toggle.click();
    await page.locator(`[data-shelf="${name}"] button[aria-expanded="true"]`).waitFor();
    await frames(page);
  }
}

/** Moves the pointer onto a row, as a person hovering it does, and waits for its hover actions to show. */
async function pointAt(page, title) {
  const link = await reveal(page, title);
  await page.mouse.move(1400, 880);
  await sleep(100);
  const box = await link.boundingBox();
  await page.mouse.move(box.x + 40, box.y + box.height / 2);
  await page.mouse.move(box.x + 48, box.y + box.height / 2, { steps: 3 });
  return link;
}

/** The hover card, opened by resting the pointer on a row; waits for the card to draw. */
export async function hoverCard(page, title) {
  await pointAt(page, title);
  const card = page.locator("[data-hover-card]");
  await card.waitFor({ timeout: 3000 });
  return card;
}

/** What a hover card shows: its lines, and each port entry with its process, link and Stop button. */
export async function readHoverCard(card) {
  return card.evaluate((el) => ({
    lines: el.innerText.split("\n").map((t) => t.trim()).filter(Boolean),
    portsHeading: [...el.querySelectorAll("span")].find((s) => /^Workspace ports \(\d+\)$/.test(s.textContent))?.textContent ?? null,
    ports: [...el.querySelectorAll("[data-port-entry]")].map((li) => {
      const button = li.querySelector("button");
      return {
        port: Number(li.dataset.portEntry),
        process: li.children[1]?.textContent ?? null,
        href: li.querySelector("a")?.getAttribute("href") ?? null,
        stop: button === null ? null : { name: button.getAttribute("aria-label"), text: button.textContent.trim(), armed: button.hasAttribute("data-stop-armed") },
      };
    }),
  }));
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

/** Opens a row's "Thread actions for <title>" menu with the pointer (hover first, as a person does). */
async function openRowMenu(page, title) {
  await pointAt(page, title);
  await cardOf(page, title).getByRole("button", { name: `Thread actions for ${title}` }).click();
  await page.getByRole("menu").waitFor();
}

const toggleTarget = (arg, current) => (arg === undefined ? !current : ["expand", "on", "open"].includes(arg));

/** The shelves' names as the list labels them, lower-cased to the id it keys them by. */
const SHELVES = ["pinned", "active", "working", "inactive", "snoozed", "parked", "settled"];


// ——— The settings page ———

const SETTINGS_PATH = "settings/plugins/thread-glance";

/** Every field of the settings page: its role, its stored key on the server, or "device" for what the browser keeps. */
export const FIELDS = {
  "Compact working threads": { role: "switch", key: "compactWorkingThreads" },
  "Working shelf": { role: "switch", key: "workingShelf" },
  "Inactive shelf": { role: "switch", key: "inactiveShelf" },
  "Hours before inactive": { role: "spinbutton", key: "hoursBeforeInactive" },
  "Dock shelves to the bottom": { role: "switch", key: "dockShelves" },
  "Project colors": { role: "switch", key: "projectColours" },
  "Show stripes in": { role: "combobox", key: "stripesIn" },
  "Snooze shortcuts": { role: "textbox", key: "snoozeShortcuts" },
  "Settle quiet threads": { role: "switch", key: "settleQuietThreads" },
  "Days before auto-settle": { role: "spinbutton", key: "daysBeforeAutoSettle" },
  "Settle merged pull requests": { role: "switch", key: "settleMergedPullRequests" },
  "Show children that need attention": { role: "switch", key: "showChildrenNeedingAttention" },
  Order: { role: "combobox", key: "childOrder" },
  Direction: { role: "combobox", key: "childDirection" },
  Icon: { role: "combobox", key: "childIcon" },
  "Port link machine": { role: "combobox", key: "device:portLinkMachine" },
};

/** Opens the settings page and waits for its fields. */
async function settingsReady(page, url) {
  await page.goto(url + SETTINGS_PATH);
  await page.getByRole("switch", { name: "Inactive shelf" }).waitFor();
  await page.getByRole("combobox", { name: "Port link machine" }).waitFor();
  await page.waitForLoadState("networkidle");
}

/** Every field's value on the page: on/off, the number or text, or the selected option's label. */
export async function readFields(page) {
  const state = {};
  for (const [name, { role }] of Object.entries(FIELDS)) {
    const el = page.getByRole(role, { name, exact: true });
    if ((await el.count()) === 0) {
      state[name] = null;
      continue;
    }
    if (role === "switch") state[name] = (await el.getAttribute("aria-checked")) === "true" ? "on" : "off";
    else if (role === "combobox") state[name] = await el.evaluate((s) => s.selectedOptions[0]?.textContent.trim() ?? null);
    else state[name] = await el.inputValue();
  }
  return state;
}

/** The settings page's heading status: "Saving…", "Saved" or "Not saved". */
const saveStatus = (page) => page.getByRole("status").evaluateAll((els) => els.map((e) => e.textContent.trim()).filter(Boolean));

/** Polls the server's settings until `key` holds `want`; the last value read. */
async function settingUntil(cli, label, key, want) {
  let value;
  for (let i = 0; i < 24; i++) {
    value = synced(cli, label).settings.value[key];
    if (want === undefined || JSON.stringify(value) === JSON.stringify(want)) return value;
    await sleep(500);
  }
  return value;
}

/** The server's lifecycle row for a thread, or null. */
function lifecycleOf(cli, label, id) {
  return synced(cli, label).records[id]?.lifecycle ?? null;
}

/** Polls until the thread's lifecycle row satisfies `ok`; the row last read. */
async function lifecycleUntil(cli, label, id, ok) {
  let row;
  for (let i = 0; i < 24; i++) {
    row = lifecycleOf(cli, label, id);
    if (ok(row)) return row;
    await sleep(500);
  }
  return row;
}


export const verbs = {
  list: {
    usage: "[--open <title>] [--wait <title>]: the scope, shelves, rows (shelf, card kind, status, port indicator, chip, buttons) and states; --wait first waits for a row, --open clicks it",
    valued: ["open", "wait"],
    async run({ page, url, capture, flags }) {
      await ready(page, url);
      if (flags.wait) await row(page, flags.wait).waitFor();
      const list = await readList(page);
      await capture("list", "the list");
      if (flags.open) {
        await (await reveal(page, flags.open)).click();
        await row(page, flags.open).and(page.locator('[aria-current="page"]')).waitFor();
        await capture("opened", `open ${flags.open}`);
        return { list, opened: await readList(page), url: page.url() };
      }
      return list;
    },
  },

  children: {
    usage: "<parent title> [expand|collapse]: press a parent's children chip; the chip, the child rows under the card, and the device's open parents",
    async run(ctx) {
      const { page, args, flags } = ctx;
      const [title, arg] = args;
      const chip = () => cardOf(page, title).locator("[data-children-chip]");
      const want = async () => toggleTarget(arg, (await chip().getAttribute("aria-expanded")) === "true");
      let target;
      return drive(ctx, {
        name: `${arg ?? "toggle"} the children of ${title}`,
        observe: async (p) => ({ chip: (await readList(p)).rows.find((r) => r.title === title)?.chip ?? null, children: (await readList(p)).rows.find((r) => r.title === title)?.children ?? [] }),
        act: async () => {
          target = await want();
          if ((await chip().getAttribute("aria-expanded")) === String(target)) return;
          await chip().click();
        },
        settle: (p) => cardOf(p, title).locator(`[data-children-chip][aria-expanded="${target}"]`).waitFor(),
        stored: async (p) => ({ expandedParents: await deviceState(p, "expandedParents") }),
      });
    },
  },

  shelf: {
    usage: "<pinned|active|working|inactive|snoozed|parked|settled> [expand|collapse]: press a shelf's header; its label ('Name (count)' while collapsed) and the device's collapsed shelves",
    async run(ctx) {
      const { page, args } = ctx;
      const [name, arg] = args;
      if (!SHELVES.includes(name)) throw new Error(`no shelf "${name}"; shelves: ${SHELVES.join(", ")}`);
      const toggle = (p) => p.locator(`[data-shelf="${name}"] button[aria-expanded]`);
      let target;
      return drive(ctx, {
        name: `${arg ?? "toggle"} the ${name} shelf`,
        observe: async (p) => (await readList(p)).shelves.find((s) => s.shelf === name) ?? null,
        act: async (p) => {
          target = toggleTarget(arg, (await toggle(p).getAttribute("aria-expanded")) === "true");
          if ((await toggle(p).getAttribute("aria-expanded")) === String(target)) return;
          await toggle(p).click();
        },
        settle: (p) => p.locator(`[data-shelf="${name}"] button[aria-expanded="${target}"]`).waitFor(),
        stored: async (p) => ({ collapsedShelves: await deviceState(p, "collapsedShelves") }),
      });
    },
  },

  sort: {
    usage: "<Manual order|Recent activity|Date created|Project>: pick Active's sort; the rows in order and the device's sort",
    async run(ctx) {
      const { page, args } = ctx;
      const select = (p) => p.getByRole("combobox", { name: "Sort Active" });
      return drive(ctx, {
        name: `Sort Active by ${args[0]}`,
        observe: async (p) => {
          const list = await readList(p);
          return { sort: await select(p).inputValue(), order: list.rows.filter((r) => r.shelf === "active").map((r) => r.title), groups: list.groups.map((g) => g.label) };
        },
        act: (p) => select(p).selectOption({ label: args[0] }),
        settle: (p) => select(p).evaluate((s, label) => s.selectedOptions[0].textContent === label, args[0]).then((ok) => ok || Promise.reject(new Error("sort not applied"))),
        stored: async (p) => ({ activeSort: await deviceState(p, "activeSort"), collapsedGroups: await deviceState(p, "collapsedGroups") }),
      });
    },
  },

  scope: {
    usage: "<project name|All projects>: pick the project scope; the rows and shelves it leaves",
    async run({ page, url, capture, args }) {
      await ready(page, url);
      const before = await readList(page);
      await capture("before", "before picking the scope");
      await scopeButton(page).click();
      const options = await page.getByRole("listbox", { name: "Projects" }).getByRole("option").evaluateAll((els) => els.map((e) => ({ name: e.textContent.trim(), selected: e.getAttribute("aria-selected") === "true" })));
      await capture("picker", "the project picker");
      if (args[0] !== undefined) {
        await page.getByRole("option", { name: args[0], exact: true }).click();
        await page.getByRole("button", { name: `Project scope: ${args[0]}` }).waitFor();
      } else await page.keyboard.press("Escape");
      const after = await readList(page);
      await capture("after", `scope ${args[0] ?? "(unchanged)"}`);
      return { options, before, after };
    },
  },

  hover: {
    usage: "<title>: rest the pointer on a row; the hover card's lines, its 'Workspace ports (N)' entries (port, process, link, Stop) and the card's port indicator",
    async run({ page, url, capture, cli, args }) {
      await ready(page, url);
      const card = await hoverCard(page, args[0]);
      // Ports arrive from the shared snapshot, so a card opened before it loads gains them a moment later.
      await sleep(500);
      const shown = await readHoverCard(card);
      await capture("hover", `hover ${args[0]}`);
      const list = (await readList(page)).rows.find((r) => r.title === args[0]);
      return { indicator: list?.ports ?? null, card: shown };
    },
  },

  stop: {
    usage: "<title> <port> [--once] [--expire]: press Stop on a hover card port entry, then Confirm stop (--once: only arm it; --expire: arm, wait 4.5 s and report whether it disarmed); whether the port still listens, the toast, and the fresh snapshot",
    async run({ page, url, capture, cli, args, flags }) {
      const [title, port] = [args[0], Number(args[1])];
      await ready(page, url);
      const card = await hoverCard(page, title);
      const entry = () => card.locator(`[data-port-entry="${port}"]`);
      await entry().waitFor();
      const before = { card: await readHoverCard(card), listening: await listening(port) };
      await capture("before", `hover ${title}`);
      await entry().getByRole("button", { name: new RegExp(`^Stop .* on port ${port}$`) }).click();
      const armed = (await readHoverCard(card)).ports.find((p) => p.port === port)?.stop ?? null;
      await capture("armed", "first press: Confirm stop");
      if (flags.expire) {
        await sleep(4500);
        const afterExpiry = (await readHoverCard(card)).ports.find((p) => p.port === port)?.stop ?? null;
        await capture("expired", "4.5 s later");
        return { before, armed, afterExpiry, listening: await listening(port) };
      }
      if (flags.once) return { before, armed, listening: await listening(port) };
      await entry().getByRole("button", { name: new RegExp(`^Confirm stopping .* on port ${port}$`) }).click();
      const toast = await toastMatching(page, /Stop requested|Could not stop/);
      const closed = await waitListening(port, false);
      await capture("after", "second press");
      return { before, armed, toast, closed, listening: await listening(port), snapshot: portsSnapshot(cli, "thread-glance.stop/snapshot") };
    },
  },

  "port-link": {
    usage: "<machine name|No machine> [--hover <title>]: choose the port link machine on the settings page (This device); the device's choice, and with --hover the hover card's links on the list",
    valued: ["hover"],
    async run(ctx) {
      const { page, url, capture, args, flags } = ctx;
      const select = (p) => p.getByRole("combobox", { name: "Port link machine", exact: true });
      const options = async (p) => select(p).evaluate((s) => [...s.options].map((o) => o.textContent.trim()));
      const result = await drive(
        { ...ctx, ready: settingsReady },
        {
          name: `Port link machine → ${args[0]}`,
          observe: async (p) => ({ chosen: await select(p).evaluate((s) => s.selectedOptions[0].textContent.trim()), options: await options(p) }),
          act: (p) => select(p).selectOption({ label: args[0] }),
          settle: (p) => select(p).evaluate((s, label) => s.selectedOptions[0].textContent.trim() === label || Promise.reject(new Error("not chosen")), args[0]),
          stored: async (p) => ({ portLinkMachine: await deviceState(p, "portLinkMachine") }),
        },
      );
      if (flags.hover) {
        await ready(page, url);
        const card = await hoverCard(page, flags.hover);
        await sleep(500);
        result.hover = await readHoverCard(card);
        await capture("hover", `hover ${flags.hover}`);
      }
      return result;
    },
  },

  lifecycle: {
    usage: "<snooze|park|resume|wake|unsettle|pin|unpin> <title> [<preset label>] [--menu]: snooze (a preset of the clock menu, default the first enabled), park, resume, wake now, un-settle, pin or unpin a thread, from the hover buttons or with --menu from its thread menu; the list before and after, the toasts and the server's lifecycle row",
    async run({ page, url, capture, cli, args, flags }) {
      const [action, title, preset] = args;
      await ready(page, url);
      const id = threadId(cli, "thread-glance.lifecycle/threads", title);
      const before = await readList(page);
      await capture("before", `before ${action} ${title}`);
      let clock;
      const menuItem = async (name, sub) => {
        await openRowMenu(page, title);
        if (sub !== undefined) {
          await page.getByRole("menuitem", { name: sub, exact: true }).hover();
          await page.getByRole("menuitem", { name: sub, exact: true }).press("ArrowRight");
        }
        await page.getByRole("menuitem", { name }).first().click();
      };
      const slimButton = { resume: "Resume thread", wake: "Wake thread now", unsettle: "Un-settle thread" }[action];
      const menuName = { park: "Park thread", resume: "Resume", wake: "Wake now", unsettle: "Un-settle", pin: "Pin" }[action];
      if (action === "snooze") {
        const presetName = preset === undefined ? /./ : new RegExp(`^${esc(preset)}`);
        const full = (await cardOf(page, title).getAttribute("data-card")) !== "slim";
        if (full && !flags.menu) {
          await pointAt(page, title);
          await page.getByRole("button", { name: `Snooze ${title}` }).click();
          await page.getByRole("menuitem").first().waitFor();
          const choices = await readMenu(page);
          await capture("clock-menu", "the clock menu");
          const items = page.getByRole("menuitem", { disabled: false }).filter({ hasText: presetName });
          await items.first().click();
          clock = choices;
        } else {
          await menuItem(presetName, "Snooze");
        }
      } else if (action === "unpin") {
        await pointAt(page, title);
        await page.getByRole("button", { name: `Unpin ${title}` }).click();
      } else if (!flags.menu && slimButton !== undefined && (await cardOf(page, title).getAttribute("data-card")) === "slim") {
        await pointAt(page, title);
        await page.getByRole("button", { name: slimButton }).click();
      } else {
        await menuItem(menuName);
      }
      const ok = {
        snooze: (r) => r?.snoozeUntil != null,
        park: (r) => r?.parkedAt != null,
        resume: (r) => r?.parkedAt == null,
        wake: (r) => r?.snoozeUntil == null,
        unsettle: (r) => r?.settledAt == null,
        pin: () => true,
        unpin: () => true,
      }[action];
      const lifecycle = await lifecycleUntil(cli, "thread-glance.lifecycle/sync", id, ok);
      await sleep(600);
      const toast = await toasts(page);
      const after = await readList(page);
      await capture("after", `${action} ${title}`);
      return { before, ...(clock ? { clockMenu: clock } : {}), toasts: toast, lifecycle, after };
    },
  },

  settle: {
    usage: "<title> [--menu] [--ports close|keep] [--unsettle-first]: settle a thread from its hover button (--menu: thread menu); the 'Close this thread's ports?' prompt it raises, answered with --ports (Close ports or Keep open), and whether each named port still listens; --unsettle-first un-settles through the server before answering",
    valued: ["ports"],
    async run({ page, url, capture, cli, args, flags }) {
      const title = args[0];
      await ready(page, url);
      const id = threadId(cli, "thread-glance.settle/threads", title);
      const before = await readList(page);
      await capture("before", `before settling ${title}`);
      if (flags.menu) {
        await openRowMenu(page, title);
        await page.getByRole("menuitem", { name: "Settle", exact: true }).click();
      } else {
        await pointAt(page, title);
        await page.getByRole("button", { name: `Settle ${title}` }).click();
      }
      const settled = await toastMatching(page, /Thread settled|Cannot settle/);
      const prompt = await toastMatching(page, /Close this thread's ports\?|its ports could not be checked/, 8000);
      const lifecycle = await lifecycleUntil(cli, "thread-glance.settle/sync", id, (r) => r?.settledAt != null);
      await capture("prompt", "after the settle");
      const ports = prompt === null ? [] : [...prompt.lines.join(" ").matchAll(/:(\d{2,5})\b/g)].map((m) => Number(m[1]));
      const result = { before, settled, prompt, promptPorts: ports, lifecycle, listeningBefore: Object.fromEntries(await Promise.all(ports.map(async (p) => [p, await listening(p)]))) };
      if (flags["unsettle-first"]) {
        rpc(cli, "thread-glance.settle/unsettle", "unsettle", { threadId: id });
        await sleep(2000);
        result.promptAfterUnsettle = (await toasts(page)).some((t) => /Close this thread's ports\?/.test(t.lines.join(" ")));
        await capture("unsettled", "the thread un-settled through the server");
      }
      if (flags.ports !== undefined) {
        const label = flags.ports === "close" ? "Close ports" : "Keep open";
        const button = page.locator("[data-sonner-toast]").filter({ hasText: "Close this thread's ports?" }).getByRole("button", { name: label });
        if ((await button.count()) === 0) result.answered = null;
        else {
          await button.click();
          result.answered = label;
          result.outcome = flags.ports === "close" ? await toastMatching(page, /Stop requested for port processes|Some port processes could not be stopped|No matching thread-owned ports|Could not close thread ports/) : null;
          await sleep(500);
          result.promptGone = (await toasts(page)).every((t) => !/Close this thread's ports\?/.test(t.lines.join(" ")));
          if (flags.ports === "close") result.listeningAfter = Object.fromEntries(await Promise.all(ports.map(async (p) => [p, await waitListening(p, false, 5000).then((closed) => !closed)])));
        }
        await capture("answered", `${label}`);
      }
      result.after = await readList(page);
      return result;
    },
  },

  clean: {
    usage: "[--run] [--wait <s>] [--refresh] [--cancel] [--scope <project>]: press Clean on the Settled header and read the 'Clean settled resources?' preview (threads, terminals, ports, warnings); --wait holds s seconds before --run (a preview lasts 120 s); --run presses Clean resources and reads the result; --refresh then presses Refresh preview if the preview expired; --cancel presses Cancel (Close when nothing was found)",
    valued: ["wait", "scope"],
    async run({ page, url, capture, cli, flags }) {
      await ready(page, url);
      if (flags.scope) {
        await scopeButton(page).click();
        await page.getByRole("option", { name: flags.scope, exact: true }).click();
      }
      const clean = page.getByRole("button", { name: "Close terminals and ports of settled threads" });
      const collapsedWhenPressed = (await page.locator('[data-shelf="settled"] button[aria-expanded]').getAttribute("aria-expanded")) === "false";
      await clean.click();
      const dialog = page.getByRole("alertdialog", { name: "Clean settled resources?" });
      await dialog.waitFor();
      await page.waitForFunction(() => !document.querySelector('[role="alertdialog"]')?.textContent.includes("Looking for terminals and ports"));
      const read = () =>
        dialog.evaluate((d) => ({
          lines: d.innerText.split("\n").map((t) => t.trim()).filter(Boolean),
          threads: [...d.querySelectorAll("[data-clean-thread]")].map((li) => ({ id: li.dataset.cleanThread, lines: li.innerText.split("\n").map((t) => t.trim()).filter(Boolean) })),
          buttons: [...d.querySelectorAll("button")].map((b) => ({ name: b.getAttribute("aria-label") ?? b.textContent.trim(), disabled: b.disabled })),
        }));
      const preview = await read();
      await capture("preview", "the Clean preview");
      const result = { collapsedWhenPressed, preview };
      if (flags.cancel) {
        await dialog.getByRole("button", { name: /^(Cancel|Close)$/ }).click();
        await dialog.waitFor({ state: "detached" });
        result.cancelled = true;
        return result;
      }
      if (flags.run) {
        if (flags.wait) await sleep(Number(flags.wait) * 1000);
        await dialog.getByRole("button", { name: "Clean resources" }).click();
        await page.waitForFunction(() => {
          const d = document.querySelector('[role="alertdialog"]');
          return d !== null && (d.querySelector("[data-clean-result]") !== null || /expired/.test(d.textContent));
        }, null, { timeout: 30_000 });
        result.result = await read();
        const refresh = dialog.getByRole("button", { name: "Refresh preview" });
        if (flags.refresh && (await refresh.count()) > 0) {
          await refresh.click();
          await page.waitForFunction(() => !document.querySelector('[role="alertdialog"]')?.textContent.includes("Looking for terminals and ports"));
          result.refreshed = await read();
        }
        result.toasts = await toasts(page);
        await capture("result", "after Clean resources");
        result.after = await readList(page);
      }
      return result;
    },
  },

  settings: {
    usage: "[--second-window]: the settings page's navigation, every field's value, the page status, and the server's stored settings",
    async run({ page, url, capture, cli }) {
      await settingsReady(page, url);
      const fields = await readFields(page);
      await capture("page", "the settings page");
      return {
        nav: await page.getByRole("navigation", { name: "Settings groups" }).getByRole("button").allTextContents(),
        groups: await page.getByRole("heading", { level: 3 }).allTextContents(),
        fields,
        status: await saveStatus(page),
        stored: synced(cli, "thread-glance.settings/sync").settings.value,
      };
    },
  },

  set: {
    usage: "<field> <value> [--second-window] [--reload]: change one settings-page field (switch: on|off; number or text: the value; select: the option's label) and wait for the server to hold it; the page status ('Saving…' then 'Saved'), the field before and after, and the stored value",
    async run(ctx) {
      const { page, cli, args } = ctx;
      const name = Object.keys(FIELDS).find((f) => f.toLowerCase() === String(args[0]).toLowerCase());
      if (name === undefined) throw new Error(`no field "${args[0]}"; fields: ${Object.keys(FIELDS).join(", ")}`);
      const { role, key } = FIELDS[name];
      const field = (p) => p.getByRole(role, { name, exact: true });
      const value = args[1];
      const wantsOn = value === "on";
      const reads = async (p) => ({ [name]: (await readFields(p))[name] });
      const done = async (p) => {
        if (role === "switch") await p.getByRole("switch", { name, exact: true, checked: wantsOn }).waitFor();
        else if (role === "combobox") await field(p).evaluate((s, label) => s.selectedOptions[0].textContent.trim() === label || Promise.reject(new Error("not selected")), value);
        else await field(p).evaluate((i, v) => i.value === v || Promise.reject(new Error("not typed")), value);
      };
      let statuses = [];
      return drive(
        { ...ctx, ready: settingsReady },
        {
          name: `${name} → ${value}`,
          observe: reads,
          act: async (p) => {
            if (role === "switch") {
              if ((await field(p).getAttribute("aria-checked")) === String(wantsOn)) return;
              await field(p).click();
            } else if (role === "combobox") await field(p).selectOption({ label: value });
            else await field(p).fill(value);
            for (let i = 0; i < 20; i++) {
              statuses = [...new Set([...statuses, ...(await saveStatus(p))])];
              if (statuses.includes("Saved")) break;
              await sleep(150);
            }
          },
          settle: done,
          stored: async (p) => ({ statuses, alerts: await p.getByRole("alert").allTextContents(), key, value: key.startsWith("device:") ? null : await settingUntil(cli, "thread-glance.set/sync", key, undefined) }),
        },
      );
    },
  },

  menu: {
    usage: "<title> [--context|--keyboard] [--sub <Snooze|Project>]: open a row's thread menu (the \"…\" button, a right-click, or the button by Enter), read its items (and a submenu's with --sub), and report where focus went on Escape",
    valued: ["sub"],
    async run({ page, url, capture, args, flags }) {
      const title = args[0];
      await ready(page, url);
      if (flags.context) {
        const link = await pointAt(page, title);
        await link.click({ button: "right", position: { x: 40, y: 8 } });
      } else if (flags.keyboard || flags.mobile) {
        await pointAt(page, title);
        const opener = cardOf(page, title).getByRole("button", { name: `Thread actions for ${title}` });
        await opener.focus();
        await page.keyboard.press("Enter");
      } else await openRowMenu(page, title);
      const items = await readMenu(page);
      await capture("open", `open ${title}'s thread menu`);
      let sub = null;
      if (flags.sub) {
        const trigger = page.getByRole("menuitem", { name: flags.sub, exact: true });
        await trigger.hover();
        await trigger.press("ArrowRight");
        await sleep(400);
        sub = (await page.getByRole("menuitem").evaluateAll((els) => els.map((e) => e.textContent.trim()))).filter((t) => !items.some((i) => i.label === t));
        await capture("submenu", `the ${flags.sub} submenu`);
      }
      await page.keyboard.press("Escape");
      if (sub !== null) await page.keyboard.press("Escape");
      await page.getByRole("menuitem").first().waitFor({ state: "detached" });
      return { items, submenu: sub, focusAfterEscape: await focused(page) };
    },
  },

  reorder: {
    usage: "<title> (up|down | --onto <title>): move a row one slot with Alt+Arrow Up or Down, or drag it with the pointer onto another row; the live-region announcement, the rows' order and the server's manual order",
    valued: ["onto"],
    async run({ page, url, capture, cli, args, flags }) {
      const [title, direction] = args;
      await ready(page, url);
      const names = new Map(threads(cli, "thread-glance.reorder/threads").map((t) => [t.id, t.title]));
      const order = () => synced(cli, "thread-glance.reorder/sync").order.value.map((id) => names.get(id) ?? id);
      const before = { rows: (await readList(page)).rows.map((r) => `${r.shelf}:${r.title}`), stored: order() };
      await capture("before", `before moving ${title}`);
      if (flags.onto) {
        const from = await reveal(page, title);
        const a = await from.boundingBox();
        await page.mouse.move(a.x + 40, a.y + a.height / 2);
        await page.mouse.down();
        await page.mouse.move(a.x + 40, a.y + a.height / 2 + 8, { steps: 3 });
        const to = await reveal(page, flags.onto);
        const b = await to.boundingBox();
        await page.mouse.move(b.x + 40, b.y + b.height / 2, { steps: 12 });
        await frames(page);
        await capture("dragging", "while dragging");
        await page.mouse.up();
      } else {
        const link = await reveal(page, title);
        await link.focus();
        await page.keyboard.press(`Alt+Arrow${direction === "up" ? "Up" : "Down"}`);
      }
      await sleep(800);
      const announcement = await page.locator('div.sr-only[role="status"]').allTextContents();
      const after = { rows: (await readList(page)).rows.map((r) => `${r.shelf}:${r.title}`), stored: order() };
      await capture("after", `moved ${title}`);
      return { announcement: announcement.filter(Boolean), toasts: await toasts(page), before, after };
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
      await scopeButton(page).waitFor({ state: "detached" });
      const away = { provider: provider(), threadGlanceShown: await scopeButton(page).isVisible() };
      await capture("unmounted", "Sidebar thread list → Thread list (built-in)");
      await pick(flags.via === "automatic" ? /^Automatic/ : /^Thread Glance /);
      await ready(page, url);
      const after = { provider: provider(), list: await readList(page) };
      await capture("remounted", `Sidebar thread list → ${flags.via === "automatic" ? "Automatic" : "Thread Glance"}`);
      return { before, away, after };
    },
  },

  enter: {
    usage: "<title>: focus the row's link and press Enter; the row that is current after, and on a phone whether the drawer closed",
    async run({ page, url, capture, args }) {
      await ready(page, url);
      const link = await reveal(page, args[0]);
      await link.focus();
      await capture("before", `focus ${args[0]}`);
      await page.keyboard.press("Enter");
      await row(page, args[0]).and(page.locator('[aria-current="page"]')).waitFor({ state: "attached" });
      await sleep(500);
      await capture("after", "Enter");
      // On a phone, opening a thread closes the drawer.
      const listInView = await scopeButton(page).evaluate((button) => {
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
      return { items, openAfterLift: (await page.getByRole("menuitem").count()) > 0, navigated: page.url() !== before };
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
      const inView = () =>
        scopeButton(page).evaluate((button) => {
          const box = button.getBoundingClientRect();
          const top = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
          return top !== null && button.contains(top);
        });
      const closed = { mounted: await page.locator("a[data-sidebar-thread-id]").count(), listOnTop: await inView() };
      await capture("closed", `open ${title}, which closes the drawer`);
      await openDrawer(page);
      await sleep(400);
      const open = await readWindow(page);
      await capture("open", "open the drawer");
      return { closed, open: { mounted: open.mounted, outside: open.outside, missing: open.missing, walk: open.walk.length } };
    },
  },
};

// Every verb takes --shelf <name>: the shelf its rows sit on, opened on each load (shelves start collapsed except Pinned, Active and Working).
for (const verb of Object.values(verbs)) {
  const run = verb.run;
  verb.valued = [...(verb.valued ?? []), "shelf"];
  verb.run = (ctx) => {
    shelfToOpen = ctx.flags.shelf;
    return run(ctx);
  };
}
