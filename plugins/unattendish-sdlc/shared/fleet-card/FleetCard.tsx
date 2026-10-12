import type { CredentialWarningView, FleetCardView, HalfView, ReasonView } from "@/src/fleet/application/views";
import { cn } from "@/lib/utils";
import { costText, countsText, halfAction, halfLine, managerText, pollText, warningLine } from "../card-model";
import { CanWrite } from "../connect/Field";
import { openConnect } from "../connect/requests";
import { LINK_CLASS } from "../ItemLink";
import { useOpenFleetTab } from "../open-fleet-tab";

/** One fleet at a glance: its manager, counts, cost, last poll, every reason it is not fully watched, and what to warn of. */
export function FleetCard({ card, now, className, inFleetTab = false }: { card: FleetCardView; now: string; className?: string; inFleetTab?: boolean }) {
  const openFleetTab = useOpenFleetTab();
  const cost = costText(card);
  return (
    <article aria-label={`Fleet ${card.repo}`} className={cn("flex flex-col gap-1 rounded-lg border p-3 text-sm", card.reasons.length > 0 ? "border-destructive/50" : "border-border", className)}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-medium">{card.repo}</span>
        {!inFleetTab ? (
          <button type="button" className={cn(LINK_CLASS, "text-xs")} aria-label={`Open the Fleet tab of ${card.repo}`} onClick={() => openFleetTab(card.managerThreadId)}>
            manager ↗
          </button>
        ) : null}
      </div>
      <div className="text-xs text-muted-foreground">
        {card.tracker} · {managerText(card.manager, now)}
      </div>
      <div className="text-xs">{countsText(card)}</div>
      <div className="text-xs text-muted-foreground">
        {cost !== null ? `${cost} · ` : ""}
        {pollText(card, now)}
      </div>
      {card.halves.length > 0 ? (
        <ul aria-label={`Accounts of ${card.repo}`} className="flex flex-col gap-0.5">
          {card.halves.map((half) => (
            <Half key={half.role} half={half} repo={card.repo} />
          ))}
        </ul>
      ) : null}
      {card.reasons.map((reason) => (
        <Reason key={`${reason.code}:${reason.text}`} reason={reason} repo={card.repo} managerThreadId={card.managerThreadId} onOpenFleetTab={inFleetTab ? null : openFleetTab} />
      ))}
      {card.warnings.map((warning) => (
        <Warning key={`${warning.kind}:${warning.label}`} warning={warning} repo={card.repo} />
      ))}
    </article>
  );
}

function Half({ half, repo }: { half: HalfView; repo: string }) {
  const action = halfAction(half);
  return (
    <li className="flex flex-wrap items-baseline gap-x-2 text-xs">
      <span className="font-medium">{half.role}</span>
      <span className="text-muted-foreground">{halfLine(half)}</span>
      {half.canWrite ? <CanWrite /> : null}
      {half.needs !== null ? <span className="text-destructive">{half.needs}</span> : null}
      <button type="button" className={LINK_CLASS} aria-label={`${action} ${half.role} of ${repo}`} onClick={() => openConnect({ target: { fleet: repo, role: half.role } })}>
        {action}
      </button>
    </li>
  );
}

function Reason({ reason, repo, managerThreadId, onOpenFleetTab }: { reason: ReasonView; repo: string; managerThreadId: string; onOpenFleetTab: ((threadId: string) => void) | null }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 text-xs text-destructive">
      <span>{reason.text}</span>
      {reason.fix.kind === "connect" ? (
        <button type="button" className={LINK_CLASS} aria-label={`Connect… ${reason.fix.role} of ${repo}, for: ${reason.text}`} onClick={() => reason.fix.kind === "connect" && openConnect({ target: { fleet: repo, role: reason.fix.role } })}>
          Connect…
        </button>
      ) : null}
      {reason.fix.kind === "fleet-tab" && onOpenFleetTab !== null ? (
        <button type="button" className={LINK_CLASS} onClick={() => onOpenFleetTab(managerThreadId)}>
          Open the Fleet tab
        </button>
      ) : null}
    </div>
  );
}

function Warning({ warning, repo }: { warning: CredentialWarningView; repo: string }) {
  const line = warningLine(warning);
  return (
    <div className={cn("flex flex-wrap items-baseline gap-x-2 text-xs", line.tone === "destructive" ? "text-destructive" : "text-warning")}>
      <span>{line.text}</span>
      <span className="text-muted-foreground">{line.label}</span>
      {warning.kind === "expires" ? (
        <button
          type="button"
          className={cn(LINK_CLASS, "text-foreground")}
          aria-label={`Renew ${warning.label}`}
          onClick={() => openConnect({ target: { fleet: repo, role: warning.role }, account: warning.accountId, replaces: warning.credentialId })}
        >
          Renew
        </button>
      ) : null}
    </div>
  );
}
