// The Onboarding page, its header, the sidebar badge, the home section and
// the settings section.
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useBbNavigate, useRpc, useSettings, type PluginHomepageSectionProps, type PluginNavPanelProps } from "@get-bb/plugin-sdk/app";
import type { RpcContract } from "../contract/rpc.js";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { ActionsProvider, useActions } from "./actions.js";
import { Card, DeviceLoginCard, DoneCard, installCommand, ManifestCard, NextStepCard, NoManifestNote, SafeFixesButton } from "./cards.js";
import { Checklist, OtherTerminals } from "./checklist.js";
import { errorText, PANEL_PATH, timeAgo, useNow, useOnboardingRpc, useOnboardingState, useOnboardingSummary } from "./hooks.js";
import { ProgressRing } from "./status.js";

export function OnboardingPage(_props: PluginNavPanelProps) {
  const { state, error, refetch } = useOnboardingState();
  if (state === null) {
    return (
      <div className="h-full overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl p-4 md:p-5">
          <div role="status" className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
            {error === null ? "Checking your setup…" : `Couldn't load the checklist: ${error}`}
          </div>
        </div>
      </div>
    );
  }
  const next = state.nextStep === null ? null : state.items.find((item) => item.id === state.nextStep!.itemId) ?? null;
  const device = state.deviceLogin;
  const deviceItem = device === null ? null : state.items.find((item) => item.id === device.itemId);
  // No manifest isn't a problem: the built-in checks alone can be all set.
  const done = state.badge.kind === "done" && state.items.length > 0 && (state.manifest.status === "ok" || state.manifest.status === "none");
  // Only a manifest file that is there and can't be used gets the big card.
  const showManifestCard = state.manifest.status === "error" && state.manifest.teamName === null;
  return (
    <ActionsProvider state={state} onChanged={refetch}>
      <div className="h-full min-h-0 overflow-y-auto">
        <div className="mx-auto box-border w-full max-w-3xl space-y-3 px-4 pb-8 pt-3 md:px-5 md:pt-4">
          {device !== null && device.state !== "cancelled" ? <DeviceLoginCard
              device={device}
              itemTitle={deviceItem?.title ?? "GitHub"}
              machineName={state.machines.find((machine) => machine.id === device.hostId)?.name ?? "this machine"}
            /> : null}
          {done ? <DoneCard state={state} /> : null}
          {next !== null && !(device !== null && (device.state === "starting" || device.state === "code") && device.itemId === next.id) ? (
            <NextStepCard state={state} item={next} hostId={state.nextStep!.hostId} />
          ) : null}
          {showManifestCard ? <ManifestCard state={state} /> : null}
          {state.manifest.status === "error" && state.manifest.teamName !== null && state.manifest.error !== null ? (
            <Card tone="attention">
              <p className="text-sm">
                The latest manifest couldn't be used, so this list is from the last good one. {state.manifest.error}
              </p>
            </Card>
          ) : null}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              {state.manifest.teamName !== null ? `${state.manifest.teamName} · ` : ""}
              Your machines: {state.machines.map((machine) => `${machine.name}${machine.online ? "" : " (offline)"}`).join(", ")}
            </p>
            <SafeFixesButton state={state} onChanged={refetch} />
          </div>
          <OtherTerminals state={state} />
          <Checklist state={state} />
          {state.manifest.status === "none" ? <NoManifestNote state={state} /> : null}
        </div>
      </div>
    </ActionsProvider>
  );
}

export function OnboardingHeader(_props: PluginNavPanelProps) {
  const { state, rpc } = useOnboardingState();
  const now = useNow(30_000);
  if (state === null) return null;
  const login = state.account.login;
  // "All machines" only while bb really shares the server's login.
  const shared = state.items.find((item) => item.id === "github.builtin-git")?.results.every((result) => result.facts.builtInGit === "logged in") === true;
  return (
    <div className="flex min-w-0 items-center gap-3 text-xs">
      <span className="hidden min-w-0 truncate text-muted-foreground lg:inline">
        {login === null ? null : (
          <>
            Agents act as <span className="font-medium text-foreground">@{login}</span>
            {state.manifest.githubMode === "builtin" && shared ? " on all machines" : " on the server"}
          </>
        )}
      </span>
      <span className="flex items-center gap-1.5" title={`${state.progress.done} of ${state.progress.total} required items done`}>
        <ProgressRing done={state.progress.done} total={state.progress.total} />
        <span className="tabular-nums">
          {state.progress.done} of {state.progress.total}
        </span>
      </span>
      <span className="hidden text-muted-foreground sm:inline">{state.running ? "Checking…" : `Checked ${timeAgo(state.lastCheckAt, now)}`}</span>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => void rpc.call("recheck", {}).catch((cause) => toast.error(errorText(cause)))}
        disabled={state.running}
      >
        <Icon name={state.running ? "Loading" : "RotateCcw"} className={cn(state.running && "animate-spin")} />
        <span className="hidden sm:inline">Recheck all</span>
      </Button>
    </div>
  );
}

/** The sidebar badge: blocking count, a dot for updates, or a check mark. */
export function OnboardingBadge() {
  const summary = useOnboardingSummary();
  if (summary === null) return null;
  if (summary.badge.kind === "count") {
    return (
      <span
        aria-label={`${summary.badge.count} setup steps left`}
        className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-none text-primary-foreground"
      >
        {summary.badge.count}
      </span>
    );
  }
  if (summary.badge.kind === "dot") {
    return <span aria-label="Updates available" className="inline-block size-2 rounded-full bg-attention" />;
  }
  return <Icon name="Check" aria-label="All set" className="size-3.5 text-success" />;
}

export function HomeSection(_props: PluginHomepageSectionProps) {
  const summary = useOnboardingSummary();
  const navigate = useBbNavigate();
  if (summary === null) return null;
  const open = () => navigate.toPluginPanel(PANEL_PATH);
  return (
    <div className="flex items-center gap-2 text-sm">
      {summary.hasBlocking ? (
        <span className="inline-block size-2 shrink-0 rounded-full bg-primary" />
      ) : summary.hasUpdates ? (
        <span className="inline-block size-2 shrink-0 rounded-full bg-attention" />
      ) : (
        <Icon name="CircleCheck" className="size-4 text-success" />
      )}
      <span className={summary.hasBlocking || summary.hasUpdates ? "" : "text-muted-foreground"}>{summary.homeLine}</span>
      {summary.hasBlocking || summary.hasUpdates ? (
        <>
          <span className="text-muted-foreground">·</span>
          <button type="button" onClick={open} className="text-primary hover:underline">
            Open Onboarding
          </button>
        </>
      ) : null}
    </div>
  );
}

/** Below the host-rendered settings form: where the manifest file is, and whether it is usable. */
export function SettingsSection() {
  const rpc = useOnboardingRpc();
  const settings = useSettings();
  const [info, setInfo] = useState<{ path: string; exists: boolean; sha: string | null; mtime: string | null; issues: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const setting = String(settings.values?.manifestFile ?? "");
  useEffect(() => {
    let live = true;
    rpc.call("manifestFile", null).then(
      (next) => live && setInfo(next),
      (cause) => live && setError(errorText(cause)),
    );
    return () => {
      live = false;
    };
  }, [rpc, setting]);
  if (error !== null) return <p className="text-sm text-destructive">{error}</p>;
  if (info === null) return <p className="text-sm text-muted-foreground">Reading the manifest file…</p>;
  return (
    <div className="space-y-1.5 text-sm" aria-label="Manifest file">
      <p>
        <span className="text-muted-foreground">Manifest file: </span>
        <code className="break-all font-mono text-xs">{info.path}</code>
      </p>
      {!info.exists ? (
        <p className="text-muted-foreground">
          Not there yet. Install one on the bb server with <code className="font-mono text-xs">{installCommand()}</code>.
        </p>
      ) : (
        <p className="text-muted-foreground">
          sha256 <code className="font-mono text-xs">{info.sha?.slice(0, 12) ?? "?"}</code>
          {info.mtime === null ? null : ` · changed ${new Date(info.mtime).toLocaleString()}`}
        </p>
      )}
      {info.issues.length > 0 ? (
        <ul role="alert" className="list-disc pl-5 font-mono text-xs text-destructive">
          {info.issues.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      ) : info.exists ? (
        <p className="text-success">Valid.</p>
      ) : null}
    </div>
  );
}

export { useActions };
