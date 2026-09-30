// @vitest-environment jsdom
// Rows are keyed by what they show: a row mounted before a change and still
// mounted after it keeps its DOM node, whatever is inserted, removed or
// reordered around it, through bb's own updates on a fake host.
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent } from "@testing-library/react";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { flushListStores } from "../store/api";
import { createFakeHost, loadWithFakeHost, mountList, serverState } from "../testing/fake-host";
import { makeThread, PROJECTS, T0 } from "../testing/fixtures";

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.useRealTimers();
});

/** Lets loads and effects queued by the last change land, bb's updates waiting in the list store among them. */
async function settle(rounds: number): Promise<void> {
  for (let index = 0; index < rounds; index += 1) {
    await act(async () => {
      flushListStores();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

/** 60 read root threads over every project, newest first, each tenth with two child threads; nothing settled at T0. */
function threadList(): PluginSidebarThread[] {
  const threads: PluginSidebarThread[] = [];
  for (let index = 0; index < 60; index += 1) {
    const at = T0 - index * 60_000;
    const root = makeThread({ id: `t${index}`, title: `Thread ${index}`, projectId: PROJECTS[index % PROJECTS.length]!.id, createdAt: at - 60_000, updatedAt: at, latestAttentionAt: at, lastReadAt: at });
    threads.push(root);
    if (index % 10 !== 0) continue;
    for (let child = 0; child < 2; child += 1) {
      threads.push(makeThread({ id: `${root.id}c${child}`, title: `${root.title} child ${child}`, projectId: root.projectId, parentThreadId: root.id, createdAt: at - 60_000, updatedAt: at - child - 1, latestAttentionAt: at - child - 1, lastReadAt: at - child - 1 }));
    }
  }
  return threads;
}

function rowNodes(root: ParentNode): Map<string, HTMLElement> {
  return new Map(
    [...root.querySelectorAll<HTMLElement>("[data-sidebar-thread-id]")].map((anchor) => [
      `${anchor.closest("section")?.dataset.sidebarVisibilityGroup}/${anchor.dataset.sidebarThreadId}`,
      anchor.parentElement!,
    ]),
  );
}

it("keeps every row's DOM node through an insertion, a removal, an archive, a move and a group opening or closing above", async () => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  vi.useFakeTimers({ toFake: ["Date", "setInterval"] });
  vi.setSystemTime(T0 + 60_000);
  const host = createFakeHost({ threads: threadList(), projects: PROJECTS, freshActions: true });
  const slot = mountList(await loadWithFakeHost(), serverState());
  await settle(5);
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
}, 60_000);
