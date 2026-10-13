import { UrlLink, useBbNavigate } from "@get-bb/plugin-sdk/app";
import type { LinkView } from "@/src/fleet/application/views";
import { cn } from "@/lib/utils";
import { linkTarget } from "./links";
import { Tip } from "./look/Tip";

/** How a link in the dashboard is drawn, for a link or a button that acts as one. */
export const LINK_CLASS = "text-foreground underline decoration-border underline-offset-2 hover:decoration-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded-sm";

/**
 * A row's Link: the item or pull request on its service, or the bb thread whose message the row points at; `label`
 * replaces its text. With `arrowOnly` and no `label` it shows the arrow alone, its own text its accessible name. With
 * `tip` and no `label`, its own text is its hover text too, also shown while it has keyboard focus, for a link drawn
 * as the arrow alone or cut short.
 */
export function ItemLink({ link, managerThreadId, label, arrowOnly = false, tip = false, className }: { link: LinkView; managerThreadId: string; label?: string; arrowOnly?: boolean; tip?: boolean; className?: string }) {
  const navigate = useBbNavigate();
  const found = linkTarget(link, managerThreadId);
  const target = label === undefined ? found : { ...found, text: label };
  const bare = arrowOnly && label === undefined;
  const text = bare ? "↗" : `${target.text} ↗`;
  const name = bare ? target.text : undefined;
  const drawn =
    target.kind === "url" ? (
      <UrlLink href={target.url} aria-label={name} className={cn(LINK_CLASS, className)}>
        {text}
      </UrlLink>
    ) : (
      <button type="button" aria-label={name} onClick={() => navigate.toThread(target.threadId)} className={cn(LINK_CLASS, className)}>
        {text}
      </button>
    );
  if (!tip || label !== undefined) return drawn;
  // The tooltip hangs on a span around the link, which shows it as the link inside takes focus.
  return (
    <Tip text={target.text}>
      <span className="flex min-w-0">{drawn}</span>
    </Tip>
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
