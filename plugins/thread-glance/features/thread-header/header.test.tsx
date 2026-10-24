// @vitest-environment jsdom
// AC23: the thread header's Parent button and Children button.
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it } from "vitest";
import { makeThread, PROJECTS } from "@/testing/fixtures";
import { ChildrenButton } from "./ChildrenButton";
import { ParentButton } from "./ParentButton";
import { childrenLabel } from "./model";

afterEach(cleanup);

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

const threads = () => [
  makeThread({ id: "p", title: "Parent thread" }),
  makeThread({ id: "c1", title: "First child", parentThreadId: "p" }),
  makeThread({ id: "c2", title: "Second child", parentThreadId: "p", hasPendingInteraction: true, indicator: "waiting-for-input" }),
  makeThread({ id: "c3", title: "Archived child", parentThreadId: "p", isArchived: true, archivedAt: 1 }),
];

function show(component: typeof ParentButton, threadId: string, list = threads(), isCompactViewport = false) {
  const rendered = renderSlot({ component }, { threadId, projectId: "proj_a", isCompactViewport }, { sidebarThreads: { threads: list, projects: PROJECTS } });
  return rendered;
}

describe("AC23: the Parent button", () => {
  it("reads Back to parent: <title>, and opens the parent", () => {
    const view = show(ParentButton, "c1");
    const button = screen.getByRole("button", { name: "Back to parent: Parent thread" });
    expect(button.textContent).toContain("Parent thread");
    expect(button.querySelector("[data-icon=ChevronLeft]")).not.toBeNull();
    expect(button.querySelector("[data-child-mark]")).not.toBeNull();
    fireEvent.click(button);
    expect(view.navigateCalls).toEqual([{ method: "toThread", threadId: "p" }]);
  });

  it("drops the title on a compact viewport", () => {
    show(ParentButton, "c1", threads(), true);
    expect(screen.getByRole("button", { name: "Back to parent: Parent thread" }).textContent).toBe("");
  });

  it("draws nothing for a thread with no parent", () => {
    const view = show(ParentButton, "p");
    expect(view.container.textContent).toBe("");
  });
});

describe("AC23: the Children button", () => {
  it("says Needs you when a direct child needs you, else N children", () => {
    expect(childrenLabel(threads().slice(1, 3))).toBe("Needs you");
    expect(childrenLabel([threads()[1]!])).toBe("1 child");
    expect(childrenLabel([threads()[1]!, makeThread({ id: "x" })])).toBe("2 children");
    show(ChildrenButton, "p");
    expect(screen.getByRole("button", { name: "Needs you" })).toBeTruthy();
  });

  it("counts only non-archived direct children and shows up to three marks", () => {
    const many = [makeThread({ id: "p" }), ...Array.from({ length: 5 }, (_, index) => makeThread({ id: `k${index}`, parentThreadId: "p", title: `K${index}` }))];
    show(ChildrenButton, "p", many);
    const button = screen.getByRole("button", { name: "5 children" });
    expect(button.querySelectorAll("[data-child-mark]")).toHaveLength(3);
  });

  it("drops the label on a compact viewport", () => {
    show(ChildrenButton, "p", threads(), true);
    expect(screen.getByRole("button", { name: "Needs you" }).textContent).toBe("");
  });

  it("opens a 320 px popover listing the children, each opening that child", async () => {
    const view = show(ChildrenButton, "p");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Needs you" }));
    });
    const popover = screen.getByRole("region", { name: "Child threads" });
    expect(popover.className).toContain("w-80");
    const items = within(popover).getAllByRole("button");
    expect(items).toHaveLength(2);
    expect(items[0]!.textContent).toContain("First child");
    expect(items[1]!.textContent).toContain("Needs you");
    expect(within(popover).queryByText("Archived child")).toBeNull();
    fireEvent.click(within(popover).getByRole("button", { name: /Second child/ }));
    expect(view.navigateCalls).toEqual([{ method: "toThread", threadId: "c2" }]);
  });

  it("closes the popover when the thread changes", async () => {
    const view = show(ChildrenButton, "p", [...threads(), makeThread({ id: "q" }), makeThread({ id: "qc", parentThreadId: "q" })]);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Needs you" }));
    });
    expect(screen.queryByRole("region", { name: "Child threads" })).not.toBeNull();
    await act(async () => view.rerender(<ChildrenButton threadId="q" projectId="proj_a" isCompactViewport={false} />));
    expect(screen.getByRole("button", { name: "1 child" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Child threads" })).toBeNull();
  });

  it("closes the popover when the last child goes away, and does not reopen it for a new child", async () => {
    const list = [makeThread({ id: "p" }), makeThread({ id: "c1", title: "Only child", parentThreadId: "p" })];
    const view = show(ChildrenButton, "p", list);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "1 child" }));
    });
    expect(screen.queryByRole("region", { name: "Child threads" })).not.toBeNull();
    list.splice(1, 1);
    await act(async () => view.rerender(<ChildrenButton threadId="p" projectId="proj_a" isCompactViewport={false} />));
    expect(view.container.textContent).toBe("");
    expect(screen.queryByRole("region", { name: "Child threads" })).toBeNull();
    list.push(makeThread({ id: "c2", title: "New child", parentThreadId: "p" }));
    await act(async () => view.rerender(<ChildrenButton threadId="p" projectId="proj_a" isCompactViewport={false} />));
    expect(screen.getByRole("button", { name: "1 child" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Child threads" })).toBeNull();
  });

  it("draws nothing without children", () => {
    const view = show(ChildrenButton, "c1");
    expect(view.container.textContent).toBe("");
  });
});

describe("titles with mentions (#342)", () => {
  const mentioned = () => [
    makeThread({ id: "p", title: "Plan @project:proj_a", displayTitle: "Plan Alpha" }),
    makeThread({ id: "c1", title: "Fix @thread:p", displayTitle: "Fix Plan Alpha", parentThreadId: "p" }),
  ];

  it("draws the parent's title through bb's ThreadTitle, and names the button by the plain one", () => {
    show(ParentButton, "c1", mentioned());
    const button = screen.getByRole("button", { name: "Back to parent: Plan Alpha" });
    expect(button.querySelector('[data-thread-title="p"]')?.textContent).toBe("Plan Alpha");
    expect(button.textContent).not.toContain("@project");
  });

  it("draws each child's title through bb's ThreadTitle in the popover", async () => {
    show(ChildrenButton, "p", mentioned());
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "1 child" }));
    });
    const popover = screen.getByRole("region", { name: "Child threads" });
    expect(popover.querySelector('[data-thread-title="c1"]')?.textContent).toBe("Fix Plan Alpha");
  });
});
