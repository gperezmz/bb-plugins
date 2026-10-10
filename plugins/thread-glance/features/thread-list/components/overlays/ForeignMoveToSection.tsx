// The built-in list registers its own "Move to section" in bb's thread menu,
// shown by that list's organization setting rather than Thread Glance's, and
// the menu has no option to leave an action out. While a thread menu is open
// this hides that item, Thread Glance's own "Move to a section" standing in.
import { useEffect } from "react";
import { useOpenMenu } from "../../store/hooks";

/** The label the built-in list gives its action. */
const FOREIGN_LABEL = "Move to section";

function hideForeignItems() {
  for (const item of document.querySelectorAll<HTMLElement>('[role="menuitem"], [role="dialog"] button')) {
    if (item.textContent?.trim() === FOREIGN_LABEL && item.style.display !== "none") item.style.display = "none";
  }
}

/** Draws nothing. */
export function ForeignMoveToSection() {
  const open = useOpenMenu()?.kind === "thread";
  useEffect(() => {
    if (!open) return;
    hideForeignItems();
    const observer = new MutationObserver(hideForeignItems);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [open]);
  return null;
}
