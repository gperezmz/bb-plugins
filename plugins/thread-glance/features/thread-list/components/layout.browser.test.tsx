/// <reference types="vite/client" />
// The list in Chromium, where layout is real: Dock shelves to the bottom, the
// windowed rows with their spacers, the edges' fade, and the shelf headers'
// rule and Clean button.
import "../testing/browser.css";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { cleanup, screen, waitFor } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { PluginSidebarThread, PluginSidebarThreadShortcut, PluginThreadListProps } from "@get-bb/plugin-sdk/app";
import { parkedRow, settledRow, snoozedRow } from "@/shared/lifecycle";
import { heightsFor } from "../model/heights";
import { createFakeServer, type FakeServerOptions } from "../testing/fake-server";
import { makeThread, PROJECTS } from "@/testing/fixtures";

type App = Awaited<ReturnType<typeof loadPluginApp>>;
let app: App;

beforeAll(async () => {
  app = await loadPluginApp(() => import("../../../app"));
  // Rows are links: the test page must not follow one.
  document.addEventListener("click", (event) => {
    if ((event.target as Element | null)?.closest?.("a[href]")) event.preventDefault();
  });
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const frames = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

const NOW = Date.now();
const props: PluginThreadListProps = { activeThreadId: null, activeProjectId: null, isCompactViewport: false, onNavigate() {}, searchQuery: "" };

async function render(
  threads: PluginSidebarThread[],
  server: FakeServerOptions = {},
  listProps: Partial<PluginThreadListProps> = {},
  height = 600,
  width = 360,
  sidebarShortcuts: Record<string, PluginSidebarThreadShortcut> = {},
) {
  await page.viewport(width, height);
  const slot = renderSlot(app.threadLists[0]!, { ...props, ...listProps }, {
    rpc: createFakeServer(server).handlers as never,
    sidebarThreads: { status: "ready", threads, projects: PROJECTS, sections: [] },
    sdk: {} as never,
    realtimeConnectionState: "connected",
    sidebarShortcuts,
  } as never);
  await waitFor(() => expect(document.querySelector("[data-list-ready]")).not.toBeNull());
  await frames();
  return slot;
}

const at = (minutesAgo: number) => ({ createdAt: NOW - minutesAgo * 60_000, updatedAt: NOW - minutesAgo * 60_000, latestAttentionAt: NOW - minutesAgo * 60_000 });
const old = { createdAt: NOW - 4 * 86_400_000, updatedAt: NOW - 3 * 86_400_000, latestAttentionAt: NOW - 3 * 86_400_000 };

describe("Dock shelves to the bottom", () => {
  const threads = [
    makeThread({ id: "a", title: "Active one", ...at(5) }),
    makeThread({ id: "s1", title: "Snoozed one", ...old }),
    makeThread({ id: "k1", title: "Parked one", ...old }),
  ];
  const rows = { s1: snoozedRow(NOW + 3_600_000, NOW - 1000), k1: parkedRow(NOW - 1000) };

  it("sits the lower group at the bottom of the viewport when it is on", async () => {
    await render(threads, { rows, settings: { dockShelves: true } });
    const lower = document.querySelector<HTMLElement>('[data-scroller="lower"]')!;
    const upper = document.querySelector<HTMLElement>('[data-scroller="upper"]')!;
    expect(lower).not.toBeNull();
    expect(Math.abs(lower.getBoundingClientRect().bottom - window.innerHeight)).toBeLessThanOrEqual(8);
    expect(lower.getBoundingClientRect().top).toBeGreaterThan(upper.getBoundingClientRect().top + 100);
    expect(screen.getByText("Active one")).toBeTruthy();
  });

  it("lets the lower group follow the upper one when it is off", async () => {
    await render(threads, { rows });
    expect(document.querySelector('[data-scroller="lower"]')).toBeNull();
    const list = document.querySelector<HTMLElement>('[data-scroller="list"]')!;
    const parked = screen.getByRole("button", { name: "Parked (1)" });
    expect(parked.getBoundingClientRect().bottom).toBeLessThan(list.getBoundingClientRect().top + 250);
  });
});

describe("the windowed rows", () => {
  const heights = heightsFor(false);
  const many = Array.from({ length: 400 }, (_, index) => makeThread({ id: `t${index}`, title: `Thread ${index}`, ...at(10 + index) }));
  const order = many.map((thread) => thread.id);
  const scroller = () => document.querySelector<HTMLElement>('[data-scroller="list"]')!;
  const mountedIds = () => [...document.querySelectorAll<HTMLElement>("[data-row-id]")].map((row) => row.dataset.rowId!);

  it("mounts only the rows near the view, with a spacer as tall as the rows it stands in for", async () => {
    await render(many, { order, settings: { inactiveShelf: false } });
    const ids = mountedIds();
    expect(ids.length).toBeLessThan(40);
    expect(ids[0]).toBe("t0");
    const spacers = [...document.querySelectorAll<HTMLElement>("[data-sidebar-windowed-nav]")];
    const spacerHeight = spacers.reduce((total, spacer) => total + spacer.getBoundingClientRect().height, 0);
    expect(spacerHeight).toBe((400 - ids.length) * heights.fullCard);
  });

  it("draws every row at the height the heights model says", async () => {
    await render(many.slice(0, 20), { order, settings: { inactiveShelf: false } });
    for (const wrapper of document.querySelectorAll<HTMLElement>("[data-row-id]")) {
      expect(wrapper.getBoundingClientRect().height).toBe(heights.fullCard);
    }
    const list = scroller();
    expect(list.scrollHeight - parseFloat(getComputedStyle(list).paddingBottom)).toBeGreaterThanOrEqual(heights.shelfHeader + 20 * heights.fullCard);
  });

  it("mounts the rows that scroll into view and unmounts the ones left far behind, keeping the first nine and the open thread", async () => {
    await render(many, { order, settings: { inactiveShelf: false } }, { activeThreadId: "t300" });
    expect(mountedIds()).toContain("t300");
    scroller().scrollTop = 150 * heights.fullCard;
    await waitFor(() => expect(mountedIds()).toContain("t150"));
    await frames();
    const ids = mountedIds();
    expect(ids).toContain("t300");
    for (const keep of ["t0", "t1", "t8"]) expect(ids).toContain(keep);
    expect(ids).not.toContain("t60");
    expect(ids.length).toBeLessThan(60);
  });

  it("fades the edges by up to 12 px and shows no scrollbar", async () => {
    await render(many, { order, settings: { inactiveShelf: false } });
    const list = scroller();
    expect(list.style.getPropertyValue("--tg-fade-top")).toBe("0px");
    expect(list.style.getPropertyValue("--tg-fade-bottom")).toBe("12px");
    list.scrollTop = 5;
    await waitFor(() => expect(list.style.getPropertyValue("--tg-fade-top")).toBe("5px"));
    list.scrollTop = 500;
    await waitFor(() => expect(list.style.getPropertyValue("--tg-fade-top")).toBe("12px"));
    expect(list.offsetWidth).toBe(list.clientWidth);
  });
});

describe("the cards' lines", () => {
  const heights = heightsFor(false);
  const threads = [
    makeThread({ id: "full", title: "A title that is far too long to fit on one line of a narrow sidebar column", ...at(5), isPinned: true, pinnedAt: NOW, activity: { workflows: 2, backgroundAgents: 1 }, environment: { branchName: "feature/a-branch-with-a-very-long-name" } }),
    makeThread({ id: "work", title: "Working one", ...at(6), status: "active", runtimeStatus: "active", indicator: "runtime" }),
    makeThread({ id: "pk", title: "Parked one", ...old }),
  ];
  const draw = (compactWorkingThreads: boolean) => render(threads, { rows: { pk: parkedRow(NOW - 86_400_000) }, settings: { compactWorkingThreads, inactiveShelf: false }, order: ["full", "work", "pk"] });
  const card = (id: string) => document.querySelector<HTMLElement>(`[data-card][data-thread-id="${id}"]`)!;

  it("fits each card in its height and its width, truncating what is too long", async () => {
    await draw(false);
    screen.getByRole("button", { name: "Parked (1)" }).click();
    await waitFor(() => expect(card("pk")).not.toBeNull());
    await frames();
    const expected = { full: heights.fullCard, work: heights.fullCard, pk: heights.slimRow };
    for (const [id, height] of Object.entries(expected)) {
      const el = card(id);
      expect(el.getBoundingClientRect().height, id).toBe(height);
      expect(el.scrollHeight, id).toBeLessThanOrEqual(el.clientHeight);
      expect(el.scrollWidth, id).toBeLessThanOrEqual(el.clientWidth);
    }
  });

  it("fits a folded card in one line", async () => {
    await draw(true);
    const el = card("work");
    expect(el.dataset.card).toBe("folded");
    expect(el.getBoundingClientRect().height).toBe(heights.foldedCard);
    expect(el.scrollHeight).toBeLessThanOrEqual(el.clientHeight);
    expect(el.scrollWidth).toBeLessThanOrEqual(el.clientWidth);
  });

  it("keeps a folded card's title readable beside the Children chip at the default sidebar width", async () => {
    const family = [
      makeThread({ id: "boss", title: "boss", ...at(6), status: "active", runtimeStatus: "active", indicator: "runtime" }),
      makeThread({ id: "k1", title: "kid one", parentThreadId: "boss", ...at(5) }),
      makeThread({ id: "k2", title: "kid two", parentThreadId: "boss", ...at(4) }),
      makeThread({ id: "k3", title: "kid three", parentThreadId: "boss", ...at(3) }),
    ];
    await render(family, { settings: { compactWorkingThreads: true, inactiveShelf: false } }, {}, 600, 255);
    const boss = card("boss");
    expect(boss.dataset.card).toBe("folded");
    expect(boss.querySelector("[data-children-chip]")).not.toBeNull();
    expect(boss.querySelector<HTMLElement>("[data-title]")!.getBoundingClientRect().width).toBeGreaterThanOrEqual(48);
    expect(boss.scrollWidth).toBeLessThanOrEqual(boss.clientWidth);
    const chip = boss.querySelector<HTMLElement>("[data-children-chip]")!;
    expect(chip.getBoundingClientRect().right).toBeLessThanOrEqual(boss.querySelector("[data-status-slot]")!.getBoundingClientRect().left);
    expect(chip.scrollWidth).toBeLessThanOrEqual(chip.clientWidth);
  });

  it("keeps a slim row's title readable beside the Children chip at the default sidebar width", async () => {
    const family = [
      makeThread({ id: "boss", title: "boss", ...old }),
      makeThread({ id: "k1", title: "kid one", parentThreadId: "boss", ...old }),
      makeThread({ id: "k2", title: "kid two", parentThreadId: "boss", ...old }),
      makeThread({ id: "k3", title: "kid three", parentThreadId: "boss", ...old }),
    ];
    await render(family, { rows: { boss: parkedRow(NOW - 86_400_000) }, settings: { inactiveShelf: false } }, {}, 600, 255);
    screen.getByRole("button", { name: "Parked (1)" }).click();
    await waitFor(() => expect(document.querySelector('[data-card="slim"]')).not.toBeNull());
    await frames();
    const boss = card("boss");
    expect(boss.dataset.card).toBe("slim");
    expect(boss.querySelector("[data-children-chip]")).not.toBeNull();
    expect(boss.querySelector<HTMLElement>("[data-title]")!.getBoundingClientRect().width).toBeGreaterThanOrEqual(48);
    expect(boss.scrollWidth).toBeLessThanOrEqual(boss.clientWidth);
  });

  describe("a hovered slim row with a Children chip", () => {
    const family = (id: string) => [
      makeThread({ id, title: "Investigate flaky checkout tests on CI", ...old }),
      makeThread({ id: `${id}1`, title: "kid one", parentThreadId: id, ...old }),
      makeThread({ id: `${id}2`, title: "kid two", parentThreadId: id, ...old }),
    ];
    const hovered = async (width: number, shelf: "Parked" | "Settled") => {
      const rows = shelf === "Parked" ? { boss: parkedRow(NOW - 86_400_000) } : { boss: settledRow(NOW - 86_400_000, "manual") };
      await render(family("boss"), { rows, settings: { inactiveShelf: false } }, {}, 600, width);
      screen.getByRole("button", { name: `${shelf} (1)` }).click();
      await waitFor(() => expect(document.querySelector('[data-card="slim"]')).not.toBeNull());
      await frames();
      const boss = card("boss");
      await userEvent.hover(boss);
      await frames();
      return boss;
    };
    const whole = (el: HTMLElement) => el.scrollWidth <= el.clientWidth;

    it.each(["Parked", "Settled"] as const)("keeps the chip and the restore button whole on a hovered %s row at the default sidebar width, the project name giving way first", async (shelf) => {
      const boss = await hovered(249, shelf);
      const chip = boss.querySelector<HTMLElement>("[data-children-chip]")!;
      expect(chip.getBoundingClientRect().width).toBeGreaterThanOrEqual(34);
      expect([chip, ...chip.querySelectorAll<HTMLElement>("*")].every(whole)).toBe(true);
      const restore = boss.querySelector<HTMLElement>("[data-slim-actions] button")!;
      expect(whole(restore)).toBe(true);
      // The project name is the first to give way.
      const name = boss.querySelector<HTMLElement>("[data-project-name]")!.parentElement!;
      expect(name.scrollWidth).toBeGreaterThan(name.clientWidth);
      expect(boss.querySelector<HTMLElement>("[data-title]")!.getBoundingClientRect().width).toBeGreaterThanOrEqual(48);
      expect(boss.scrollWidth).toBeLessThanOrEqual(boss.clientWidth);
    });

    it("cuts a hovered Parked row's label from its end, never from its start", async () => {
      for (const width of [249, 256, 262, 280]) {
        const boss = await hovered(width, "Parked");
        const label = [...boss.querySelectorAll<HTMLElement>("span")].find((el) => el.children.length === 0 && el.textContent?.startsWith("Waiting"))!;
        const wrapper = label.parentElement!;
        expect(label.getBoundingClientRect().left, `at ${width} px`).toBeGreaterThanOrEqual(wrapper.getBoundingClientRect().left - 0.5);
        cleanup();
        localStorage.clear();
      }
    });

    it.each(["Parked", "Settled"] as const)("does not overflow a hovered %s row at the narrowest sidebar width", async (shelf) => {
      const boss = await hovered(169, shelf);
      expect(boss.scrollWidth).toBeLessThanOrEqual(boss.clientWidth);
      expect(boss.querySelector("[data-children-chip]")).not.toBeNull();
    });
  });

  it("puts the Status slot at 80 px at the right edge of the card's first line", async () => {
    await draw(false);
    const slot = card("full").querySelector<HTMLElement>("[data-status-slot]")!;
    const box = slot.getBoundingClientRect();
    expect(box.width).toBe(80);
    const cardBox = card("full").getBoundingClientRect();
    expect(Math.round(cardBox.right - box.right)).toBe(10);
    expect(box.top - cardBox.top).toBeLessThan(heights.fullCard / 2);
  });
});

describe("the jump hints", () => {
  const card = (id: string) => document.querySelector<HTMLElement>(`[data-card][data-thread-id="${id}"]`)!;
  // bb joins a binding's keys with " + ", so a binding with Alt added is the longest label a row meets.
  const long = { label: "Ctrl + Alt + Shift + 1", ariaKeyshortcuts: "Control+Alt+Shift+1" };

  it("widens the Status slot for a label longer than 80 px, leaving the line's other parts beside it", async () => {
    const threads = [
      makeThread({ id: "full", title: "Full card", ...at(5) }),
      makeThread({ id: "work", title: "A folded card with a long title", ...at(6), status: "active", runtimeStatus: "active", indicator: "runtime" }),
    ];
    await render(threads, { settings: { compactWorkingThreads: true, inactiveShelf: false } }, {}, 600, 255, { full: long, work: long });
    for (const id of ["full", "work"]) {
      const slot = card(id).querySelector<HTMLElement>("[data-status-slot]")!;
      const hint = slot.querySelector<HTMLElement>("[data-jump-hint]")!;
      expect(hint.getBoundingClientRect().left).toBeGreaterThanOrEqual(slot.getBoundingClientRect().left);
      expect(slot.getBoundingClientRect().width).toBeGreaterThan(80);
      expect(card(id).scrollWidth).toBeLessThanOrEqual(card(id).clientWidth);
    }
    expect(card("work").dataset.card).toBe("folded");
    const title = card("work").querySelector<HTMLElement>("[data-title]")!;
    expect(title.getBoundingClientRect().right).toBeLessThanOrEqual(card("work").querySelector("[data-status-slot]")!.getBoundingClientRect().left);
  });

  it("keeps a Slim row within its width with the longest label", async () => {
    const threads = [makeThread({ id: "pk", title: "A parked thread with a long title", ...old })];
    await render(threads, { rows: { pk: parkedRow(NOW - 1000) }, settings: { inactiveShelf: false } }, {}, 600, 255, { pk: long });
    await userEvent.click(screen.getByRole("button", { name: "Parked (1)" }));
    await frames();
    expect(card("pk").dataset.card).toBe("slim");
    const hint = card("pk").querySelector<HTMLElement>("[data-jump-hint]")!;
    expect(hint.getBoundingClientRect().right).toBeLessThanOrEqual(card("pk").getBoundingClientRect().right);
    expect(hint.scrollWidth).toBeLessThanOrEqual(hint.clientWidth);
    expect(card("pk").scrollWidth).toBeLessThanOrEqual(card("pk").clientWidth);
  });
});

describe("the jump hints on a hovered slim row with a Children chip", () => {
  const card = (id: string) => document.querySelector<HTMLElement>(`[data-card][data-thread-id="${id}"]`)!;
  const long = { label: "Ctrl + Alt + Shift + 1", ariaKeyshortcuts: "Control+Alt+Shift+1" };
  const usual = { label: "Ctrl + 1", ariaKeyshortcuts: "Control+1" };

  it.each([
    [249, long],
    [169, usual],
  ])("keeps the row within its width and the hint whole at %s px", async (width, hintBinding) => {
    const threads = [
      makeThread({ id: "pk", title: "A parked thread with a long title", ...old }),
      makeThread({ id: "k1", title: "kid one", parentThreadId: "pk", ...old }),
      makeThread({ id: "k2", title: "kid two", parentThreadId: "pk", ...old }),
    ];
    await render(threads, { rows: { pk: parkedRow(NOW - 86_400_000) }, settings: { inactiveShelf: false } }, {}, 600, width, { pk: hintBinding });
    await userEvent.click(screen.getByRole("button", { name: "Parked (1)" }));
    await frames();
    await userEvent.hover(card("pk"));
    await frames();
    const row = card("pk");
    const hint = row.querySelector<HTMLElement>("[data-jump-hint]")!;
    expect(hint.scrollWidth).toBeLessThanOrEqual(hint.clientWidth);
    expect(hint.getBoundingClientRect().right).toBeLessThanOrEqual(row.getBoundingClientRect().right);
    expect(row.scrollWidth).toBeLessThanOrEqual(row.clientWidth);
  });
});

describe("the jump hints over a focused slim row button", () => {
  it("keeps the focused button in the layout, so holding the jump modifier does not drop focus", async () => {
    const threads = [makeThread({ id: "pk", title: "A parked thread", ...old })];
    await render(threads, { rows: { pk: parkedRow(NOW - 86_400_000) }, settings: { inactiveShelf: false } }, {}, 600, 249, { pk: { label: "Ctrl + 1", ariaKeyshortcuts: "Control+1" } });
    await userEvent.click(screen.getByRole("button", { name: "Parked (1)" }));
    await frames();
    const row = document.querySelector<HTMLElement>('[data-card][data-thread-id="pk"]')!;
    const restore = row.querySelector<HTMLElement>("[data-slim-actions] button")!;
    // A keyboard user reaches the buttons through the row's link, whose focus shows them.
    row.querySelector<HTMLElement>("a")!.focus();
    await frames();
    restore.focus();
    await userEvent.hover(row);
    await frames();
    expect(restore.getBoundingClientRect().width).toBeGreaterThan(0);
    expect(document.activeElement).toBe(restore);
  });
});

describe("a card takes the pointer", () => {
  const threads = [
    makeThread({ id: "full", title: "Full card", ...at(5), isPinned: true, pinnedAt: NOW }),
    makeThread({ id: "work", title: "Working one", ...at(6), status: "active", runtimeStatus: "active", indicator: "runtime" }),
    makeThread({ id: "pk", title: "Parked one", ...old }),
  ];
  const draw = async () => {
    await render(threads, { rows: { pk: parkedRow(NOW - 86_400_000) }, settings: { compactWorkingThreads: true, inactiveShelf: false }, order: ["full", "work", "pk"] });
    screen.getByRole("button", { name: "Parked (1)" }).click();
    await waitFor(() => expect(document.querySelector('[data-card="slim"]')).not.toBeNull());
    await frames();
  };
  const card = (id: string) => document.querySelector<HTMLElement>(`[data-card][data-thread-id="${id}"]`)!;
  const centre = (el: HTMLElement) => {
    const box = el.getBoundingClientRect();
    return [box.left + box.width / 2, box.top + box.height / 2] as const;
  };

  it("lets the row link take a hit at the middle of a Full, Folded and Slim card", async () => {
    await draw();
    for (const id of ["full", "work", "pk"]) {
      const hit = document.elementFromPoint(...centre(card(id)));
      expect(hit?.closest("a[data-sidebar-thread-id]")?.getAttribute("data-sidebar-thread-id"), id).toBe(id);
    }
  });

  it("opens the Hover card when the pointer rests on a Full card", async () => {
    await draw();
    await userEvent.hover(card("full"));
    await waitFor(() => expect(document.querySelector("[data-hover-card]")).not.toBeNull());
  });

  it("starts the rename on a double-click of a Full card", async () => {
    await draw();
    await userEvent.dblClick(card("full"));
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Rename Full card" })).toBeTruthy());
  });

  it("still lets the card's own buttons take a hit", async () => {
    await draw();
    await userEvent.hover(card("full"));
    for (const label of ["Unpin", "Thread actions for"]) {
      // Unpin has a second, touch-only copy that is not drawn here.
      const button = [...card("full").querySelectorAll<HTMLElement>(`button[aria-label^="${label}"]`)].find((el) => el.getBoundingClientRect().width > 0)!;
      expect(button.contains(document.elementFromPoint(...centre(button))), label).toBe(true);
    }
  });
});

describe("the shelf headers", () => {
  const threads = [
    makeThread({ id: "p", title: "Pinned one", ...at(4), isPinned: true, pinnedAt: NOW }),
    makeThread({ id: "a", title: "Active one", ...at(5) }),
    makeThread({ id: "w", title: "Working one", ...at(6), status: "active", runtimeStatus: "active", indicator: "runtime" }),
    makeThread({ id: "i", title: "Inactive one", ...old }),
    makeThread({ id: "s1", title: "Snoozed one", ...old }),
    makeThread({ id: "k1", title: "Parked one", ...old }),
    makeThread({ id: "d1", title: "Settled one", ...old }),
  ];
  const rows = { s1: snoozedRow(NOW + 3_600_000, NOW - 1000), k1: parkedRow(NOW - 1000), d1: settledRow(NOW - 1000, "manual") };
  const headers = () => [...document.querySelectorAll<HTMLElement>("[data-shelf]")];
  const box = (el: Element) => el.getBoundingClientRect();
  const parts = (header: HTMLElement) => {
    const toggle = header.querySelector<HTMLElement>("button[aria-expanded]")!;
    return {
      toggle,
      name: toggle.querySelector<HTMLElement>("span.truncate")!,
      chevron: toggle.querySelector<HTMLElement>("[data-icon=ChevronRight]")!,
      rule: toggle.querySelector<HTMLElement>("[data-shelf-rule]")!,
      control: header.querySelector<HTMLElement>("select, button[aria-label^='Close terminals']"),
    };
  };

  /** Each header shows its rule from just after the chevron to its control, or the header's right edge. */
  function expectRules() {
    expect(headers().map((header) => header.dataset.shelf)).toEqual(["pinned", "active", "working", "inactive", "snoozed", "parked", "settled"]);
    for (const header of headers()) {
      const { chevron, rule, control } = parts(header);
      const shelf = header.dataset.shelf;
      expect(getComputedStyle(rule).backgroundImage, shelf).toContain("linear-gradient");
      expect(box(rule).width, shelf).toBeGreaterThan(40);
      expect(box(rule).left, shelf).toBeGreaterThanOrEqual(box(chevron).right - 0.5);
      expect(box(rule).left, shelf).toBeLessThanOrEqual(box(chevron).right + 0.5);
      if (control === null) {
        expect(box(header).right - box(rule).right, shelf).toBeLessThanOrEqual(8.5);
      } else {
        expect(box(rule).right, shelf).toBeLessThan(box(control).left);
        expect(box(control).left - box(rule).right, shelf).toBeLessThanOrEqual(8.5);
      }
      const ruleMiddle = box(rule).top + box(rule).height / 2;
      expect(Math.abs(ruleMiddle - (box(chevron).top + box(chevron).height / 2)), shelf).toBeLessThanOrEqual(1);
    }
  }

  it("each draw a rule from the chevron to the controls or the right edge, open or collapsed", async () => {
    await render(threads, { rows, settings: { workingShelf: true } });
    expectRules();
    for (const name of ["Inactive (1)", "Snoozed (1)", "Parked (1)", "Settled (1)"]) screen.getByRole("button", { name }).click();
    await waitFor(() => expect(screen.getByRole("button", { name: "Settled" }).getAttribute("aria-expanded")).toBe("true"));
    await frames();
    expectRules();
  });

  it("each draw their rule with the bottom shelves docked", async () => {
    await render(threads, { rows, settings: { workingShelf: true, dockShelves: true } });
    expect(document.querySelector('[data-scroller="lower"]')).not.toBeNull();
    expectRules();
  });

  it("end Active's rule before its sort control, whichever sort it shows", async () => {
    await render(threads, { rows, settings: { workingShelf: true } });
    const select = document.querySelector<HTMLSelectElement>('select[aria-label="Sort Active"]')!;
    for (const option of [...select.options].map((candidate) => candidate.value)) {
      await userEvent.selectOptions(select, option);
      await frames();
      const { rule, control } = parts(document.querySelector<HTMLElement>('[data-shelf="active"]')!);
      expect(control, option).toBe(select);
      expect(box(rule).width, option).toBeGreaterThan(40);
      expect(box(rule).right, option).toBeLessThan(box(select).left);
    }
  });

  it("are as tall as the heights model says, at both densities, and nothing overlaps", async () => {
    for (const compact of [false, true]) {
      const heights = heightsFor(compact);
      await render(threads, { rows, settings: { workingShelf: true } }, { isCompactViewport: compact });
      const list = headers();
      for (const header of list) {
        // The first header of the top and of the bottom group has no gap above it.
        const gap = parseFloat(header.style.paddingTop);
        expect([0, heights.shelfGap], header.dataset.shelf).toContain(gap);
        expect(box(header).height, `${header.dataset.shelf} ${compact}`).toBe(heights.shelfHeader + gap);
      }
      const items = [...document.querySelectorAll<HTMLElement>('[data-scroller="list"] [data-shelf], [data-scroller="list"] [data-row-id]')];
      for (let index = 1; index < items.length; index++) expect(box(items[index]!).top).toBeGreaterThanOrEqual(box(items[index - 1]!).bottom - 0.5);
      cleanup();
    }
  });

  it("narrow the rule to nothing before a name truncates, which truncates where it did without the rule", async () => {
    await render(threads, { rows, settings: { workingShelf: true } });
    for (let width = 200; width >= 70; width -= 5) {
      await page.viewport(width, 600);
      await frames();
      for (const header of headers()) {
        const { name, rule } = parts(header);
        const where = `${header.dataset.shelf} at ${width}px`;
        const truncated = name.scrollWidth > name.clientWidth;
        if (truncated) expect(box(rule).width, where).toBe(0);
        const withRule = box(name).width;
        rule.style.display = "none";
        const without = box(name).width;
        rule.style.display = "";
        expect(withRule, where).toBe(without);
      }
    }
  });

  it("open or close their shelf on a click along the rule", async () => {
    await render(threads, { rows, settings: { workingShelf: true } });
    for (const shelf of ["active", "parked"]) {
      const header = () => document.querySelector<HTMLElement>(`[data-shelf="${shelf}"]`)!;
      const before = parts(header()).toggle.getAttribute("aria-expanded");
      const { rule } = parts(header());
      const hit = document.elementFromPoint(box(rule).left + box(rule).width * 0.75, box(rule).top);
      expect(hit?.closest("button[aria-expanded]"), shelf).toBe(parts(header()).toggle);
      await userEvent.click(rule, { force: true });
      await waitFor(() => expect(parts(header()).toggle.getAttribute("aria-expanded"), shelf).not.toBe(before));
    }
  });

  it("show Clean as a broom at least as large as the header's other controls and 24 px square", async () => {
    await render(threads, { rows, settings: { workingShelf: true } });
    const clean = parts(document.querySelector<HTMLElement>('[data-shelf="settled"]')!).control!;
    const select = document.querySelector<HTMLElement>('select[aria-label="Sort Active"]')!;
    expect(clean.textContent).toBe("");
    expect(clean.querySelector("[data-icon=thread-glance-clean]")).not.toBeNull();
    expect(box(clean).width).toBeGreaterThanOrEqual(24);
    expect(box(clean).height).toBeGreaterThanOrEqual(24);
    expect(box(clean).height).toBeGreaterThanOrEqual(box(select).height);
    await userEvent.click(clean);
    await waitFor(() => expect(screen.getByRole("alertdialog")).toBeTruthy());
  });
});
