// @vitest-environment jsdom
// The row's thread menus, with the host's menus as bb draws them: the context
// menu puts its handler on the one element it wraps (Radix's `asChild`), so
// what it wraps must be an element, not a component that draws none; and a
// closing menu hands focus back to its trigger, which the rename editor the
// menu opened takes back.
import { cloneElement, Children, type ReactElement, type ReactNode, type Ref } from "react";
import { act, fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { makeThread } from "@/testing/fixtures";
import { mount, useListHarness } from "../testing/harness";

vi.mock("@get-bb/plugin-sdk/app", async (importOriginal) => {
  const sdk = await importOriginal<typeof import("@get-bb/plugin-sdk/app")>();
  const { useRef, useState } = await import("react");
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
  function HostMenu({
    thread,
    trigger,
    requestRename,
    onCloseAutoFocus,
  }: {
    thread: { id: string };
    trigger(props: { ref: Ref<HTMLButtonElement>; type: "button"; onClick(): void }): ReactNode;
    requestRename(threadId: string): void;
    onCloseAutoFocus?(event: Event): void;
  }) {
    const [open, setOpen] = useState(false);
    const triggerRef = useRef<HTMLButtonElement | null>(null);
    // Choosing Rename runs it, closes the menu and returns focus as Radix does.
    const choose = () => {
      requestRename(thread.id);
      setOpen(false);
      queueMicrotask(() => {
        const event = new Event("closeautofocus", { cancelable: true });
        onCloseAutoFocus?.(event);
        if (!event.defaultPrevented) triggerRef.current?.focus();
      });
    };
    return (
      <>
        {trigger({ ref: triggerRef, type: "button", onClick: () => setOpen(true) } as never)}
        {open ? (
          <div role="menu" aria-label="Thread actions">
            <button type="button" role="menuitem" onClick={choose}>
              Rename
            </button>
          </div>
        ) : null}
      </>
    );
  }
  return { ...sdk, experimental_ThreadActionsContextMenu: HostContextMenu, experimental_ThreadActionsMenu: HostMenu };
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

describe("Rename from a row's menu", () => {
  it("leaves focus in the editor once the menu has closed", async () => {
    await mount({ threads: [makeThread({ id: "a", title: "Old", ...fresh })] });
    fireEvent.click(screen.getAllByRole("button", { name: "Thread actions for Old" })[0]!);
    await act(async () => {
      fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
    });
    const input = screen.getByRole("textbox", { name: "Rename Old" });
    expect(document.activeElement).toBe(input);
  });
});
