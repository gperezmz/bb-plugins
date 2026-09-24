/**
 * The custom settings section: Test connection, harness setup
 * snippets, backfill progress with pause and resume, and Export all.
 * Declared settings cannot render buttons, so these live here.
 */
import { useState } from "react";
import { useRealtime, useSettings } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { SETUP_SNIPPETS } from "../core/attribution-snippets";
import type { ConnectionCheck, SettingsStatus } from "../core/report-types";
import { download, Icon, Panel, SectionTitle, useLive, useUsageRpc } from "./common";
import { Snippet } from "./UsagePanel";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function SettingsPanel() {
  const rpc = useUsageRpc();
  const { values } = useSettings();
  const adapter = values?.adapter === "litellm" ? "litellm" : "none";
  const { data: status, reload } = useLive(() => rpc.call("status", null), [rpc]);
  useRealtime("backfill-changed", reload);
  return (
    <div className="space-y-6">
      <ConnectionTest adapter={adapter} />
      <section>
        <SectionTitle>Tag requests from Codex and pi</SectionTitle>
        <p className="mb-2 text-sm text-muted-foreground">
          Claude Code threads are tagged automatically. Codex and pi read the session id from{" "}
          <code className="font-mono text-xs">BB_USAGE_SESSION</code>, which this plugin sets per thread; add one line to
          their own config so the gateway can attribute spend to the thread.
        </p>
        <Snippet label={`Codex: ${SETUP_SNIPPETS.codex.file}`} code={SETUP_SNIPPETS.codex.snippet} />
        <Snippet label={`pi: ${SETUP_SNIPPETS.pi.file}`} code={SETUP_SNIPPETS.pi.snippet} />
        <p className="mt-2 text-xs text-muted-foreground">
          Cursor cannot use a custom gateway, so its threads have no token or cost data.
        </p>
      </section>
      {status !== null ? <Backfill status={status} onChange={reload} /> : null}
      {status !== null ? <Prices status={status} /> : null}
      <ExportAll />
    </div>
  );
}

const STATUS_STYLE: Record<ConnectionCheck["status"], { icon: string; className: string; label: string }> = {
  pass: { icon: "CircleCheck", className: "text-success", label: "Pass" },
  fail: { icon: "CircleX", className: "text-destructive", label: "Fail" },
  warn: { icon: "AlertCircle", className: "text-warning", label: "Warning" },
  skipped: { icon: "Circle", className: "text-muted-foreground", label: "Skipped" },
};

function ConnectionTest({ adapter }: { adapter: "none" | "litellm" }) {
  const rpc = useUsageRpc();
  const [running, setRunning] = useState(false);
  const [checks, setChecks] = useState<ConnectionCheck[] | null>(null);
  const run = async () => {
    setRunning(true);
    try {
      setChecks((await rpc.call("testConnection", null)).checks);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setRunning(false);
    }
  };
  const failed = checks?.find((c) => c.status === "fail");
  return (
    <section>
      <SectionTitle>Gateway connection</SectionTitle>
      {adapter !== "litellm" ? (
        <p className="text-sm text-muted-foreground">
          Choose the <span className="font-medium text-foreground">litellm</span> adapter above to read exact cost from
          a LiteLLM gateway. Until then, cost is estimated from tokens and list prices.
        </p>
      ) : (
        <>
          <div className="flex items-center gap-3">
            <Button size="sm" onClick={() => void run()} disabled={running}>
              {running ? <Icon name="Loading" className="size-3.5 animate-spin motion-reduce:animate-none" /> : null}
              Test connection
            </Button>
            {checks !== null ? (
              <span className={cn("text-sm", failed ? "text-destructive" : "text-muted-foreground")}>
                {failed ? `“${failed.label}” failed` : "All checks passed"}
              </span>
            ) : null}
          </div>
          {checks !== null ? (
            <Panel className="mt-3 divide-y divide-border">
              {checks.map((c) => (
                <div key={c.id} className="flex items-start gap-2 px-3 py-2 text-sm">
                  <Icon name={STATUS_STYLE[c.status].icon} className={cn("mt-0.5 size-4 shrink-0", STATUS_STYLE[c.status].className)} />
                  <div className="min-w-0">
                    <div className="text-foreground">{c.label}</div>
                    <div className="break-words text-xs text-muted-foreground">{c.detail}</div>
                  </div>
                  <span className="sr-only">{STATUS_STYLE[c.status].label}</span>
                </div>
              ))}
            </Panel>
          ) : null}
        </>
      )}
    </section>
  );
}

function Backfill({ status, onChange }: { status: SettingsStatus; onChange: () => void }) {
  const rpc = useUsageRpc();
  const b = status.backfill;
  const total = b.queued + b.running + b.done + b.failed;
  const act = async (action: "pause" | "resume" | "retry-failed") => {
    await rpc.call("backfill", { action });
    onChange();
  };
  return (
    <section>
      <SectionTitle>History backfill</SectionTitle>
      <p className="mb-2 text-sm text-muted-foreground">
        Threads that existed before the plugin, and gaps while it was stopped, are read from bb's events and the
        harness logs in the background, newest first.
      </p>
      <div className="flex items-center gap-3">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-primary/70" style={{ width: `${total === 0 ? 100 : (b.done / total) * 100}%` }} />
        </div>
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
          {b.done}/{total} done{b.failed > 0 ? ` · ${b.failed} failed` : ""}{b.paused ? " · paused" : ""}
        </span>
        <Button variant="outline" size="sm" onClick={() => void act(b.paused ? "resume" : "pause")}>
          {b.paused ? "Resume" : "Pause"}
        </Button>
        {b.failed > 0 ? (
          <Button variant="ghost" size="sm" onClick={() => void act("retry-failed")}>
            Retry failed
          </Button>
        ) : null}
      </div>
      {status.logsMissing.length > 0 ? (
        <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
          {status.logsMissing.slice(0, 5).map((m) => (
            <li key={m.threadId}>
              Logs on {m.host} unavailable since {new Date(m.since).toLocaleString()} ({m.threadId}); retried every 15 minutes.
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function Prices({ status }: { status: SettingsStatus }) {
  return (
    <section>
      <SectionTitle>Prices</SectionTitle>
      <p className="text-sm text-muted-foreground">
        {status.snapshot.online
          ? `Using LiteLLM's public price list, fetched ${status.snapshot.onlineFetchedAt === null ? "recently" : new Date(status.snapshot.onlineFetchedAt).toLocaleString()}${status.snapshot.modelsDevFetchedAt === null ? "" : `, and models.dev's, fetched ${new Date(status.snapshot.modelsDevFetchedAt).toLocaleString()}`}.`
          : `Using the LiteLLM snapshot bundled with the plugin, from ${status.snapshot.date?.slice(0, 10) ?? "an unknown date"} (${status.snapshot.models} models, commit ${status.snapshot.commit.slice(0, 7)}); no online copy in use.`}{" "}
        {status.snapshot.lastError === null ? "" : `The last refresh failed (${status.snapshot.lastError}); the last good copy stays in use. `}
        Gateway rows always use the gateway's own billed cost.
        {status.gateway.lastSweepAt !== null ? ` Last gateway sweep ${new Date(status.gateway.lastSweepAt).toLocaleTimeString()}.` : ""}
      </p>
    </section>
  );
}

function ExportAll() {
  const rpc = useUsageRpc();
  const [busy, setBusy] = useState(false);
  const run = async (kind: "json" | "csv") => {
    setBusy(true);
    try {
      const result = await rpc.call("exportAll", null);
      const stamp = new Date().toISOString().slice(0, 10);
      if (kind === "json") download(`thread-usage-${stamp}.json`, result.json, "application/json");
      else download(`thread-usage-${stamp}.csv`, result.csv, "text/csv");
      toast.success(`Exported ${result.threads} threads`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section>
      <SectionTitle>Export all</SectionTitle>
      <p className="mb-2 text-sm text-muted-foreground">
        Every thread total, turn record and gateway row the plugin knows. Uninstalling the plugin deletes its settings
        and read key but keeps its database; export to keep a copy elsewhere.
      </p>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" disabled={busy} onClick={() => void run("json")}>
          <Icon name="Download" className="size-3.5" />
          JSON
        </Button>
        <Button variant="outline" size="sm" disabled={busy} onClick={() => void run("csv")}>
          <Icon name="Download" className="size-3.5" />
          CSV
        </Button>
      </div>
    </section>
  );
}
