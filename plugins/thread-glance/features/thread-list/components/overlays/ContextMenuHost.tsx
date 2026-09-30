// The list's one context menu: a right-click on any row, or the context-menu
// key or Shift+F10 on a focused row, opens that row's items at the pointer
// or at the row. Radix opens it where a contextmenu event lands on its
// trigger, so the host keeps one hidden trigger and the row sends it one.
import { useLayoutEffect, useRef } from "react";
import { ContextMenu, ContextMenuTrigger } from "@/components/ui/context-menu";
import type { ThreadRow } from "../../model/view";
import { useCommands, useRowAt } from "../../store/hooks";
import { RowContextMenuContent, type ContextMenuInput } from "../RowMenu";
import { useOverlays } from "./overlays";
import { useRenameAfterClose, useShownMenu, useThreadMenu } from "./RowMenuHost";

export function ContextMenuHost() {
  const commands = useCommands();
  const overlays = useOverlays();
  const trigger = useRef<HTMLSpanElement>(null);
  const input = useRef<ContextMenuInput>({ pressed: false, keyed: false });
  const { open, shown } = useShownMenu(["context"] as const);
  const rename = useRenameAfterClose(open);
  const row = useRowAt(shown?.groupId ?? "", shown?.rowKey ?? "");
  useLayoutEffect(() => {
    overlays.setContextTrigger(trigger.current);
    return () => overlays.setContextTrigger(null);
  }, [overlays]);
  return (
    <ContextMenu
      onOpenChange={(next) => {
        if (next) input.current = { pressed: false, keyed: false };
        else commands.closeMenu();
      }}
    >
      <ContextMenuTrigger asChild>
        <span ref={trigger} hidden data-sidebar-context-menu-trigger="" />
      </ContextMenuTrigger>
      {row?.type === "thread" ? (
        <ContextContent row={row} input={input} onRename={(start) => rename.request(start)} onCloseAutoFocus={rename.onCloseAutoFocus} />
      ) : null}
    </ContextMenu>
  );
}

function ContextContent({
  row,
  input,
  onRename,
  onCloseAutoFocus,
}: {
  row: ThreadRow;
  input: { current: ContextMenuInput };
  onRename(start: () => void): void;
  onCloseAutoFocus(event: Event): void;
}) {
  const menu = useThreadMenu(row, onRename);
  return <RowContextMenuContent {...menu} onCloseAutoFocus={onCloseAutoFocus} input={input} />;
}
