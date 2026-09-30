// @vitest-environment jsdom
// Rows are keyed by what they show: a row mounted before a change and still
// mounted after it keeps its DOM node, whatever is inserted, removed or
// reordered around it, through bb's own updates on the harness's fake host.
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent } from "@testing-library/react";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { generateList } from "../testing/fixtures";
import { openList, settle } from "../../../perf/harness/jsdom-run";

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.useRealTimers();
});

function rowNodes(root: ParentNode): Map<string, HTMLElement> {
  return new Map(
    [...root.querySelectorAll<HTMLElement>("[data-sidebar-thread-id]")].map((anchor) => [
      `${anchor.closest("section")?.dataset.sidebarVisibilityGroup}/${anchor.dataset.sidebarThreadId}`,
      anchor.parentElement!,
    ]),
  );
}

it("keeps every row's DOM node through an insertion, a removal, an archive, a move and a group opening or closing above", async () => {
  const list = generateList({ size: 300, kind: "live" });
  const { host, slot } = await openList(list);
  const root = slot.container;
  const thread = (id: string) => host.state().threads.find((candidate) => candidate.id === id)!;
  const roots = () => [...root.querySelectorAll<HTMLElement>("[data-sidebar-thread-id]")].map((anchor) => anchor.dataset.sidebarThreadId!).filter((id) => thread(id).parentThreadId === null);

  const changes: [string, () => void | Promise<void>][] = [
    [
      "a thread inserted",
      () => {
        const newest: PluginSidebarThread = { ...thread(roots()[0]!), id: "inserted", title: "Inserted", displayTitle: "Inserted", createdAt: Date.now(), updatedAt: Date.now() };
        host.update({ threads: [newest, ...host.state().threads] });
      },
    ],
    ["a thread removed", () => host.update({ threads: host.state().threads.filter((candidate) => candidate.id !== roots()[3]) })],
    ["a thread archived", () => host.updateThread(roots()[5]!, { archivedAt: Date.now(), isArchived: true })],
    [
      "a thread moving up",
      () => host.updateThread(roots().at(-1)!, { status: "active", runtimeStatus: "active", updatedAt: Date.now() + 1_000, latestAttentionAt: Date.now() + 1_000 }),
    ],
    ["a group closing above", () => fireEvent.click(root.querySelector<HTMLElement>('[aria-label^="Collapse "][aria-label$=" section"]')!)],
    ["a group opening above", () => fireEvent.click(root.querySelector<HTMLElement>('[aria-label^="Expand "][aria-label$=" section"]')!)],
  ];
  for (const [name, change] of changes) {
    const before = rowNodes(root);
    await act(async () => {
      await change();
    });
    await settle(3);
    const after = rowNodes(root);
    let kept = 0;
    for (const [key, node] of after) {
      if (!before.has(key)) continue;
      expect(node, `${name}: ${key}`).toBe(before.get(key));
      kept += 1;
    }
    expect(kept, name).toBeGreaterThan(10);
  }
});
