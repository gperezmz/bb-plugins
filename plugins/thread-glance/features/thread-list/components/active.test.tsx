// @vitest-environment jsdom
// Active's order and sort (AC14, AC15), and the threads listed under a parent
// (AC4).
import { act, fireEvent, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { makeThread, PROJECTS } from "../testing/fixtures";
import { flush, mount, useListHarness } from "../testing/harness";
import { attachedListHandles } from "./ThreadList";

useListHarness();

const NOW = Date.now();
const MIN = 60_000;
const at = (minutesAgo: number) => ({ createdAt: NOW - minutesAgo * MIN, updatedAt: NOW - minutesAgo * MIN, latestAttentionAt: NOW - minutesAgo * MIN });

/** The top-level rows' titles, in order. */
function rowTitles(): string[] {
  return [...document.querySelectorAll<HTMLElement>("[data-card]")].map((row) => row.querySelector("a")!.textContent!.replace(/^.*·/, "").trim());
}

function groupHeaders(): string[] {
  return [...document.querySelectorAll<HTMLElement>("[data-group-key]")].map((header) => header.textContent!.trim());
}

const sortSelect = () => screen.getByRole("combobox", { name: "Sort Active" }) as HTMLSelectElement;

describe("AC14: Active's order and sort", () => {
  it("follows the manual order from the server, with a thread it has not heard of at the top", async () => {
    const threads = [
      makeThread({ id: "a", title: "A", ...at(30) }),
      makeThread({ id: "b", title: "B", ...at(20) }),
      makeThread({ id: "c", title: "C", ...at(10) }),
    ];
    const { host, server } = await mount({ threads, server: { order: ["c", "a", "b"] } });
    expect(rowTitles()).toEqual(["C", "A", "B"]);
    act(() => host.update({ threads: [...host.state().threads, makeThread({ id: "n", title: "New", ...at(1) })] }));
    await flush();
    expect(rowTitles()).toEqual(["New", "C", "A", "B"]);
    await act(async () => server.setOrder(["n", "b", "a", "c"]));
    await flush();
    expect(rowTitles()).toEqual(["New", "B", "A", "C"]);
  });

  it("keeps Working and Inactive in Active's manual order", async () => {
    const stale = (minutes: number) => at(600 + minutes);
    const threads = [makeThread({ id: "x", title: "X", ...stale(3) }), makeThread({ id: "y", title: "Y", ...stale(2) }), makeThread({ id: "z", title: "Z", ...stale(1) })];
    await mount({ threads, server: { order: ["y", "z", "x"] } });
    fireEvent.click(screen.getByRole("button", { name: "Inactive (3)" }));
    await flush();
    expect(rowTitles()).toEqual(["Y", "Z", "X"]);
  });

  it("offers four sorts, saved on the device, and marks one that is not Manual order", async () => {
    const threads = [
      makeThread({ id: "a", title: "A", ...at(30) }),
      makeThread({ id: "b", title: "B", ...at(20), createdAt: NOW - 100 * MIN }),
      makeThread({ id: "c", title: "C", ...at(10) }),
    ];
    const first = await mount({ threads, server: { order: ["a", "b", "c"] } });
    expect([...sortSelect().options].map((option) => option.textContent)).toEqual(["Manual order", "Recent activity", "Date created", "Project"]);
    expect(sortSelect().hasAttribute("data-sorted")).toBe(false);
    fireEvent.change(sortSelect(), { target: { value: "activity" } });
    await flush();
    expect(rowTitles()).toEqual(["C", "B", "A"]);
    expect(sortSelect().hasAttribute("data-sorted")).toBe(true);
    fireEvent.change(sortSelect(), { target: { value: "created" } });
    await flush();
    expect(rowTitles()).toEqual(["C", "A", "B"]);
    first.view.unmount();
    await mount({ threads, server: { order: ["a", "b", "c"] } });
    expect(sortSelect().value).toBe("created");
  });
});

describe("AC15: Project mode", () => {
  const threads = () => [
    makeThread({ id: "a1", title: "A1", projectId: "proj_a", ...at(50) }),
    makeThread({ id: "b1", title: "B1", projectId: "proj_b", ...at(40) }),
    makeThread({ id: "a2", title: "A2", projectId: "proj_a", ...at(30) }),
    makeThread({ id: "p1", title: "P1", projectId: "proj_personal", ...at(20) }),
  ];
  const order = ["a1", "b1", "a2", "p1"];

  it("gives a project with two Active threads a header where its first thread sits, and leaves the others as lone rows", async () => {
    await mount({ threads: threads(), projects: PROJECTS, server: { order } });
    expect(groupHeaders()).toEqual([]);
    fireEvent.change(sortSelect(), { target: { value: "project" } });
    await flush();
    expect(groupHeaders()).toEqual(["Alpha2"]);
    expect(rowTitles()).toEqual(["A1", "A2", "B1", "P1"]);
  });

  it("collapses a group per device, keeping the open thread", async () => {
    const first = await mount({ threads: threads(), server: { order }, activeThreadId: "a2" });
    fireEvent.change(sortSelect(), { target: { value: "project" } });
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Collapse Alpha group" }));
    await flush();
    expect(rowTitles()).toEqual(["A2", "B1", "P1"]);
    first.view.unmount();
    await mount({ threads: threads(), server: { order } });
    expect(screen.getByRole("button", { name: "Expand Alpha group" })).toBeTruthy();
    expect(rowTitles()).toEqual(["B1", "P1"]);
  });
});

describe("AC4: threads under a parent", () => {
  const commands = () => attachedListHandles()[0]!.commands;

  it("lists a child only under its parent, whose child list opens on this device", async () => {
    const threads = [
      makeThread({ id: "p", title: "Parent", ...at(30) }),
      makeThread({ id: "c", title: "Child", parentThreadId: "p", ...at(20) }),
    ];
    await mount({ threads, server: { order: ["p", "c"] } });
    expect(rowTitles()).toEqual(["Parent"]);
    expect(screen.queryByText("Child")).toBeNull();
    act(() => commands().setExpanded("p", true));
    await flush();
    expect(rowTitles()).toEqual(["Parent"]);
    expect(document.querySelector("[data-child-of-thread=p]")?.textContent).toBe("Child");
  });

  it("makes a child with an archived parent, or a parent outside the scope, a row of its own", async () => {
    const threads = [
      makeThread({ id: "p1", title: "Gone parent", isArchived: true, archivedAt: NOW, ...at(30) }),
      makeThread({ id: "c1", title: "Orphan", parentThreadId: "p1", ...at(20) }),
      makeThread({ id: "p2", title: "Beta parent", projectId: "proj_b", ...at(30) }),
      makeThread({ id: "c2", title: "Alpha child", parentThreadId: "p2", projectId: "proj_a", ...at(10) }),
    ];
    await mount({ threads });
    expect(rowTitles().sort()).toEqual(["Beta parent", "Orphan"]);
    act(() => commands().setScope("proj_a"));
    await flush();
    expect(rowTitles().sort()).toEqual(["Alpha child", "Orphan"]);
  });

  it("shows a pinned child as a row of its own on Pinned", async () => {
    const threads = [
      makeThread({ id: "p", title: "Parent", ...at(30) }),
      makeThread({ id: "c", title: "Pinned child", parentThreadId: "p", isPinned: true, pinnedAt: NOW, ...at(20) }),
    ];
    await mount({ threads });
    expect(rowTitles()).toEqual(["Pinned child", "Parent"]);
  });
});
