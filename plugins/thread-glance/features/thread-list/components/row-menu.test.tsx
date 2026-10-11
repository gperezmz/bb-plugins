// @vitest-environment jsdom
// The row's thread menus, with the host's menus as bb draws them: the context
// menu puts its handler on the one element it wraps (Radix's `asChild`), so
// what it wraps must be an element, not a component that draws none; and an
// open menu traps focus until its closing has played out, so the rename editor
// its Rename opened cannot take focus until then. Closed by keyboard, the menu
// hands focus to its trigger, which the editor takes back; closed by pointer, it
// hands it nowhere, and focus falls to the body with the focused item.
import { cloneElement, Children, type ReactElement, type ReactNode, type Ref } from "react";
import { act, fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { makeThread } from "@/testing/fixtures";
import { mount, useListHarness } from "../testing/harness";

vi.mock("@get-bb/plugin-sdk/app", async (importOriginal) => {
  const sdk = await importOriginal<typeof import("@get-bb/plugin-sdk/app")>();
  const { useEffect, useRef, useState } = await import("react");
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
  }: {
    thread: { id: string };
    trigger(props: { ref: Ref<HTMLButtonElement>; type: "button"; onClick(): void }): ReactNode;
    requestRename(threadId: string): void;
  }) {
    const [shown, setShown] = useState(false);
    const triggerRef = useRef<HTMLButtonElement | null>(null);
    const item = useRef<HTMLButtonElement | null>(null);
    const handsBack = useRef(false);
    useEffect(() => {
      const content = item.current?.parentElement;
      if (!shown && handsBack.current) triggerRef.current?.focus();
      if (!shown || !content) return;
      item.current!.focus();
      // Focus leaving for outside the menu is pulled back to its item, as Radix's FocusScope does.
      const trap = (event: FocusEvent) => {
        if (event.relatedTarget instanceof Node && !content.contains(event.relatedTarget)) item.current?.focus();
      };
      content.addEventListener("focusout", trap);
      return () => content.removeEventListener("focusout", trap);
    }, [shown]);
    // Choosing Rename runs it and closes the menu once its exit has played.
    const choose = (byKey: boolean) => {
      requestRename(thread.id);
      handsBack.current = byKey;
      setTimeout(() => setShown(false), 150);
    };
    return (
      <>
        {trigger({ ref: triggerRef, type: "button", onClick: () => setShown(true) } as never)}
        {shown ? (
          <div role="menu" aria-label="Thread actions">
            <button ref={item} type="button" role="menuitem" onClick={(event) => choose(event.detail === 0)}>
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
  const rename = async (detail: number) => {
    await mount({ threads: [makeThread({ id: "a", title: "Old", ...fresh })] });
    fireEvent.click(screen.getAllByRole("button", { name: "Thread actions for Old" })[0]!);
    await act(async () => {
      fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }), { detail });
    });
    await act(() => new Promise((done) => setTimeout(done, 200)));
    return screen.getByRole("textbox", { name: "Rename Old" });
  };

  it("leaves focus in the editor once a menu closed by keyboard has handed it to its trigger", async () => {
    const input = await rename(0);
    expect(document.activeElement).toBe(input);
  });

  it("leaves focus in the editor once a menu closed by pointer has let it fall to the body", async () => {
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    const input = await rename(1);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(input);
  });
});
