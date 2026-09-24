// Runs a fix from the UI: confirmations, approvals, links, copy, terminals
// and device logins all start here, so every button behaves the same.
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import type { Fix } from "../core/vocab.js";
import type { OnboardingState } from "../contract/rpc.js";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { copyText, errorText, openHttps, postAction, useOnboardingRpc } from "./hooks.js";

interface Pending {
  itemId: string;
  hostId: string;
  fix: Fix;
  title: string;
}

interface Actions {
  busy: string | null;
  run(itemId: string, hostId: string, fix: Fix, title: string): void;
  recheck(itemId?: string, hostId?: string): void;
  approve(hash: string): Promise<void>;
  revoke(hash: string): Promise<void>;
  envTarget: { itemId: string; name: string } | null;
  closeEnv(): void;
  /** Fetches the state again, e.g. after a terminal closed. */
  refresh(): void;
}

const ActionsContext = createContext<Actions | null>(null);

export function useActions(): Actions {
  const value = useContext(ActionsContext);
  if (value === null) throw new Error("ActionsProvider missing");
  return value;
}

export function ActionsProvider({
  state,
  onChanged,
  children,
}: {
  state: OnboardingState | null;
  onChanged: () => void;
  children: ReactNode;
}) {
  const rpc = useOnboardingRpc();
  const navigate = useBbNavigate();
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Pending | null>(null);
  const [envTarget, setEnvTarget] = useState<{ itemId: string; name: string } | null>(null);

  const execute = useCallback(
    async (pending: Pending, confirmed: boolean) => {
      const { itemId, hostId, fix } = pending;
      const key = `${itemId}@${hostId}:${fix.kind}`;
      setBusy(key);
      try {
        const out = await postAction({ action: "runFix", itemId, hostId, kind: fix.kind, confirmed, cols: 100, rows: 30 });
        // A terminal the fix opened shows under its item: say so, and bring it into view.
        if (out.terminal !== undefined && out.terminal !== null) {
          toast.message(`Running in a terminal under “${pending.title}”.`);
          setTimeout(() => document.querySelector(`[data-item="${CSS.escape(itemId)}"]`)?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 400);
        }
        if (out.message !== null) (out.ok ? toast.success : toast.error)(out.message);
        onChanged();
      } catch (cause) {
        toast.error(errorText(cause));
      } finally {
        setBusy(null);
      }
    },
    [rpc, onChanged],
  );

  const run = useCallback(
    (itemId: string, hostId: string, fix: Fix, title: string) => {
      const item = state?.items.find((candidate) => candidate.id === itemId);
      const result = item?.results.find((candidate) => candidate.hostId === hostId);
      switch (fix.kind) {
        case "open-url": {
          if (fix.url !== null) {
            if (!openHttps(navigate, fix.url)) return;
            // Keep checking while the GitHub page is open.
            void rpc.call("watch", { itemId, hostId }).catch(() => {});
          }
          return;
        }
        case "copy-public-key": {
          const key = result?.facts.publicKey;
          if (typeof key === "string") {
            void copyText(key).then((ok) => (ok ? toast.success("Public key copied") : toast.error("Couldn't copy")));
            void rpc.call("watch", { itemId, hostId }).catch(() => {});
          }
          return;
        }
        case "copy-text": {
          if (fix.command !== null) void copyText(fix.command).then((ok) => (ok ? toast.success("Copied") : toast.error("Couldn't copy")));
          return;
        }
        case "approve":
          // Approvals are shown with the command itself in the row.
          return;
        case "env-set":
          setEnvTarget({ itemId, name: itemId.replace(/^env:/, "") });
          return;
        default:
          if (fix.confirm !== null) {
            setConfirm({ itemId, hostId, fix, title });
            return;
          }
          void execute({ itemId, hostId, fix, title }, false);
      }
    },
    [state, navigate, rpc, execute],
  );

  const actions = useMemo<Actions>(
    () => ({
      busy,
      run,
      recheck: (itemId, hostId) => {
        // A row's Recheck from the engineer goes through the page-only route,
        // which lets git use its credential helpers; an automated browser gets
        // the plain RPC recheck.
        const request =
          itemId !== undefined && hostId !== undefined && !(typeof navigator !== "undefined" && navigator.webdriver === true)
            ? postAction({ action: "recheck", itemId, hostId })
            : rpc.call("recheck", { itemId, hostId });
        void request.then(onChanged, (cause) => toast.error(errorText(cause)));
      },
      approve: async (hash) => {
        try {
          await postAction({ action: "approve", hash });
          toast.success("Approved");
          onChanged();
        } catch (cause) {
          toast.error(errorText(cause));
        }
      },
      revoke: async (hash) => {
        try {
          await postAction({ action: "revoke", hash });
          onChanged();
        } catch (cause) {
          toast.error(errorText(cause));
        }
      },

      envTarget,
      closeEnv: () => setEnvTarget(null),
      refresh: onChanged,
    }),
    [busy, run, rpc, onChanged, navigate, envTarget],
  );

  return (
    <ActionsContext.Provider value={actions}>
      {children}
      <Dialog open={confirm !== null} onOpenChange={(open) => (open ? null : setConfirm(null))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{confirm?.fix.label}</DialogTitle>
            <DialogDescription>{confirm?.fix.confirm}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                const pending = confirm;
                setConfirm(null);
                if (pending !== null) void execute(pending, true);
              }}
            >
              {confirm?.fix.label}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ActionsContext.Provider>
  );
}
