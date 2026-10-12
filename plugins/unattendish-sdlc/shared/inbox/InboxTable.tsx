import type { ReactNode } from "react";
import type { InboxRowView, UnreadableInboxRowView } from "@/src/fleet/application/views";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ItemLink } from "../ItemLink";
import { useOpenFleetTab } from "../open-fleet-tab";
import { useIsCompactViewport } from "../use-compact-viewport";
import { ActionComposer } from "./ActionComposer";
import { actionName, rowAction, rowTitle, unreadableText, waitedText, waitsForText, type RowAction } from "./row-model";
import { useRowActions, type RowActionState } from "./use-row-action";

interface TableProps {
  readonly rows: readonly InboxRowView[];
  readonly unreadable: readonly UnreadableInboxRowView[];
  /** The view's clock. */
  readonly now: string;
  /** The Fleets page lists every fleet's rows; a fleet's own tab needs no Fleet column. */
  readonly showFleet: boolean;
  readonly refetch: () => Promise<void>;
}

const CELL = "px-2 py-2 align-top";

/**
 * The Inbox rows of one or more fleets with their actions: a table, or each row stacked on a compact viewport.
 * The rows' action state is held here, above that switch, so a viewport change keeps a composer's text.
 */
export function InboxTable(props: TableProps) {
  const compact = useIsCompactViewport();
  const { rows, unreadable, now, showFleet, refetch } = props;
  const stateOf = useRowActions(refetch);
  if (rows.length === 0 && unreadable.length === 0) return <p className="text-sm text-muted-foreground">Nothing waits on you</p>;
  if (compact) {
    return (
      <ul className="divide-y divide-border">
        {rows.map((row) => (
          <StackedRow key={row.id} row={row} now={now} state={stateOf(row)} />
        ))}
        {unreadable.map((row) => (
          <StackedUnreadable key={`${row.managerThreadId}:${row.line}`} row={row} />
        ))}
      </ul>
    );
  }
  return (
    <table className="w-full text-left text-sm">
      <thead className="text-xs text-muted-foreground">
        <tr>
          {showFleet ? <th className={cn(CELL, "font-medium")}>Fleet</th> : null}
          <th className={cn(CELL, "font-medium")}>What</th>
          <th className={cn(CELL, "font-medium")}>Waits for</th>
          <th className={cn(CELL, "font-medium")}>Waiting</th>
          <th className={cn(CELL, "font-medium")}>Item</th>
          <th className={cn(CELL, "font-medium")}>Action</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-border">
        {rows.map((row) => (
          <TableRow key={row.id} row={row} now={now} showFleet={showFleet} state={stateOf(row)} />
        ))}
        {unreadable.map((row) => (
          <UnreadableTableRow key={`${row.managerThreadId}:${row.line}`} row={row} showFleet={showFleet} />
        ))}
      </tbody>
    </table>
  );
}

function TableRow({ row, now, showFleet, state }: { row: InboxRowView; now: string; showFleet: boolean; state: RowActionState }) {
  const action = rowAction(row, now, state);
  return (
    <>
      <tr>
        {showFleet ? <td className={CELL}>{row.fleet}</td> : null}
        <td className={CELL}>{rowTitle(row)}</td>
        <td className={cn(CELL, "text-muted-foreground")}>{waitsForText(row.waitsFor)}</td>
        <td className={cn(CELL, "tabular-nums text-muted-foreground")}>{waitedText(row, now)}</td>
        <td className={CELL}>
          <ItemLink link={row.link} managerThreadId={row.managerThreadId} />
        </td>
        <td className={CELL}>
          <ActionCell row={row} action={action} state={state} />
        </td>
      </tr>
      {state.composing !== null && action.kind === "offer" ? (
        <tr>
          <td colSpan={showFleet ? 6 : 5} className="px-2 pb-3">
            <Composer row={row} state={state} />
          </td>
        </tr>
      ) : null}
    </>
  );
}

function StackedRow({ row, now, state }: { row: InboxRowView; now: string; state: RowActionState }) {
  const action = rowAction(row, now, state);
  return (
    <li className="flex flex-col gap-1 py-3 text-sm">
      <span className="text-xs text-muted-foreground">{row.fleet}</span>
      <span>{rowTitle(row)}</span>
      <span className="text-xs text-muted-foreground">
        waits for {waitsForText(row.waitsFor)} · {waitedText(row, now)}
      </span>
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <ItemLink link={row.link} managerThreadId={row.managerThreadId} />
        <ActionCell row={row} action={action} state={state} />
      </div>
      {state.composing !== null && action.kind === "offer" ? <Composer row={row} state={state} /> : null}
    </li>
  );
}

function UnreadableTableRow({ row, showFleet }: { row: UnreadableInboxRowView; showFleet: boolean }) {
  const open = useOpenFleetTab();
  return (
    <tr>
      {showFleet ? <td className={CELL}>{row.fleet}</td> : null}
      <td className={cn(CELL, "text-destructive")} colSpan={3}>
        {unreadableText(row)} <span className="text-muted-foreground">(line {row.line})</span>
      </td>
      <td className={CELL} colSpan={2}>
        <FleetTabButton onClick={() => open(row.managerThreadId)} fleet={row.fleet} />
      </td>
    </tr>
  );
}

function StackedUnreadable({ row }: { row: UnreadableInboxRowView }) {
  const open = useOpenFleetTab();
  return (
    <li className="flex flex-col gap-1 py-3 text-sm">
      <span className="text-xs text-muted-foreground">{row.fleet}</span>
      <span className="text-destructive">{unreadableText(row)}</span>
      <div className="pt-1">
        <FleetTabButton onClick={() => open(row.managerThreadId)} fleet={row.fleet} />
      </div>
    </li>
  );
}

function FleetTabButton({ onClick, fleet }: { onClick(): void; fleet: string }) {
  return (
    <Button type="button" variant="outline" size="sm" aria-label={`Open the Fleet tab of ${fleet}`} onClick={onClick}>
      Fleet tab
    </Button>
  );
}

function Composer({ row, state }: { row: InboxRowView; state: RowActionState }) {
  const kind = state.composing;
  if (kind === null) return null;
  return (
    <ActionComposer
      row={row}
      verb={kind === "answer" ? "answer" : "grant"}
      text={state.text}
      onText={state.setText}
      onSend={() => void state.send(kind)}
      onCancel={state.cancel}
    />
  );
}

function ActionCell({ row, action, state }: { row: InboxRowView; action: RowAction; state: RowActionState }): ReactNode {
  switch (action.kind) {
    case "none":
      return null;
    case "sending":
    case "unknown":
    case "sent":
    case "done":
      return <span className="text-sm italic text-muted-foreground">{action.text}</span>;
    case "offer": {
      const { offer } = action;
      return (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label={actionName(offer.label, row)}
            onClick={() => (offer.kind === "build" ? void state.send("build") : state.compose(offer.kind))}
          >
            {offer.label}
          </Button>
          {offer.regrant ? (
            <Button type="button" variant="outline" size="sm" aria-label={actionName("Re-grant", row)} onClick={() => void state.send("grant", { regrant: true })}>
              Re-grant
            </Button>
          ) : null}
          {action.refusal !== null ? (
            <span className="flex gap-1 text-xs">
              <span className="font-medium text-destructive">not sent</span>
              <span className="text-muted-foreground">{action.refusal}</span>
            </span>
          ) : null}
          {action.unconfirmed ? <span className="text-xs text-muted-foreground">could not confirm whether the last send went through</span> : null}
        </div>
      );
    }
  }
}
