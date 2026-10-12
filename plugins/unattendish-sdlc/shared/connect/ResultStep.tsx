import { UrlLink } from "@get-bb/plugin-sdk/app";
import type { ConnectResult, NotReadableView } from "@/src/fleet/application/views";
import { Button } from "@/components/ui/button";
import { LINK_CLASS } from "../ItemLink";
import { CAN_WRITE } from "./Field";
import { actionLabel, expiryText, halfText, remedyText, resultActions, type Checked, type ResultAction } from "./model";

/** Step 3: what Verify and save found, and what the operator may do next. */
export function ResultStep({
  result,
  checked,
  canCheck,
  busy,
  onAction,
  onClose,
}: {
  result: ConnectResult;
  checked: Checked | null;
  canCheck: boolean;
  busy: boolean;
  onAction(action: ResultAction): void;
  onClose(): void;
}) {
  const actions = resultActions(result, canCheck);
  return (
    <div className="flex flex-col gap-3">
      <Body result={result} checked={checked} />
      {result.outcome !== "saved" && checked !== null ? <Reread checked={checked} /> : null}
      <div className="flex flex-wrap items-center justify-end gap-2">
        {actions.map((action) => (
          <Button key={action} type="button" size="sm" variant={action === "confirm" ? "default" : "outline"} disabled={busy} onClick={() => onAction(action)}>
            {actionLabel(action, result)}
          </Button>
        ))}
        <Button type="button" size="sm" variant={result.outcome === "saved" && actions.length === 0 ? "default" : "ghost"} onClick={onClose}>
          {result.outcome === "saved" ? "Done" : "Close"}
        </Button>
      </div>
    </div>
  );
}

function Body({ result, checked }: { result: ConnectResult; checked: Checked | null }) {
  switch (result.outcome) {
    case "confirm":
    case "refused":
    case "unreachable":
    case "invalid":
      return <p role={result.outcome === "confirm" ? "status" : "alert"}>{result.text}</p>;
    case "wrong-login":
      return (
        <div role="alert" className="flex flex-col gap-2">
          <p>{result.text}</p>
          {result.command !== null ? <code className="rounded bg-secondary px-2 py-1 text-xs">{result.command}</code> : null}
        </div>
      );
    case "saved": {
      const half = checked?.half ?? result.half;
      const notReadable = checked?.notReadable ?? result.notReadable;
      return (
        <div className="flex flex-col gap-2">
          <p role="status">
            Saved: {result.account.label}, {result.login}, {expiryText(result.expiresAt)}.
            {result.canWrite ? <span className="ml-2 rounded bg-warning/15 px-1 text-xs text-warning">{CAN_WRITE}</span> : null}
          </p>
          <Reread checked={{ half, notReadable }} />
          {result.revoke !== null ? (
            <p className="text-xs text-muted-foreground">
              {result.revoke.text}{" "}
              <UrlLink href={result.revoke.url} className={LINK_CLASS}>
                Open the token page ↗
              </UrlLink>
            </p>
          ) : null}
        </div>
      );
    }
  }
}

/** How the half stands, and the repositories still unreadable; after Check again, as the fleet was just read. */
function Reread({ checked }: { checked: { half: Checked["half"] | null; notReadable: readonly NotReadableView[] } }) {
  const { half, notReadable } = checked;
  return (
    <>
      {half !== null ? <p className={half.needs !== null ? "text-destructive" : undefined}>{halfText(half)}</p> : null}
      {notReadable.length > 0 ? (
        <ul aria-label="Not readable" className="flex flex-col gap-2">
          {notReadable.map((entry) => (
            <NotReadable key={entry.fleet} entry={entry} />
          ))}
        </ul>
      ) : null}
    </>
  );
}

function NotReadable({ entry }: { entry: NotReadableView }) {
  return (
    <li className="flex flex-col gap-0.5 rounded-md border border-destructive/50 p-2 text-sm">
      <span className="font-medium">{entry.fleet} is not readable</span>
      <span>{entry.text}</span>
      <span className="text-xs text-muted-foreground">{remedyText(entry)}</span>
    </li>
  );
}
