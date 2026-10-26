// @vitest-environment jsdom
// AC18: the Children chip on a parent's card, and the child lists under it.
import { act, fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { parkedRow, settledRow, snoozedRow } from "@/shared/lifecycle";
import { DAY, HOUR, makeThread, PROJECTS } from "@/testing/fixtures";
import { flush, mount, useListHarness } from "../testing/harness";

useListHarness();

const NOW = Date.now();
const MIN = 60_000;
const at = (minutesAgo: number) => ({ createdAt: NOW - minutesAgo * MIN, updatedAt: NOW - minutesAgo * MIN, latestAttentionAt: NOW - minutesAgo * MIN });
const card = (id: string) => document.querySelector<HTMLElement>(`[data-card][data-thread-id="${id}"]`)!;
const chip = (id: string) => card(id).querySelector<HTMLElement>("[data-children-chip]")!;
const childTitles = () => [...document.querySelectorAll<HTMLElement>("[data-child-id] > div a")].map((link) => link.textContent!.trim());
const childRow = (id: string) => document.querySelector<HTMLElement>(`[data-child-id="${id}"]`)!;

const family = () => [
  makeThread({ id: "p", title: "Parent", ...at(60) }),
  makeThread({ id: "c1", title: "Failing", parentThreadId: "p", indicator: "unread-error", ...at(50) }),
  makeThread({ id: "c2", title: "Asking", parentThreadId: "p", hasPendingInteraction: true, indicator: "waiting-for-input", ...at(40) }),
  makeThread({ id: "c3", title: "Working", parentThreadId: "p", status: "active", runtimeStatus: "active", indicator: "runtime", ...at(30) }),
  makeThread({ id: "c4", title: "Done", parentThreadId: "p", indicator: "unread-success", ...at(20) }),
  makeThread({ id: "c5", title: "Quiet", parentThreadId: "p", ...at(10) }),
];

describe("AC18: the Children chip", () => {
  it("counts the direct children and words the subtree in its tooltip", async () => {
    await mount({ threads: family() });
    expect(chip("p").getAttribute("aria-label")).toBe("5 child threads, 1 failed, 1 need you, 1 done, 1 working");
    expect(chip("p").textContent).toContain("5");
  });

  it("shows up to three child marks and the most urgent glyph in the subtree", async () => {
    await mount({ threads: family() });
    expect(chip("p").querySelectorAll("[data-child-mark]")).toHaveLength(3);
    expect(chip("p").querySelector("[data-urgency]")?.getAttribute("data-urgency")).toBe("failed");
  });

  it("falls to needs you, then done, then working as the more urgent ones go", async () => {
    const m = await mount({ threads: family() });
    const urgency = () => chip("p").querySelector("[data-urgency]")?.getAttribute("data-urgency");
    act(() => m.host.updateThread("c1", { indicator: "none" }));
    await flush();
    expect(urgency()).toBe("needs-you");
    act(() => m.host.updateThread("c2", { indicator: "none", hasPendingInteraction: false }));
    await flush();
    expect(urgency()).toBe("done");
    act(() => m.host.updateThread("c4", { indicator: "none" }));
    await flush();
    expect(urgency()).toBe("working");
  });

  it("counts a grandchild's failure in the subtree but only the direct children in the count", async () => {
    await mount({
      threads: [
        makeThread({ id: "p", ...at(30) }),
        makeThread({ id: "c", parentThreadId: "p", ...at(20) }),
        makeThread({ id: "g", parentThreadId: "c", indicator: "unread-error", ...at(10) }),
      ],
    });
    expect(chip("p").getAttribute("aria-label")).toBe("1 child thread, 1 failed");
    expect(chip("p").querySelector("[data-urgency]")?.getAttribute("data-urgency")).toBe("failed");
  });

  it("opens and closes the child list per device, for the last 100 parents", async () => {
    const first = await mount({ threads: family() });
    expect(chip("p").getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(chip("p"));
    await flush();
    expect(chip("p").getAttribute("aria-expanded")).toBe("true");
    expect(childTitles()).toEqual(["Failing", "Asking", "Working", "Done", "Quiet"]);
    expect(JSON.parse(localStorage.getItem("thread-glance:expandedParents")!)).toEqual(["p"]);
    first.view.unmount();
    await mount({ threads: family() });
    expect(childTitles()).toHaveLength(5);
    fireEvent.click(chip("p"));
    await flush();
    expect(childTitles()).toEqual(["Failing", "Asking", "Working", "Done"]);
  });
});

describe("AC18: a status another plugin set", () => {
  it("is left out of a child row, which keeps its own status or age", async () => {
    const m = await mount({ threads: family() });
    act(() => m.host.update({ rowStatuses: new Map([["c5", { icon: "Box", label: "Sandbox ready", tone: "success" }]]) }));
    fireEvent.click(chip("p"));
    await flush();
    expect(childRow("c5")).not.toBeNull();
    expect(document.querySelector("[data-child-id] [data-status=plugin]")).toBeNull();
    expect(childRow("c5").querySelector("[data-status=age]")).not.toBeNull();
  });
});

describe("AC18: a closed child list", () => {
  it("shows the children with a status when Show children that need attention is on, and none when it is off", async () => {
    const on = await mount({ threads: family() });
    expect(childTitles()).toEqual(["Failing", "Asking", "Working", "Done"]);
    on.view.unmount();
    await mount({ threads: family(), server: { settings: { showChildrenNeedingAttention: false } } });
    expect(childTitles()).toEqual([]);
  });

  it("keeps the path to the open thread", async () => {
    await mount({
      threads: [
        makeThread({ id: "p", ...at(30) }),
        makeThread({ id: "c", title: "Middle", parentThreadId: "p", ...at(20) }),
        makeThread({ id: "g", title: "Open one", parentThreadId: "c", ...at(10) }),
        makeThread({ id: "x", title: "Aside", parentThreadId: "p", ...at(5) }),
      ],
      activeThreadId: "g",
      server: { settings: { showChildrenNeedingAttention: false } },
    });
    expect(childTitles()).toEqual(["Middle", "Open one"]);
    expect(childRow("g").querySelector("[aria-current=page]")).not.toBeNull();
  });
});

describe("AC18: child rows", () => {
  const deep = () => [
    makeThread({ id: "p", ...at(60) }),
    makeThread({ id: "c", title: "Child", parentThreadId: "p", ...at(50) }),
    makeThread({ id: "g", title: "Grand", parentThreadId: "c", ...at(40) }),
    makeThread({ id: "gg", title: "Great", parentThreadId: "g", ...at(30) }),
    makeThread({ id: "ggg", title: "Deep", parentThreadId: "gg", ...at(20) }),
  ];

  it("names the disclosure of each child's own children by depth", async () => {
    await mount({ threads: deep() });
    fireEvent.click(chip("p"));
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Grandchildren of Child" }));
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Great-grandchildren of Grand" }));
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Descendants of Great" }));
    await flush();
    expect(childTitles()).toEqual(["Child", "Grand", "Great", "Deep"]);
  });

  it("gives a child its status or age", async () => {
    await mount({ threads: family() });
    fireEvent.click(chip("p"));
    await flush();
    const text = (id: string) => childRow(id).querySelector("[data-status]")?.textContent;
    expect([text("c1"), text("c2"), text("c3"), text("c4"), text("c5")]).toEqual(["Failed", "Needs you", "Working", "Unread", "10m"]);
  });

  it("carries the project icon of a child from another project", async () => {
    await mount({
      threads: [
        makeThread({ id: "p", projectId: "proj_a", ...at(30) }),
        makeThread({ id: "same", parentThreadId: "p", projectId: "proj_a", ...at(20) }),
        makeThread({ id: "other", parentThreadId: "p", projectId: "proj_b", ...at(10) }),
      ],
      projects: PROJECTS,
    });
    fireEvent.click(chip("p"));
    await flush();
    expect(childRow("same").querySelector("[data-monogram]")).toBeNull();
    expect(childRow("other").querySelector("[data-monogram]")?.textContent).toBe("B");
  });

  it("sorts by the Child threads settings", async () => {
    const threads = [
      makeThread({ id: "p", ...at(60) }),
      makeThread({ id: "a", title: "A", parentThreadId: "p", ...at(50), updatedAt: NOW - 5 * MIN }),
      makeThread({ id: "b", title: "B", parentThreadId: "p", ...at(40), updatedAt: NOW - 30 * MIN }),
    ];
    const open = async (settings: object) => {
      const m = await mount({ threads, server: { settings } });
      fireEvent.click(chip("p"));
      await flush();
      const titles = childTitles();
      m.view.unmount();
      localStorage.clear();
      return titles;
    };
    expect(await open({})).toEqual(["A", "B"]);
    expect(await open({ childDirection: "newest" })).toEqual(["B", "A"]);
    expect(await open({ childOrder: "activity", childDirection: "oldest" })).toEqual(["B", "A"]);
    expect(await open({ childOrder: "activity", childDirection: "newest" })).toEqual(["A", "B"]);
  });

  it("marks children by the Icon setting: a colour circle, or the provider's logo", async () => {
    const circle = await mount({ threads: family() });
    fireEvent.click(chip("p"));
    await flush();
    expect(childRow("c1").querySelector("[data-child-mark]")?.getAttribute("data-child-mark")).toBe("circle");
    circle.view.unmount();
    await mount({ threads: family(), server: { settings: { childIcon: "provider-icon" } } });
    fireEvent.click(chip("p"));
    await flush();
    expect(childRow("c1").querySelector("[data-child-mark]")?.getAttribute("data-child-mark")).toBe("provider");
    expect(within(childRow("c1")).queryByRole("link")).not.toBeNull();
  });

  it("opens a child on click", async () => {
    const m = await mount({ threads: family() });
    fireEvent.click(chip("p"));
    await flush();
    fireEvent.click(within(childRow("c3")).getByRole("link"));
    expect(m.view.navigateCalls.at(-1)).toEqual({ method: "toThread", threadId: "c3" });
  });
});

describe("#337: the Children chip on Snoozed, Parked and Settled rows", () => {
  const quietFamily = (parentId: string) => [
    makeThread({ id: parentId, title: `Parent ${parentId}`, ...at(60 * 24 * 3) }),
    makeThread({ id: `${parentId}1`, title: `First ${parentId}`, parentThreadId: parentId, ...at(60 * 24 * 3) }),
    makeThread({ id: `${parentId}2`, title: `Second ${parentId}`, parentThreadId: parentId, ...at(60 * 24 * 3) }),
  ];
  const shelves = () => ({
    threads: [...quietFamily("sn"), ...quietFamily("pk"), ...quietFamily("st")],
    server: {
      rows: {
        sn: snoozedRow(NOW + 2 * HOUR, NOW - HOUR),
        pk: parkedRow(NOW - 2 * DAY),
        st: settledRow(NOW - 2 * DAY, "manual"),
      },
    },
  });
  const openShelves = async () => {
    for (const label of ["Snoozed (1)", "Parked (1)", "Settled (1)"]) fireEvent.click(screen.getByText(label, { selector: "button *" }));
    await flush();
  };

  it("shows the chip on a slim row of each shelf and opens the children under it", async () => {
    await mount(shelves());
    await openShelves();
    for (const id of ["sn", "pk", "st"]) {
      expect(card(id).getAttribute("data-card")).toBe("slim");
      expect(chip(id).getAttribute("aria-label")).toBe("2 child threads");
      expect(chip(id).getAttribute("aria-expanded")).toBe("false");
    }
    expect(childTitles()).toEqual([]);
    fireEvent.click(chip("pk"));
    await flush();
    expect(chip("pk").getAttribute("aria-expanded")).toBe("true");
    expect(childTitles()).toEqual(["First pk", "Second pk"]);
  });

  it("keeps what is expanded on Settled when the list loads again on this device", async () => {
    const first = await mount(shelves());
    await openShelves();
    fireEvent.click(chip("st"));
    await flush();
    expect(childTitles()).toEqual(["First st", "Second st"]);
    first.view.unmount();
    await mount(shelves());
    expect(chip("st").getAttribute("aria-expanded")).toBe("true");
    expect(childTitles()).toEqual(["First st", "Second st"]);
  });

  // A cache at its cap has cut the oldest Settled rows, so a root it lacks was not settled just now.
  const fullCache = () => Object.fromEntries(Array.from({ length: 500 }, (_, index) => [`x${index}`, settledRow(NOW - DAY - index, "manual")]));
  const openSettled = async (m: Awaited<ReturnType<typeof mount>>) => {
    await act(async () => m.server.releaseSync());
    await flush();
    fireEvent.click(screen.getByText("Settled (1)", { selector: "button *" }));
    await flush();
  };

  it("does not close a tree that the server's first answer moves onto Settled from a cache cut at its cap", async () => {
    localStorage.setItem("thread-glance:cache.rows", JSON.stringify(fullCache()));
    localStorage.setItem("thread-glance:expandedParents", JSON.stringify(["st"]));
    const m = await mount({ ...shelves(), server: { ...shelves().server, holdSync: true } });
    await openSettled(m);
    expect(chip("st").getAttribute("aria-expanded")).toBe("true");
    expect(JSON.parse(localStorage.getItem("thread-glance:expandedParents")!)).toEqual(["st"]);
  });

  it("closes a tree that settled while the list was closed on this device, when a complete cache meets the server's answer", async () => {
    localStorage.setItem("thread-glance:cache.rows", JSON.stringify({}));
    localStorage.setItem("thread-glance:expandedParents", JSON.stringify(["st"]));
    const m = await mount({ ...shelves(), server: { ...shelves().server, holdSync: true } });
    await openSettled(m);
    expect(chip("st").getAttribute("aria-expanded")).toBe("false");
    expect(JSON.parse(localStorage.getItem("thread-glance:expandedParents")!)).toEqual([]);
  });
});
