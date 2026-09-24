/**
 * Hooks and small presentational pieces shared by the tab, the header chip,
 * the Usage page and the settings page. Styling uses host token classes only.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  experimental_Icon as HostIcon,
  experimental_ProviderIcon as ProviderIcon,
  experimental_useProviders as useProviders,
  useRealtime,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import type { RpcContract } from "../server/rpc";
import type { Tokens } from "../core/tokens";
import { formatExactTokens, formatPercent, formatTokens } from "../core/format";
import { cn } from "@/lib/utils";

export const PLUGIN_ID = "thread-usage";
export const COIN_ICON = `${PLUGIN_ID}/coin`;
export const USAGE_ACTION_ID = "usage";

export function useUsageRpc() {
  return useRpc<RpcContract>();
}

/** Loads a value over RPC, refetching on the plugin's change signal. */
export function useLive<T>(
  load: () => Promise<T>,
  deps: readonly unknown[],
  relevant: (payload: unknown) => boolean = () => true,
): { data: T | null; error: string | null; reload: () => void; loading: boolean } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);
  const reload = useCallback(() => {
    const mine = ++seq.current;
    setLoading(true);
    load().then(
      (value) => {
        if (mine !== seq.current) return;
        setData(value);
        setError(null);
        setLoading(false);
      },
      (cause: unknown) => {
        if (mine !== seq.current) return;
        setError(cause instanceof Error ? cause.message : String(cause));
        setLoading(false);
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => {
    reload();
  }, [reload]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useRealtime("usage-changed", (payload: unknown) => {
    if (!relevant(payload)) return;
    // Coalesce bursts (one signal per second per busy thread).
    if (timer.current !== null) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      reload();
    }, 400);
  });
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );
  return { data, error, reload, loading };
}

/** True when a `usage-changed` payload names one of these threads (or all). */
export function touches(payload: unknown, threadIds: readonly string[]): boolean {
  const ids = (payload as { threadIds?: unknown } | null)?.threadIds;
  if (!Array.isArray(ids) || ids.length === 0) return true;
  return ids.some((id) => threadIds.includes(id as string));
}

export function CoinIcon({ className }: { className?: string }) {
  return <HostIcon name={COIN_ICON} fallback="Circle" className={cn("size-4", className)} aria-hidden />;
}

export function Icon({ name, className }: { name: string; className?: string }) {
  return <HostIcon name={name} className={cn("size-4", className)} aria-hidden />;
}

export function HarnessIcon({ providerId, className }: { providerId: string | null; className?: string }) {
  const { providers } = useProviders();
  if (providerId === null) return <span className={cn("inline-block size-3.5", className)} />;
  const provider = providers.find((p) => p.id === providerId) ?? { id: providerId };
  const name = (provider as { displayName?: string }).displayName ?? providerId;
  return (
    <ProviderIcon
      providerKind="agent"
      provider={provider}
      className={cn("size-3.5 shrink-0 text-muted-foreground", className)}
      aria-label={name}
    />
  );
}

export function useProviderName(): (id: string | null) => string {
  const { providers } = useProviders();
  return (id) => {
    if (id === null) return "Unknown";
    return (providers.find((p) => p.id === id) as { displayName?: string } | undefined)?.displayName ?? id;
  };
}

export function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-2 flex items-center justify-between gap-2">
      <h3 className="text-xs font-medium text-muted-foreground">{children}</h3>
      {aside}
    </div>
  );
}

export function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-lg border border-border bg-card text-card-foreground", className)}>
      {children}
    </div>
  );
}

/** A small outlined label beside a row's text. */
export function Tag({ children }: { children: ReactNode }) {
  return (
    <span className="shrink-0 rounded border border-border px-1 text-[10px] leading-4 text-muted-foreground">
      {children}
    </span>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div
      role="status"
      className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground"
    >
      {children}
    </div>
  );
}

export const TOKEN_KINDS = [
  { key: "input", label: "Input", swatch: "bg-primary/80" },
  { key: "output", label: "Output", swatch: "bg-primary" },
  { key: "cacheRead", label: "Cache read", swatch: "bg-muted-foreground/65" },
  { key: "cacheWrite", label: "Cache write", swatch: "bg-[color-mix(in_oklab,var(--success)_70%,var(--foreground))]" },
] as const;

/** One stacked bar for input, output, cache read, cache write (and tokens outside bb's view). */
export function TokenBar({
  tokens,
  untracked = 0,
  className,
}: {
  tokens: Tokens;
  untracked?: number;
  className?: string;
}) {
  const parts = [
    ...TOKEN_KINDS.map((k) => ({ label: k.label, value: tokens[k.key], swatch: k.swatch })),
    { label: "Outside bb's view", value: untracked, swatch: "bg-warning/60" },
  ].filter((p) => p.value > 0);
  const total = parts.reduce((n, p) => n + p.value, 0);
  return (
    <div
      className={cn("flex h-2 w-full overflow-hidden rounded-full bg-muted", className)}
      role="img"
      aria-label={
        total === 0
          ? "No tokens"
          : parts.map((p) => `${p.label} ${formatPercent(p.value / total)}`).join(", ")
      }
    >
      {parts.map((p) => (
        <div
          key={p.label}
          className={cn("h-full first:rounded-l-full last:rounded-r-full", p.swatch)}
          style={{ width: `${(p.value / total) * 100}%`, minWidth: p.value > 0 ? 2 : 0 }}
        />
      ))}
    </div>
  );
}

export function TokenLegend({ tokens, untracked = 0, compact = false }: { tokens: Tokens; untracked?: number; compact?: boolean }) {
  const rows = [
    ...TOKEN_KINDS.map((k) => ({ label: k.label, value: tokens[k.key], swatch: k.swatch })),
    ...(untracked > 0 ? [{ label: "Outside bb's view", value: untracked, swatch: "bg-warning/60" }] : []),
  ];
  return (
    <dl
      className={cn(
        "grid gap-x-6 gap-y-1 text-xs",
        compact
          ? "grid-cols-[repeat(auto-fit,minmax(9.5rem,1fr))] gap-x-4"
          : "grid-cols-[repeat(auto-fit,minmax(min(100%,12.5rem),1fr))]",
      )}
    >
      {rows.map((r) => (
        <div key={r.label} className="flex min-w-0 items-center gap-1.5">
          <span className={cn("size-2 shrink-0 rounded-sm", r.swatch)} aria-hidden />
          <dt className="min-w-0 text-muted-foreground">{r.label}</dt>
          <dd className="ml-auto font-medium tabular-nums text-foreground" title={formatExactTokens(r.value)}>
            {compact ? formatTokens(r.value) : formatExactTokens(r.value)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Copies text; returns a state flag for a short "Copied" confirmation. */
export function useCopy(): [boolean, (text: string) => Promise<void>] {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(async (text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, []);
  return [copied, copy];
}

export function download(filename: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
