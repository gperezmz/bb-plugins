import type { FleetCardView, ReasonView } from "@/src/fleet/application/views";
import { cn } from "@/lib/utils";
import { costText, countsText, managerText, pollText, warningLine } from "../card-model";
import { useOpenFleetTab } from "../open-fleet-tab";
import { SettingsLink } from "../SettingsLink";

const LINK_BUTTON = "text-foreground underline decoration-border underline-offset-2 hover:decoration-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded-sm";

/** One fleet at a glance: its manager, counts, cost, last poll, every reason it is not fully watched, and what to warn of. */
export function FleetCard({ card, now, className }: { card: FleetCardView; now: string; className?: string }) {
  const openFleetTab = useOpenFleetTab();
  const cost = costText(card);
  return (
    <article aria-label={`Fleet ${card.repo}`} className={cn("flex flex-col gap-1 rounded-lg border p-3 text-sm", card.reasons.length > 0 ? "border-destructive/50" : "border-border", className)}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-medium">{card.repo}</span>
        <button type="button" className={cn(LINK_BUTTON, "text-xs")} aria-label={`Open the Fleet tab of ${card.repo}`} onClick={() => openFleetTab(card.managerThreadId)}>
          manager ↗
        </button>
      </div>
      <div className="text-xs text-muted-foreground">
        {card.tracker} · {managerText(card.manager, now)}
      </div>
      <div className="text-xs">{countsText(card)}</div>
      <div className="text-xs text-muted-foreground">
        {cost !== null ? `${cost} · ` : ""}
        {pollText(card, now)}
      </div>
      {card.reasons.map((reason) => (
        <Reason key={`${reason.code}:${reason.text}`} reason={reason} managerThreadId={card.managerThreadId} onOpenFleetTab={openFleetTab} />
      ))}
      {card.warnings.map((warning) => {
        const line = warningLine(warning);
        return (
          <div key={`${warning.kind}:${warning.prefix}`} className={cn("text-xs", line.tone === "destructive" ? "text-destructive" : "text-warning")}>
            {line.text} <span className="text-muted-foreground">{line.prefix}</span>
          </div>
        );
      })}
    </article>
  );
}

function Reason({ reason, managerThreadId, onOpenFleetTab }: { reason: ReasonView; managerThreadId: string; onOpenFleetTab(threadId: string): void }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 text-xs text-destructive">
      <span>{reason.text}</span>
      {reason.fix.kind === "settings" ? <SettingsLink>Open settings</SettingsLink> : null}
      {reason.fix.kind === "fleet-tab" ? (
        <button type="button" className={LINK_BUTTON} onClick={() => onOpenFleetTab(managerThreadId)}>
          Open the Fleet tab
        </button>
      ) : null}
    </div>
  );
}
