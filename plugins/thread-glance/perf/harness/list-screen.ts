// What the harness clicks on the list, found as a person would find it.
import { within } from "@testing-library/react";
import type { RenderedSlot } from "@get-bb/plugin-sdk/testing/app";

/**
 * The button that marks the list read once the list header's Mark all read
 * was pressed: the confirm dialog's, which above a count of threads asks
 * first, else the header's own. The dialog is found by its role's attribute,
 * since a role query over a list of 1,500 rows takes seconds.
 */
export function markAllReadConfirm(slot: RenderedSlot): HTMLElement {
  const dialog = document.querySelector<HTMLElement>('[role="alertdialog"]');
  return dialog === null
    ? slot.getByRole("button", { name: "Mark all read" })
    : within(dialog).getByRole("button", { name: "Mark all read" });
}
