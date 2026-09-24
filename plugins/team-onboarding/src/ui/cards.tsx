// The cards above the checklist: manifest, device login, next step, done,
// and the "Fix all safe items" sheet.
import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import type { DeviceLoginState, ItemState, OnboardingState } from "../contract/rpc.js";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { useActions } from "./actions.js";
import { copyText, errorText, openHttps, useNow, useOnboardingRpc } from "./hooks.js";

export function Card({ children, className, tone }: { children: ReactNode; className?: string; tone?: "attention" | "destructive" }) {
  return (
    <section
      className={cn(
        "rounded-lg border border-border bg-card px-4 py-3",
        tone === "attention" && "border-attention/40 bg-surface-attention",
        tone === "destructive" && "border-destructive/40 bg-surface-destructive",
        className,
      )}
    >
      {children}
    </section>
  );
}

// --- Manifest card ----------------------------------------------------------

/** The one-line command an admin or a provisioning script runs to put the manifest in place. */
export function installCommand(): string {
  return "bb team-onboarding manifest install ./onboarding.yaml";
}

/**
 * A manifest file that is there and can't be used, with no last good one to
 * fall back on. (No file at all is the quiet NoManifestNote.)
 */
export function ManifestCard({ state }: { state: OnboardingState }) {
  const command = installCommand();
  return (
    <Card tone="attention">
      <h2 className="text-sm font-medium">The team manifest on this server can't be used</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Your team describes its setup in an <code>onboarding.yaml</code>, which an admin or a provisioning script puts on the bb
        server. The plugin reads it from:
      </p>
      <code className="mt-1 block break-all rounded bg-surface-recessed px-2 py-1 font-mono text-xs">{state.manifest.path}</code>
      {state.manifest.error !== null ? (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {state.manifest.error}
        </p>
      ) : null}
      <p className="mt-2 text-sm text-muted-foreground">To install one, run this on the bb server where the file is:</p>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <code className="min-w-0 flex-1 break-all rounded bg-surface-recessed px-2 py-1 font-mono text-xs">{command}</code>
        <Button
          size="sm"
          variant="outline"
          onClick={() => void copyText(command).then((ok) => (ok ? toast.success("Command copied") : toast.error("Couldn't copy")))}
        >
          <Icon name="Copy" /> Copy
        </Button>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">Until then, the built-in checks below cover GitHub and your agents.</p>
    </Card>
  );
}

/**
 * No manifest on this server: not a problem, the team part just doesn't
 * apply. One quiet line, with how to add one folded away for admins.
 */
export function NoManifestNote({ state }: { state: OnboardingState }) {
  const command = installCommand();
  return (
    <div className="px-1 text-xs text-muted-foreground">
      <p>No team manifest on this server, so only the built-in checks run.</p>
      <details className="mt-1">
        <summary className="cursor-pointer select-none">For admins: how to add one</summary>
        <div className="mt-1.5 space-y-1.5">
          <p>An admin or a provisioning script puts the team's onboarding.yaml on the bb server. The plugin reads it from:</p>
          <code className="block break-all rounded bg-surface-recessed px-2 py-1 font-mono">{state.manifest.path}</code>
          <p>To install one, run this on the bb server where the file is:</p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 break-all rounded bg-surface-recessed px-2 py-1 font-mono">{command}</code>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void copyText(command).then((ok) => (ok ? toast.success("Command copied") : toast.error("Couldn't copy")))}
            >
              <Icon name="Copy" /> Copy
            </Button>
          </div>
        </div>
      </details>
    </div>
  );
}

// --- Device login -----------------------------------------------------------

export function DeviceLoginCard({ device, itemTitle, machineName }: { device: DeviceLoginState; itemTitle: string; machineName: string }) {
  const rpc = useOnboardingRpc();
  const [dismissed, setDismissed] = useState<string | null>(null);
  const navigate = useBbNavigate();
  const actions = useActions();
  const now = useNow(1000);
  const remaining = device.expiresAt === null ? null : Math.max(0, Date.parse(device.expiresAt) - now);
  const expired = device.state === "expired" || (remaining !== null && remaining === 0 && device.state === "code");
  const fixKind = device.flow === "login" ? "device-login" : "device-refresh";

  const retry = () =>
    actions.run(device.itemId, device.hostId, {
      kind: fixKind,
      label: "Get a new code",
      command: null,
      url: null,
      safe: false,
      approvalHash: null,
      confirm: null,
    }, itemTitle);

  if (device.state === "done") {
    if (dismissed === device.loginId || device.message === null) return null;
    return (
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <p className="flex min-w-0 flex-1 items-start gap-2 text-sm">
            <Icon name="Check" className="mt-0.5 size-4 shrink-0 text-success" />
            <span>{device.message}</span>
          </p>
          <Button size="sm" variant="ghost" onClick={() => setDismissed(device.loginId)}>
            Dismiss
          </Button>
        </div>
      </Card>
    );
  }

  if (device.state === "failed" || device.state === "cancelled" || expired) {
    return (
      <Card tone={device.state === "cancelled" ? undefined : "attention"}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm">{expired ? "The code expired." : (device.message ?? "The login stopped.")}</p>
          <Button size="sm" onClick={retry}>
            Get a new code
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card className="border-primary/40">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Icon name="Loading" className="size-4 animate-spin text-muted-foreground" />
        {device.flow === "login" ? "Log in with GitHub" : "Add a permission to your GitHub login"}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        This runs <code>gh auth {device.flow === "login" ? "login" : "refresh"}</code> on {machineName}, where agents run.
      </p>
      {device.code === null ? (
        <p className="mt-2 text-sm text-muted-foreground">Asking GitHub for a one-time code…</p>
      ) : (
        <>
          <p className="mt-2 text-sm text-muted-foreground">Copy this code, open GitHub, and paste it there.</p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <code
              aria-label="One-time code"
              className="select-all rounded-md border border-border bg-surface-recessed px-3 py-1.5 font-mono text-2xl font-semibold tracking-[0.2em]"
            >
              {device.code}
            </code>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void copyText(device.code!).then((ok) => (ok ? toast.success("Code copied") : toast.error("Couldn't copy")))}
            >
              <Icon name="Copy" />
              Copy code
            </Button>
            <Button
              size="sm"
              onClick={() => {
                const url = device.url ?? "https://github.com/login/device";
                openHttps(navigate, url);
              }}
            >
              Open github.com/login/device
              <Icon name="ExternalLink" />
            </Button>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            {remaining === null ? null : `Code expires in ${formatCountdown(remaining)}. `}
            This turns green by itself once GitHub confirms.
          </p>
        </>
      )}
      <Button variant="ghost" size="sm" className="mt-2 -ml-2" onClick={() => void rpc.call("cancelDeviceLogin", { loginId: device.loginId })}>
        Cancel
      </Button>
    </Card>
  );
}

function formatCountdown(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

// --- Next step --------------------------------------------------------------

export function NextStepCard({ state, item, hostId }: { state: OnboardingState; item: ItemState; hostId: string | null }) {
  const actions = useActions();
  const fixes = item.fixes.find((entry) => entry.hostId === hostId)?.fixes ?? item.fixes[0]?.fixes ?? [];
  const primary = fixes.find((fix) => fix.kind !== "approve") ?? null;
  const machine = state.machines.find((candidate) => candidate.id === (hostId ?? item.fixes[0]?.hostId));
  const result = item.results.find((candidate) => candidate.hostId === machine?.id);
  const key = primary === null || machine === undefined ? "" : `${item.id}@${machine.id}:${primary.kind}`;
  return (
    <Card className="border-primary/30">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Next step</p>
      <div className="mt-1 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-medium">{item.title}</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">{item.why}</p>
          {result !== undefined && result.category !== "not-checked" ? (
            <p className="mt-1 text-sm">{result.detail}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {primary !== null && machine !== undefined ? (
            <Button onClick={() => actions.run(item.id, machine.id, primary, item.title)} disabled={actions.busy === key}>
              {actions.busy === key ? <Icon name="Loading" className="animate-spin" /> : null}
              {primary.label}
            </Button>
          ) : null}
          <span className="text-xs text-muted-foreground">{item.estimate}</span>
        </div>
      </div>
    </Card>
  );
}

// --- Done -----------------------------------------------------------------------

export function DoneCard({ state }: { state: OnboardingState }) {
  return (
    <Card className="border-success/40">
      <div className="flex items-center gap-2">
        <Icon name="CircleCheck" className="size-5 text-success" />
        <h2 className="text-base font-medium">You're set up</h2>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">{state.doneSummary}</p>
      <p className="mt-1 text-xs text-muted-foreground">This page keeps checking and tells you when something changes.</p>
    </Card>
  );
}

// --- Fix all safe items -------------------------------------------------------------

export function SafeFixesButton({ state, onChanged }: { state: OnboardingState; onChanged: () => void }) {
  const rpc = useOnboardingRpc();
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const count = state.safeFixes.length;
  useEffect(() => {
    if (count === 0) setOpen(false);
  }, [count]);
  if (count === 0) return null;
  const runAll = async () => {
    setRunning(true);
    try {
      const out = await rpc.call("fixAllSafe", { dryRun: false });
      const failed = out.results.filter((result) => !result.ok);
      if (failed.length === 0) toast.success(`Ran ${out.results.length} safe ${out.results.length === 1 ? "fix" : "fixes"}.`);
      else toast.error(`${failed.length} of ${out.results.length} fixes failed. See the rows for details.`);
      setOpen(false);
      onChanged();
    } catch (cause) {
      toast.error(errorText(cause));
    } finally {
      setRunning(false);
    }
  };
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        Fix all safe items ({count})
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Fix all safe items</DialogTitle>
            <DialogDescription>
              These need no input and run nothing your team's manifest hasn't had approved. This is exactly what will run:
            </DialogDescription>
          </DialogHeader>
          <ul className="max-h-72 space-y-1 overflow-y-auto text-sm">
            {state.safeFixes.map((fix) => (
              <li key={`${fix.itemId}@${fix.hostId}:${fix.kind}`} className="flex items-baseline justify-between gap-3 rounded-md px-2 py-1 odd:bg-surface-recessed">
                <span className="min-w-0 truncate">
                  <span className="font-medium">{fix.label}</span> <span className="text-muted-foreground">· {fix.title}</span>
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">on {fix.machine}</span>
              </li>
            ))}
          </ul>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void runAll()} disabled={running}>
              {running ? <Icon name="Loading" className="animate-spin" /> : null}
              Run {count} {count === 1 ? "fix" : "fixes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
