/// <reference types="vite/client" />
// The right end of a row, measured in Chromium: nothing the hover shows
// covers anything, and the children chip never moves.
import "../testing/browser.css";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { cleanup, screen } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { PluginThreadListProps } from "@get-bb/plugin-sdk/app";
import { CLIENT_PREFERENCES_STORAGE_KEY, defaultPreferences, type ClientPreferences, type OrganizationMode, type Preferences } from "@/shared/preferences";
import { finishedUnread, makeThread, PROJECTS } from "../testing/fixtures";

type App = Awaited<ReturnType<typeof loadPluginApp>>;
let app: App;

beforeAll(async () => {
  app = await loadPluginApp(() => import("../../../app"));
});

/** Moves the pointer off every row, onto a strip below the list. */
async function pointerAway() {
  await userEvent.hover(awayStrip());
}

function awayStrip(): HTMLElement {
  let away = document.querySelector<HTMLElement>("[data-away]");
  if (away === null) {
    away = document.createElement("div");
    away.dataset.away = "";
    away.style.cssText = "position: fixed; left: 0; right: 0; bottom: 0; height: 8px";
    document.body.append(away);
  }
  return away;
}

afterEach(async () => {
  await pointerAway();
  cleanup();
  localStorage.clear();
});

interface Case {
  id: string;
  /** A root carries the pull request badge; a child, the hidden badge. */
  kind: "root" | "hidden-child";
  parent: boolean;
  unread: boolean;
  harness: boolean;
  machine: boolean;
}

// Every combination the right end can hold: children or none, Mark read or
// not, and the harness badge and machine name each shown or not, on roots,
// which carry the pull request badge on their title line. A hidden thread
// gets a row only as a child that needs attention, and its own children
// move up to the thread above it, so a row with the hidden badge has no children chip
// and no Mark read: those rows vary the harness badge and machine name.
const CASES: Case[] = [];
const caseId = (c: Omit<Case, "id">) =>
  `${c.kind === "root" ? "r" : "c"}${c.parent ? "p" : "n"}${c.unread ? "u" : "r"}${c.harness ? "h" : "x"}${c.machine ? "m" : "x"}`;
for (const harness of [true, false])
  for (const machine of [true, false]) {
    for (const parent of [true, false])
      for (const unread of [true, false]) {
        const c = { kind: "root" as const, parent, unread, harness, machine };
        CASES.push({ id: caseId(c), ...c });
      }
    const c = { kind: "hidden-child" as const, parent: false, unread: false, harness, machine };
    CASES.push({ id: caseId(c), ...c });
  }

// Hidden rows sit two levels down, where a row draws the ↳ marker.
const HOLDER = "holder";
const MIDDLE = "middle";
// Roots finish this long ago, to show `now`, `59m`, `23h`, `6d` and `99w`;
// hidden children wait on you for 59 minutes.
const AGES = [30_000, 59 * 60_000, 23 * 3_600_000, 6 * 86_400_000, 99 * 7 * 86_400_000 + 3_600_000];
const titleOf = (id: string) => `A long thread title that runs well past the sidebar's width before it ends ${id}`;

function threads() {
  return [
    makeThread({ id: HOLDER, title: "Holder" }),
    makeThread({ id: MIDDLE, title: "Middle", parentThreadId: HOLDER }),
    ...CASES.flatMap((c) => {
      const thread = makeThread({
        id: c.id,
        title: titleOf(c.id),
        ...(c.unread ? finishedUnread : {}),
        providerId: c.harness ? "codex" : "claude-code",
        host: c.machine ? { id: "host_2", name: "work" } : { id: "host_1", name: "Laptop" },
        environment: { branchName: `fix/${c.id}` },
        // A hidden thread gets a row while it waits on you.
        ...(c.kind === "hidden-child" ? { parentThreadId: MIDDLE, isHidden: true, hasPendingInteraction: true } : {}),
      });
      return c.parent ? [thread, makeThread({ id: `${c.id}-child`, parentThreadId: c.id })] : [thread];
    }),
  ];
}

const props: PluginThreadListProps = {
  activeThreadId: null,
  activeProjectId: null,
  isCompactViewport: false,
  onNavigate() {},
  searchQuery: "",
};

async function render(
  width: number,
  {
    density = "compact",
    organizationMode = "project",
    preferences: overrides = {},
    extraThreads = [],
  }: {
    density?: ClientPreferences["density"];
    organizationMode?: OrganizationMode;
    preferences?: Partial<Preferences>;
    extraThreads?: ReturnType<typeof makeThread>[];
  } = {},
) {
  // The frame is the sidebar, tall enough to draw every row.
  await page.viewport(width, 1600);
  localStorage.setItem(CLIENT_PREFERENCES_STORAGE_KEY, JSON.stringify({ density }));
  const preferences = { ...defaultPreferences(), settleAfter: "never" as const, organizationMode, ...overrides };
  renderSlot(app.threadLists[0]!, props, {
    rpc: {
      listPreferences: () => ({ preferences }),
      setPreference: ({ key, value }: { key: string; value: unknown }) => ({ key, value }),
      resetPreference: ({ key }: { key: string }) => ({ key, value: null }),
      importPreferences: () => ({ status: "already-imported" as const, source: null, keys: [] }),
      listStamps: () => ({
        stamps: {
          startedAt: {},
          finishedAt: Object.fromEntries(
            CASES.filter((c) => c.kind === "root").map((c, index) => [c.id, Date.now() - AGES[index % AGES.length]!]),
          ),
          pendingAt: Object.fromEntries(CASES.map((c) => [c.id, Date.now() - 59 * 60_000])),
          seenAt: {},
          idleAt: {},
        },
      }),
      markSeen: () => ({ at: Date.now() }),
      clearSeen: () => ({ ok: true as const }),
      listScheduled: () => ({ status: "ready" as const, scheduled: {} }),
      listNotes: () => ({ notes: {} }),
    } as never,
    sidebarThreads: { status: "ready", threads: [...threads(), ...extraThreads], projects: PROJECTS, sections: [] },
    sidebarPullRequests: Object.fromEntries(
      CASES.map((c) => [c.id, { number: 1234, title: "Fix", url: "u", state: "open", attention: "none" }]),
    ),
    providers: {
      status: "ready",
      providers: [
        { id: "claude-code", displayName: "Claude Code", logoUrl: null },
        { id: "codex", displayName: "Codex", logoUrl: null },
      ] as never,
    },
    sdk: {
      threads: { defaultExecutionOptions: async () => null, update: async () => ({}) } as never,
      projects: {
        get: async () => ({ sources: [{ hostId: "host_1", isDefault: true }] }),
        branches: async () => ({ defaultBranch: "main" }),
      } as never,
      providers: { models: async () => ({ models: [] }) } as never,
      system: {
        config: async () => ({
          primaryHostId: "host_1",
          generalSettings: { defaultProviderId: null },
          serverAccess: { defaultProviderId: "claude-code" },
        }),
      } as never,
    },
  } as never);
}

/** The parts of a row that can show, found by what a person reads on them. */
const PARTS = {
  status: () => ":scope > span:first-of-type",
  nested: () => 'span[title^="Child of"]',
  crossGroup: () => "[data-sidebar-thread-cross-project]",
  title: (c: Case) => `span[title="${titleOf(c.id)}"]`,
  hidden: () => '[aria-label="Hidden thread"]',
  pullRequest: () => '[aria-label^="Pull request #1234"]',
  harness: () => '[aria-label="Codex"]',
  machine: () => '[aria-label="On work"]',
  markRead: () => 'button[aria-label="Mark read"]',
  archive: () => 'button[aria-label="Archive thread"]',
  childrenChip: () => 'button[aria-label^="Show "], button[aria-label^="Collapse "]',
  time: () => '[aria-label^="Waiting on you"], [aria-label^="Finished"]',
  more: () => 'button[aria-label="Thread actions"]',
} as const;
type Part = keyof typeof PARTS;

interface Box {
  part: Part;
  rect: DOMRect;
}

function rowOf(c: Case): HTMLElement {
  const anchor = document.querySelector(`a[data-sidebar-thread-id="${c.id}"]`);
  if (anchor === null) throw new Error(`no row for ${c.id}`);
  return anchor.parentElement!;
}

/** The parts a person can see: laid out, not hidden and not faded out. */
function visibleBoxes(c: Case): Box[] {
  const row = rowOf(c);
  const boxes: Box[] = [];
  for (const part of Object.keys(PARTS) as Part[]) {
    const element = row.querySelector(PARTS[part](c));
    if (element === null) continue;
    if (!element.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
    const rect = element.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) boxes.push({ part, rect });
  }
  return boxes;
}

const overlap = (a: DOMRect, b: DOMRect) =>
  a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;

function expectNoOverlap(c: Case, boxes: Box[]) {
  const row = rowOf(c).getBoundingClientRect();
  for (const [i, a] of boxes.entries()) {
    expect(a.rect.right, `${c.id} ${a.part} inside the row`).toBeLessThanOrEqual(row.right + 0.5);
    for (const b of boxes.slice(i + 1)) {
      expect(overlap(a.rect, b.rect), `${c.id}: ${a.part} and ${b.part} overlap`).toBe(false);
    }
  }
}

/** Left to right, the parts shown, which must come in `order`. */
function expectOrder(c: Case, boxes: Box[], order: Part[]) {
  const shown = [...boxes].sort((a, b) => a.rect.left - b.rect.left).map((box) => box.part);
  expect(shown, c.id).toEqual(order.filter((part) => shown.includes(part)));
}

function expected(c: Case, hovered: boolean): Part[] {
  const middle: Part[] = hovered
    ? // Mark read shows on a root whose tree holds something unread.
      [...(c.unread && c.kind === "root" ? (["markRead"] as const) : []), "archive"]
    : [...(c.harness ? (["harness"] as const) : []), ...(c.machine ? (["machine"] as const) : [])];
  const badge: Part = c.kind === "root" ? "pullRequest" : "hidden";
  const lead: Part[] = c.kind === "hidden-child" ? ["status", "nested"] : ["status"];
  return [...lead, "title", badge, ...middle, ...(c.parent ? (["childrenChip"] as const) : []), hovered ? "more" : "time"];
}

/** The row shows what `expected` lists, in that order, with no two parts overlapping. */
function expectRowEnd(c: Case, hovered: boolean) {
  const boxes = visibleBoxes(c);
  const label = hovered ? `${c.id} hovered` : c.id;
  expect(boxes.map((box) => box.part).sort(), label).toEqual(expected(c, hovered).sort());
  expectOrder(c, boxes, expected(c, hovered));
  expectNoOverlap(c, boxes);
}

async function ready() {
  for (const c of CASES) await screen.findByRole("link", { name: new RegExp(`${c.id}\\b`) });
  // The pull request badges and the harness badges arrive after the rows.
  await expect.poll(() => document.querySelectorAll(PARTS.pullRequest()).length).toBe(CASES.filter((c) => c.kind === "root").length);
}

describe.each([240, 320, 400])("a row's right end at a %i px sidebar", (width) => {
  it("shows every part it should, in order, with nothing overlapping, at rest and on hover", async () => {
    await render(width);
    await ready();
    for (const c of CASES) {
      expectRowEnd(c, false);
      await userEvent.hover(rowOf(c));
      expectRowEnd(c, true);
      await pointerAway();
    }
  });

  it("keeps the children chip still and clickable on hover, 4 px before a trailing slot every row shares", async () => {
    await render(width);
    await ready();
    const slots = CASES.map((c) => rowOf(c).querySelector<HTMLElement>("[data-trailing-slot]")!.getBoundingClientRect());
    // One width and one right edge down the list, so times line up.
    for (const slot of slots) {
      expect(slot.width).toBe(slots[0]!.width);
      expect(slot.right).toBe(slots[0]!.right);
      expect(slot.width).toBeGreaterThanOrEqual(24);
    }
    for (const c of CASES) {
      const row = rowOf(c);
      const slot = row.querySelector<HTMLElement>("[data-trailing-slot]")!.getBoundingClientRect();
      const time = row.querySelector(PARTS.time())!.getBoundingClientRect();
      expect(time.right, `${c.id} time right-aligned`).toBeCloseTo(slot.right, 1);
      expect(time.width, `${c.id} time fits`).toBeLessThanOrEqual(slot.width);
      const chip = row.querySelector<HTMLButtonElement>(PARTS.childrenChip());
      if (!c.parent) {
        expect(chip, c.id).toBeNull();
        continue;
      }
      const rest = chip!.getBoundingClientRect();
      expect(slot.left - rest.right, `${c.id} children chip to slot`).toBeCloseTo(4, 1);

      await userEvent.hover(row);
      const hover = chip!.getBoundingClientRect();
      expect([hover.left, hover.top, hover.width, hover.height], `${c.id} children chip on hover`).toEqual([
        rest.left,
        rest.top,
        rest.width,
        rest.height,
      ]);
      const more = row.querySelector(PARTS.more())!.getBoundingClientRect();
      expect(more.right, `${c.id} "…" in the slot`).toBeCloseTo(slot.right, 1);
      const top = document.elementFromPoint(hover.left + hover.width / 2, hover.top + hover.height / 2);
      expect(chip!.contains(top), `${c.id} children chip on top`).toBe(true);
      await pointerAway();
    }
    // A click on a hovered row's children chip opens its children.
    const parent = CASES.find((c) => c.parent)!;
    const chip = rowOf(parent).querySelector<HTMLButtonElement>(PARTS.childrenChip())!;
    await userEvent.hover(rowOf(parent));
    await userEvent.click(chip);
    await expect.poll(() => chip.getAttribute("aria-expanded")).toBe("true");
  });
});

describe("a child thread's title", () => {
  const font = (element: Element) => {
    const style = getComputedStyle(element);
    return { fontSize: style.fontSize, lineHeight: style.lineHeight, fontWeight: style.fontWeight };
  };

  it.each(
    (["compact", "comfortable"] as const).flatMap((density) =>
      (["project", "chronological", "machine"] as const).map((organizationMode) => ({ density, organizationMode })),
    ),
  )("is drawn at a root's size, two levels down, in $density density grouped by $organizationMode", async (options) => {
    await render(320, options);
    // Both are read, so neither is bold.
    const root = CASES.find((c) => c.kind === "root" && !c.unread)!;
    const child = CASES.find((c) => c.kind === "hidden-child")!;
    for (const c of [root, child]) await screen.findByRole("link", { name: new RegExp(`${c.id}\\b`) });
    expect(rowOf(child).querySelector(PARTS.nested()), "the child is nested").not.toBeNull();
    const rootFont = font(rowOf(root).querySelector(PARTS.title(root))!);
    expect(font(rowOf(child).querySelector(PARTS.title(child))!)).toEqual(rootFont);
    expect(rootFont.fontWeight).toBe("400");
  });
});

describe("the sidebar's text sizes", () => {
  // Two unread threads in one worktree, to draw the environment fold outside the settled fold.
  const worktree = { id: "env_wt", isWorktree: true, branchName: "fix/shared" };
  const options = {
    preferences: { settleAfter: "12h" as const, environmentGrouping: true },
    extraThreads: [
      makeThread({ id: "wt-a", title: "Worktree A", environment: worktree, ...finishedUnread }),
      makeThread({ id: "wt-b", title: "Worktree B", environment: worktree, ...finishedUnread }),
    ],
  };

  /** Every laid-out element that holds text of its own, with the size it is drawn at. */
  function texts() {
    const found: { element: Element; text: string; size: number; height: number }[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const text = node.textContent!.trim();
      if (text === "") continue;
      const element = node.parentElement!;
      // dnd-kit's screen-reader instructions are never drawn.
      if (!element.checkVisibility()) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      found.push({ element, text, size: parseFloat(getComputedStyle(element).fontSize), height: range.getBoundingClientRect().height });
    }
    return found;
  }

  /** The ↳ mark, the shortcut label and the harness letter badge: the only fixed sizes. */
  const isMark = (element: Element) =>
    element.closest('span[title^="Child of"], kbd, [role="img"][aria-label="Codex"]') !== null;

  async function renderAll(width = 320) {
    await render(width, options);
    // Each kind of text is on screen, so none escapes the check.
    await screen.findByRole("button", { name: /^Show \d+ settled/ });
    await screen.findByRole("button", { name: /Collapse fix\/shared environment/ });
    expect(screen.getByRole("button", { name: /need you/ })).toBeTruthy();
    // The unread roots stay out of the fold, with every badge a row can carry.
    await expect.poll(() => document.querySelectorAll(PARTS.pullRequest()).length).toBeGreaterThan(0);
    for (const part of ["harness", "machine", "childrenChip", "time"] as const) {
      expect(document.querySelector(PARTS[part]()), part).not.toBeNull();
    }
  }

  it.each([240, 320])("draws nothing below 12 px but the three 10 px marks, and wraps nothing, at a %i px sidebar", async (width) => {
    await renderAll(width);
    for (const { element, text, size, height } of texts()) {
      if (isMark(element)) expect(size, text).toBe(10);
      else expect(size, text).toBeGreaterThanOrEqual(12);
      // Two lines would stand at least two font sizes tall.
      expect(height, `${text} on one line`).toBeLessThan(2 * size);
    }
  });

  it("takes every other size from bb's --text-xs and --text-sm", async () => {
    await renderAll();
    const root = document.documentElement.style;
    root.setProperty("--text-xs", "21px");
    root.setProperty("--text-sm", "23px");
    try {
      for (const { element, text, size } of texts()) {
        if (isMark(element)) expect(size, text).toBe(10);
        else expect([21, 23], text).toContain(size);
      }
    } finally {
      root.removeProperty("--text-xs");
      root.removeProperty("--text-sm");
    }
  });
});

// bb routes a row's link itself; here a followed link would unload the test.
document.addEventListener(
  "click",
  (event) => {
    if ((event.target as Element).closest("a[href]")) event.preventDefault();
  },
  true,
);

/** Whether a person sees the element: laid out and not faded out. */
const seen = (element: Element | null) =>
  element !== null && element.checkVisibility({ opacityProperty: true, visibilityProperty: true });

/** A root with children and something unread, so every hover action shows. */
const FULL = CASES.find((c) => c.kind === "root" && c.parent && c.unread)!;

/** The Alpha group's header, where every case lives. */
function header(): HTMLElement {
  return screen.getByRole("button", { name: /(Collapse|Expand) Alpha section/ }).closest<HTMLElement>('[data-sidebar="group-label"]')!;
}

function expectHeaderAtRest(label: string) {
  const at = header();
  expect(seen(at.querySelector('button[aria-label="New thread in Alpha"]')), `${label}: +`).toBe(false);
  expect(seen(at.querySelector('button[aria-label="Alpha actions"]')), `${label}: …`).toBe(false);
  expect(seen(at.querySelector('[role="group"]')), `${label}: counters`).toBe(true);
}

function expectHeaderActions(label: string) {
  const at = header();
  expect(seen(at.querySelector('button[aria-label="New thread in Alpha"]')), `${label}: +`).toBe(true);
  expect(seen(at.querySelector('button[aria-label="Alpha actions"]')), `${label}: …`).toBe(true);
}

/**
 * Clicks outside every row and menu, as a person dismisses a menu. An open
 * menu turns pointer events off on the page, so the click is forced to the
 * spot rather than waiting for the strip to take it.
 */
async function clickAway() {
  await userEvent.click(awayStrip(), { force: true });
}

// Wide enough that menus open as dropdowns rather than drawers.
const DESKTOP = 1024;

describe("the hover look after a click", () => {
  it("leaves a clicked row at rest once the pointer leaves it", async () => {
    await render(DESKTOP);
    await ready();
    await userEvent.click(rowOf(FULL).querySelector("a")!);
    await pointerAway();
    expectRowEnd(FULL, false);
  });

  it("leaves a row at rest after a click on any of its controls, a menu closed with the pointer included", async () => {
    await render(DESKTOP);
    await ready();
    for (const part of ["markRead", "archive", "childrenChip", "more"] as const) {
      await userEvent.hover(rowOf(FULL));
      await userEvent.click(rowOf(FULL).querySelector<HTMLElement>(PARTS[part]())!);
      if (part === "more") {
        await screen.findByRole("menu");
        await clickAway();
        await expect.poll(() => screen.queryByRole("menu")).toBeNull();
      }
      await pointerAway();
      expectRowEnd(FULL, false);
    }
  });

  it("leaves a clicked group header at rest once the pointer leaves it, after its chevron, + or … was clicked", async () => {
    await render(DESKTOP);
    await ready();
    const toggle = () => screen.getByRole("button", { name: /(Collapse|Expand) Alpha section/ });
    await userEvent.click(toggle());
    await pointerAway();
    expectHeaderAtRest("after collapsing");
    await userEvent.click(toggle());
    await pointerAway();
    expectHeaderAtRest("after expanding");
    await userEvent.hover(header());
    await userEvent.click(header().querySelector<HTMLElement>('button[aria-label="New thread in Alpha"]')!);
    await pointerAway();
    expectHeaderAtRest("after +");
    await userEvent.hover(header());
    await userEvent.click(header().querySelector<HTMLElement>('button[aria-label="Alpha actions"]')!);
    await screen.findByRole("menu");
    await clickAway();
    await expect.poll(() => screen.queryByRole("menu")).toBeNull();
    await pointerAway();
    expectHeaderAtRest("after a menu closed with the pointer");
  });

  it("shows a row's hover actions while keyboard focus is anywhere in it", async () => {
    await render(DESKTOP);
    await ready();
    const index = CASES.indexOf(FULL);
    // Focus the row above, then Tab: focus a key brought, as a person moves it.
    const previous = index > 0 ? rowOf(CASES[index - 1]!) : header();
    previous.querySelector<HTMLElement>("a, button")!.focus();
    const row = rowOf(FULL);
    await userEvent.keyboard("{Tab}");
    while (!row.contains(document.activeElement)) await userEvent.keyboard("{Tab}");
    const reached: string[] = [];

    while (row.contains(document.activeElement)) {
      reached.push(document.activeElement!.getAttribute("aria-label") ?? "");
      expectRowEnd(FULL, true);
      await userEvent.keyboard("{Tab}");
    }
    expect(reached.length, reached.join(", ")).toBeGreaterThanOrEqual(5);
  });

  it("shows a group header's + and … while keyboard focus is on any of its controls", async () => {
    await render(DESKTOP);
    await ready();
    const toggle = screen.getByRole("button", { name: /(Collapse|Expand) Alpha section/ });
    toggle.focus();
    await userEvent.keyboard("{Shift>}{Tab}{/Shift}");
    await userEvent.keyboard("{Tab}");
    expect(document.activeElement).toBe(toggle);
    expectHeaderActions("the chevron");
    await userEvent.keyboard("{Tab}");
    expect(document.activeElement?.getAttribute("aria-label")).toBe("New thread in Alpha");
    expectHeaderActions("+");
    await userEvent.keyboard("{Tab}");
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Alpha actions");
    expectHeaderActions("…");
  });
});
