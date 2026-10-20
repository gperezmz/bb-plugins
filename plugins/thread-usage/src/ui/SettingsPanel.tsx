/**
 * The custom settings section: backfill progress with pause and resume, the
 * price list in use, and Export all. Declared settings cannot render
 * buttons, so these live here.
 */
import { useState } from "react";
import { useRealtime } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { pricesLabel } from "../core/format";
import type { SettingsStatus } from "../core/report-types";
import { download, Icon, SectionTitle, useLive, useUsageRpc } from "./common";
import { Button } from "@/components/ui/button";

export function SettingsPanel() {
  const rpc = useUsageRpc();
  const { data: status, reload } = useLive(() => rpc.call("status", null), [rpc]);
  useRealtime("backfill-changed", reload);
  return (
    <div className="space-y-6">
      {status !== null ? <Backfill status={status} onChange={reload} /> : null}
      {status !== null ? <Prices status={status} /> : null}
      <ExportAll />
    </div>
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
  const { prices } = status;
  return (
    <section>
      <SectionTitle>Prices</SectionTitle>
      <p className="text-sm text-muted-foreground">
        {pricesLabel(prices, Date.now())}. The list holds {prices.models.toLocaleString("en-US")} models.
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
        Every thread total and turn record the plugin knows. Uninstalling the plugin deletes its settings but keeps its
        database; export to keep a copy elsewhere.
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
