/// <reference types="vite/client" />
// The list in Chromium, where layout is real: Dock shelves to the bottom, the
// windowed rows with their spacers, and the edges' fade.
import "../testing/browser.css";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { cleanup, screen, waitFor } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { PluginSidebarThread, PluginThreadListProps } from "@get-bb/plugin-sdk/app";
import { parkedRow, snoozedRow } from "@/shared/lifecycle";
import { heightsFor } from "../model/heights";
import { createFakeServer, type FakeServerOptions } from "../testing/fake-server";
import { makeThread, PROJECTS } from "../testing/fixtures";

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

async function render(threads: PluginSidebarThread[], server: FakeServerOptions = {}, listProps: Partial<PluginThreadListProps> = {}, height = 600) {
  await page.viewport(360, height);
  const slot = renderSlot(app.threadLists[0]!, { ...props, ...listProps }, {
    rpc: createFakeServer(server).handlers as never,
    sidebarThreads: { status: "ready", threads, projects: PROJECTS, sections: [] },
    sdk: {} as never,
    realtimeConnectionState: "connected",
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
