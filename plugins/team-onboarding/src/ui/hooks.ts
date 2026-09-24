// Data hooks: the checklist state over RPC, kept fresh by realtime
// invalidations. Details are always fetched over RPC, never pushed.
import { useCallback, useEffect, useRef, useState } from "react";
import { useRealtime, useRealtimeConnectionState, useRpc } from "@get-bb/plugin-sdk/app";
import type { ActionInput, ActionResult, OnboardingState, OnboardingSummary, RpcContract } from "../contract/rpc.js";

export const CHANGED_CHANNEL = "team-onboarding.changed";
export const DEVICE_CHANNEL = "team-onboarding.device";
export const PANEL_PATH = "onboarding";
export const PANEL_ID = "onboarding";

export function useOnboardingRpc() {
  return useRpc<RpcContract>();
}

/**
 * Actions that need the engineer (approvals, fixes outside the safe list,
 * logins, variables, terminals) go through a same-origin HTTP route, never
 * RPC, so only this page can take them.
 */
export async function postAction(input: ActionInput): Promise<ActionResult> {
  // A browser driven by automation (an agent's, say) reports itself; the
  // engineer's own browser doesn't. A script could hide the flag, so this
  // narrows the gap rather than closing it (docs/explanation/team-onboarding-checks.md).
  if (typeof navigator !== "undefined" && navigator.webdriver === true) {
    throw new Error("This needs you: it can't be done from an automated browser.");
  }
  const response = await fetch("/api/v1/plugins/team-onboarding/http/actions", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const body = (await response.json().catch(() => null)) as ActionResult | null;
  if (!response.ok || body === null) throw new Error(body?.message ?? `The action failed (${response.status})`);
  return body;
}

/** Opens an https link only; anything else (javascript:, data:) is ignored. */
export function openHttps(navigate: { openUrl(url: string): boolean }, url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  if (!navigate.openUrl(parsed.href)) window.open(parsed.href, "_blank", "noopener");
  return true;
}

export function errorText(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** The full checklist state, refetched on every invalidation. */
export function useOnboardingState() {
  const rpc = useOnboardingRpc();
  const [state, setState] = useState<OnboardingState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inflight = useRef(false);
  const again = useRef(false);
  const refetch = useCallback(() => {
    if (inflight.current) {
      again.current = true;
      return;
    }
    inflight.current = true;
    rpc
      .call("state")
      .then(
        (next) => {
          setState(next);
          setError(null);
        },
        (cause) => setError(errorText(cause)),
      )
      .finally(() => {
        inflight.current = false;
        if (again.current) {
          again.current = false;
          refetch();
        }
      });
  }, [rpc]);
  useEffect(() => {
    refetch();
  }, [refetch]);
  useRealtime(CHANGED_CHANNEL, refetch);
  useRealtime(DEVICE_CHANNEL, refetch);
  const connection = useRealtimeConnectionState();
  useEffect(() => {
    if (connection === "connected") refetch();
  }, [connection, refetch]);
  return { rpc, state, error, refetch };
}

/** The small summary behind the badge and the home section. */
export function useOnboardingSummary() {
  const rpc = useOnboardingRpc();
  const [summary, setSummary] = useState<OnboardingSummary | null>(null);
  const refetch = useCallback(() => {
    rpc.call("summary").then(setSummary, () => {});
  }, [rpc]);
  useEffect(() => {
    refetch();
  }, [refetch]);
  useRealtime(CHANGED_CHANNEL, refetch);
  return summary;
}

/** Re-renders every `ms` so relative times and countdowns move. */
export function useNow(ms: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(timer);
  }, [ms]);
  return now;
}

export function timeAgo(iso: string | null, now: number): string {
  if (iso === null) return "never";
  const seconds = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
