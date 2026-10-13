import { UrlLink, useBbNavigate } from "@get-bb/plugin-sdk/app";
import type { LinkView } from "@/src/fleet/application/views";
import { cn } from "@/lib/utils";
import { linkTarget } from "./links";

/** How a link in the dashboard is drawn, for a link or a button that acts as one. */
export const LINK_CLASS = "text-foreground underline decoration-border underline-offset-2 hover:decoration-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded-sm";

/** A row's Link: the item or pull request on its service, or the bb thread whose message the row points at; `label` replaces its text. */
export function ItemLink({ link, managerThreadId, label, className }: { link: LinkView; managerThreadId: string; label?: string; className?: string }) {
  const navigate = useBbNavigate();
  const found = linkTarget(link, managerThreadId);
  const target = label === undefined ? found : { ...found, text: label };
  if (target.kind === "url") {
    return (
      <UrlLink href={target.url} className={cn(LINK_CLASS, className)}>
        {target.text} ↗
      </UrlLink>
    );
  }
  return (
    <button type="button" onClick={() => navigate.toThread(target.threadId)} className={cn(LINK_CLASS, className)}>
      {target.text} ↗
    </button>
  );
}

/** A plain link to a thread by its id, such as a builder's. */
export function ThreadLink({ threadId, children, className }: { threadId: string; children: string; className?: string }) {
  const navigate = useBbNavigate();
  return (
    <button type="button" onClick={() => navigate.toThread(threadId)} className={cn(LINK_CLASS, className)}>
      {children} ↗
    </button>
  );
}
