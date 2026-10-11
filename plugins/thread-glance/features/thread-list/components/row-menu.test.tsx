// @vitest-environment jsdom
// The right-click menu on a row, with the host's menu as bb draws it: it puts
// its handler on the one element it wraps (Radix's `asChild`), so what it
// wraps must be an element, not a component that draws none.
import { cloneElement, Children, type ReactElement, type ReactNode } from "react";
import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { makeThread } from "@/testing/fixtures";
import { mount, useListHarness } from "../testing/harness";

vi.mock("@get-bb/plugin-sdk/app", async (importOriginal) => {
  const sdk = await importOriginal<typeof import("@get-bb/plugin-sdk/app")>();
  const { useState } = await import("react");
  function HostContextMenu({ children }: { children: ReactNode }) {
    const [open, setOpen] = useState(false);
    const child = Children.only(children) as ReactElement<{ onContextMenu?: (event: unknown) => void }>;
    return (
      <>
        {cloneElement(child, { onContextMenu: () => setOpen(true) })}
        {open ? <div role="menu" aria-label="Thread actions" /> : null}
      </>
    );
  }
  return { ...sdk, experimental_ThreadActionsContextMenu: HostContextMenu };
});

useListHarness();

const NOW = Date.now();
const fresh = { createdAt: NOW - 5 * 60_000, updatedAt: NOW - 5 * 60_000, latestAttentionAt: NOW - 5 * 60_000 };

const family = () => [makeThread({ id: "p", title: "Parent", ...fresh }), makeThread({ id: "c", title: "Child", parentThreadId: "p", ...fresh })];
const menu = () => screen.queryByRole("menu", { name: "Thread actions" });

describe("right-click on a row", () => {
  it("opens the thread menu on a top-level row", async () => {
    await mount({ threads: family() });
    fireEvent.contextMenu(document.querySelector('[data-card][data-thread-id="p"]')!);
    expect(menu()).not.toBeNull();
  });

  it("opens the thread menu on a child row", async () => {
    await mount({ threads: family() });
    fireEvent.click(document.querySelector("[data-children-chip]")!);
    fireEvent.contextMenu(document.querySelector('[data-child-id="c"] > div')!);
    expect(menu()).not.toBeNull();
  });
});
