// Clean settled resources: the dialog behind the Settled header's Clean button.
// It previews the live terminals and thread-owned listening ports of the
// settled threads in the list's project scope, runs the preview once on
// "Clean resources", and shows what came of it. Mounted by the list, so it
// opens wherever bb offers the list.
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { messageOf } from "@/lib/error-message";
import { CLEAN_EXPIRED_TEXT, CLEAN_NOTHING_TEXT } from "@/shared/ports";
import {
  CLEAN_TITLE,
  CLEAN_WARNINGS,
  cleanSummary,
  hasResources,
  portsText,
  stillListeningText,
  terminalsText,
  type CleanState,
} from "../model/clean";
import { useCleanOpen, useCommands, useListStore, useScope } from "../store/hooks";

export function CleanDialog() {
  const open = useCleanOpen();
  const commands = useCommands();
  return (
    <AlertDialog open={open} onOpenChange={(next) => !next && commands.closeClean()}>
      {open ? <CleanContent /> : null}
    </AlertDialog>
  );
}

/** The dialog's state and its two calls; a call that comes back after a newer one started is dropped. */
function useClean(): { state: CleanState; refresh(): void; run(token: string): void } {
  const store = useListStore();
  const { scopeId } = useScope();
  const [state, setState] = useState<CleanState>({ phase: "loading" });
  const latest = useRef(0);
  const refresh = useCallback(() => {
    const mine = (latest.current += 1);
    setState({ phase: "loading" });
    store.edge.rpc.call("previewClean", { projectId: scopeId }).then(
      (preview) => mine === latest.current && setState({ phase: "preview", preview }),
      (error) => mine === latest.current && setState({ phase: "failed", message: messageOf(error) }),
    );
  }, [store, scopeId]);
  useEffect(() => {
    refresh();
    return () => {
      latest.current += 1;
    };
    // The preview is read when the dialog opens, for the scope it opened in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const run = useCallback(
    (token: string) => {
      const mine = (latest.current += 1);
      setState((current) => (current.phase === "preview" ? { phase: "running", preview: current.preview } : current));
      store.edge.rpc.call("runClean", { token }).then(
        (result) => {
          if (mine !== latest.current) return;
          if (result.expired) {
            setState({ phase: "expired" });
            return;
          }
          setState({ phase: "done", result });
          toast.success(cleanSummary(result), { description: stillListeningText(result) ?? undefined });
        },
        (error) => mine === latest.current && setState({ phase: "failed", message: messageOf(error) }),
      );
    },
    [store],
  );
  return { state, refresh, run };
}

function CleanContent() {
  const commands = useCommands();
  const { state, refresh, run } = useClean();
  const preview = state.phase === "preview" || state.phase === "running" ? state.preview : null;
  const found = preview !== null && hasResources(preview);
  const finished = state.phase === "done" || (state.phase === "preview" && !found);
  return (
    <AlertDialogContent className="max-w-md">
      <AlertDialogHeader>
        <AlertDialogTitle>{CLEAN_TITLE}</AlertDialogTitle>
        <AlertDialogDescription>Closes the live terminals and thread-owned listening ports of settled threads. They stay in Settled.</AlertDialogDescription>
      </AlertDialogHeader>
      <div className="grid gap-3 text-sm" aria-live="polite">
        {state.phase === "loading" ? <p className="text-muted-foreground">Looking for terminals and ports…</p> : null}
        {state.phase === "failed" ? (
          <p role="alert" className="text-[color:var(--tg-failed)]">
            {state.message}
          </p>
        ) : null}
        {state.phase === "expired" ? <p role="alert">{CLEAN_EXPIRED_TEXT}</p> : null}
        {preview !== null && !found ? <p>{CLEAN_NOTHING_TEXT}</p> : null}
        {found ? (
          <>
            <ul data-clean-threads="" className="grid max-h-64 gap-2 overflow-y-auto">
              {preview.threads.map((thread) => (
                <li key={thread.threadId} data-clean-thread={thread.threadId} className="flex items-start gap-2 rounded-md border border-border px-2.5 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{thread.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {[thread.terminals > 0 ? terminalsText(thread.terminals) : null, thread.ports.length > 0 ? portsText(thread.ports) : null]
                        .filter((part) => part !== null)
                        .join(" · ")}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    aria-label={`Open ${thread.title}`}
                    onClick={() => {
                      commands.open(thread.threadId);
                      commands.closeClean();
                    }}
                  >
                    Open
                  </Button>
                </li>
              ))}
            </ul>
            {CLEAN_WARNINGS.map((warning) => (
              <p key={warning} className="text-xs text-muted-foreground">
                {warning}
              </p>
            ))}
          </>
        ) : null}
        {state.phase === "done" ? (
          <div data-clean-result="" className="grid gap-1">
            <p role="status" className="font-medium">
              {cleanSummary(state.result)}
            </p>
            {stillListeningText(state.result) === null ? null : <p>{stillListeningText(state.result)}</p>}
            {state.result.issues.map((issue) => (
              <p key={issue} className="text-[color:var(--tg-failed)]">
                {issue}
              </p>
            ))}
          </div>
        ) : null}
      </div>
      <AlertDialogFooter>
        <AlertDialogCancel>{finished || state.phase === "expired" || state.phase === "failed" ? "Close" : "Cancel"}</AlertDialogCancel>
        {state.phase === "expired" || state.phase === "failed" ? (
          <Button type="button" onClick={refresh}>
            Refresh preview
          </Button>
        ) : null}
        {found && preview !== null ? (
          <Button type="button" disabled={state.phase === "running"} onClick={() => run(preview.token)}>
            {state.phase === "running" ? "Cleaning..." : "Clean resources"}
          </Button>
        ) : null}
      </AlertDialogFooter>
    </AlertDialogContent>
  );
}
