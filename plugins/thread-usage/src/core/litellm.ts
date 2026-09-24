/**
 * The `litellm` gateway adapter: one incremental sweep over
 * `/spend/logs/v2`, the optional `/model/info` price map, and the four Test
 * connection checks. Network access goes through an injected `fetch`
 * so tests run against a fake server.
 */
import { gatewayPricesFromModelInfo, type ModelPrice } from "./pricing";
import { SESSION_PREFIX, threadIdFromSession, type GatewayRow } from "./gateway";

export type Fetch = typeof fetch;

export interface LiteLlmConfig {
  baseUrl: string;
  key: string;
  fetch: Fetch;
  timeoutMs?: number;
}

export class GatewayError extends Error {
  constructor(
    message: string,
    readonly check: ConnectionCheckId,
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = "GatewayError";
  }
}

export const PAGE_SIZE = 1000;
/** A sweep re-reads this far before the last one, for late-landing rows. */
export const SWEEP_OVERLAP_MS = 5 * 60_000;
/** Hard cap on pages per sweep; the next sweep continues. */
export const MAX_PAGES = 50;

export function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

/** A URL's origin, without userinfo, path or query; the input itself when it does not parse. */
function safeOrigin(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return "the gateway URL";
  }
}

/** Hostname of a URL, or null when it does not parse. */
export function hostOf(url: string | null | undefined): string | null {
  if (typeof url !== "string" || url.trim() === "") return null;
  try {
    return new URL(url.trim()).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** LiteLLM dates: `YYYY-MM-DD HH:MM:SS` in UTC. */
export function formatLiteLlmDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 19).replace("T", " ");
}

function parseTime(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || value === "") return null;
  // LiteLLM returns ISO strings, sometimes without a zone; those are UTC.
  const hasZone = /[zZ]|[+-]\d\d:?\d\d$/.test(value);
  const ms = Date.parse(hasZone ? value : `${value.replace(" ", "T")}Z`);
  return Number.isNaN(ms) ? null : ms;
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** Converts one `/spend/logs/v2` row, or null when it names no bb thread. */
export function parseSpendRow(raw: unknown): GatewayRow | null {
  if (raw === null || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const threadId = threadIdFromSession(r.session_id as string | undefined);
  if (threadId === null) return null;
  const requestId = typeof r.request_id === "string" ? r.request_id : null;
  const start = parseTime(r.startTime);
  if (requestId === null || start === null) return null;
  const model =
    typeof r.model === "string" && r.model !== ""
      ? r.model
      : typeof r.model_group === "string" && r.model_group !== ""
        ? r.model_group
        : null;
  return {
    requestId,
    threadId,
    startTime: start,
    endTime: parseTime(r.endTime),
    model,
    promptTokens: num(r.prompt_tokens),
    completionTokens: num(r.completion_tokens),
    spend: num(r.spend),
    durationMs:
      typeof r.request_duration_ms === "number" && Number.isFinite(r.request_duration_ms)
        ? r.request_duration_ms
        : null,
    status: typeof r.status === "string" ? r.status : null,
  };
}

async function getJson(
  config: LiteLlmConfig,
  path: string,
  params: Record<string, string>,
  check: ConnectionCheckId,
): Promise<unknown> {
  const url = new URL(`${normalizeBaseUrl(config.baseUrl)}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  let res: Response;
  try {
    res = await config.fetch(url, {
      headers: { authorization: `Bearer ${config.key}`, accept: "application/json" },
      signal: AbortSignal.timeout(config.timeoutMs ?? 20_000),
    });
  } catch (error) {
    throw new GatewayError(
      `Could not reach ${url.origin}: ${error instanceof Error ? error.message : String(error)}`,
      "reachable",
    );
  }
  if (res.status === 401) {
    throw new GatewayError(`${path} answered 401: the read key is not valid`, "key-valid", 401);
  }
  if (res.status === 403) {
    throw new GatewayError(
      `${path} answered 403: the read key may not read spend logs`,
      "spend-readable",
      403,
    );
  }
  if (res.status === 404) {
    throw new GatewayError(
      `${path} answered 404: the route is not exposed at this URL`,
      "spend-readable",
      404,
    );
  }
  if (!res.ok) {
    throw new GatewayError(`${path} answered HTTP ${res.status}`, "reachable", res.status);
  }
  try {
    return await res.json();
  } catch {
    throw new GatewayError(`${path} did not return JSON`, "reachable", res.status);
  }
}

export interface SweepResult {
  rows: GatewayRow[];
  /** Rows the gateway returned in total, bb or not. */
  scanned: number;
  pages: number;
  /** True when the page cap or LiteLLM's 10,000-row total cap stopped the sweep early. */
  truncated: boolean;
  /** When truncated: the start time of the newest row read; the next sweep continues from it. */
  resumeFrom: number | null;
}

/**
 * Reads every row whose session id contains `bb-thr_` between `fromMs` and
 * `toMs`. `session_id` is a substring match, so rows are re-checked here.
 *
 * Rows are read oldest first: LiteLLM caps `total` (and so `total_pages`) at
 * 10,000 rows and reports `total_is_capped`, so a capped sweep keeps the
 * oldest rows and the next one resumes from the newest row it read.
 */
export async function sweepSpendLogs(
  config: LiteLlmConfig,
  fromMs: number,
  toMs: number,
): Promise<SweepResult> {
  const rows: GatewayRow[] = [];
  let scanned = 0;
  let page = 1;
  let totalPages = 1;
  let capped = false;
  let newest: number | null = null;
  do {
    const body = (await getJson(
      config,
      "/spend/logs/v2",
      {
        session_id: `${SESSION_PREFIX}thr_`,
        start_date: formatLiteLlmDate(fromMs),
        end_date: formatLiteLlmDate(toMs),
        page: String(page),
        page_size: String(PAGE_SIZE),
        sort_by: "startTime",
        sort_order: "asc",
      },
      "spend-readable",
    )) as { data?: unknown; total_pages?: unknown; total_is_capped?: unknown };
    const data = Array.isArray(body?.data) ? body.data : [];
    scanned += data.length;
    for (const raw of data) {
      const start = parseTime((raw as Record<string, unknown> | null)?.startTime);
      if (start !== null && (newest === null || start > newest)) newest = start;
      const row = parseSpendRow(raw);
      if (row !== null) rows.push(row);
    }
    totalPages = typeof body?.total_pages === "number" ? body.total_pages : 1;
    capped = body?.total_is_capped === true;
    page += 1;
  } while (page <= totalPages && page <= MAX_PAGES);
  const truncated = page <= totalPages || (capped && scanned > 0);
  return { rows, scanned, pages: page - 1, truncated, resumeFrom: truncated ? newest : null };
}

export async function fetchModelInfo(config: LiteLlmConfig): Promise<Record<string, ModelPrice>> {
  const body = await getJson(config, "/model/info", {}, "reachable");
  return gatewayPricesFromModelInfo(body);
}

import { CHECK_LABELS, type ConnectionCheckId } from "./litellm-labels";
export { CHECK_LABELS, type ConnectionCheckId };

export interface ConnectionCheck {
  id: ConnectionCheckId;
  label: string;
  status: "pass" | "fail" | "warn" | "skipped";
  detail: string;
}


/**
 * Runs the four Test connection checks in order. A failed check skips the
 * checks after it. The last one warns rather than fails when no thread has
 * run yet (`anyThreadRan` false).
 */
export async function testConnection(
  config: LiteLlmConfig,
  now: number,
  anyThreadRan: boolean,
): Promise<ConnectionCheck[]> {
  const base = normalizeBaseUrl(config.baseUrl);
  const results: ConnectionCheck[] = [];
  const add = (id: ConnectionCheckId, status: ConnectionCheck["status"], detail: string) =>
    results.push({ id, label: CHECK_LABELS[id], status, detail });
  const skipRest = (from: ConnectionCheckId[]) => {
    for (const id of from) add(id, "skipped", "Skipped: an earlier check failed");
  };

  // 1. Reachable: any HTTP answer from the liveliness route counts.
  try {
    const res = await config.fetch(`${base}/health/liveliness`, {
      signal: AbortSignal.timeout(config.timeoutMs ?? 10_000),
    });
    add("reachable", "pass", `${new URL(base).origin} answered HTTP ${res.status}`);
  } catch (error) {
    add(
      "reachable",
      "fail",
      `No answer from ${safeOrigin(base)}: ${error instanceof Error ? error.message : String(error)}`,
    );
    skipRest(["key-valid", "spend-readable", "sees-rows"]);
    return results;
  }

  // 2. Key valid: /key/info answers for the key itself.
  try {
    const res = await config.fetch(`${base}/key/info`, {
      headers: { authorization: `Bearer ${config.key}` },
      signal: AbortSignal.timeout(config.timeoutMs ?? 10_000),
    });
    if (res.status === 401 || res.status === 403) {
      add("key-valid", "fail", `/key/info answered ${res.status}: the key was refused`);
      skipRest(["spend-readable", "sees-rows"]);
      return results;
    }
    add("key-valid", "pass", `/key/info answered HTTP ${res.status}`);
  } catch (error) {
    add("key-valid", "fail", error instanceof Error ? error.message : String(error));
    skipRest(["spend-readable", "sees-rows"]);
    return results;
  }

  // 3. and 4. Spend route readable, and bb rows visible.
  const weekAgo = now - 7 * 86_400_000;
  try {
    const body = (await getJson(
      config,
      "/spend/logs/v2",
      {
        session_id: `${SESSION_PREFIX}thr_`,
        start_date: formatLiteLlmDate(weekAgo),
        end_date: formatLiteLlmDate(now),
        page: "1",
        page_size: "50",
      },
      "spend-readable",
    )) as { data?: unknown };
    add("spend-readable", "pass", "/spend/logs/v2 answered with spend rows");
    const rows = (Array.isArray(body?.data) ? body.data : [])
      .map(parseSpendRow)
      .filter((r): r is GatewayRow => r !== null);
    if (rows.length > 0) {
      add("sees-rows", "pass", `Found ${rows.length}${rows.length === 50 ? "+" : ""} bb- rows`);
    } else {
      add(
        "sees-rows",
        anyThreadRan ? "fail" : "warn",
        anyThreadRan
          ? "No bb- rows in the last 7 days: requests are not tagged, or the key cannot see them"
          : "No bb- rows yet; run a thread through the gateway, then test again",
      );
    }
  } catch (error) {
    // /key/info already accepted the key, so a refusal here is about the
    // route: LiteLLM answers 401, not 403, to roles that may not read spend logs.
    const detail =
      error instanceof GatewayError && error.status === 401
        ? "/spend/logs/v2 answered 401 although /key/info accepted the key: this key's role may not read spend logs (use a proxy_admin_viewer or internal_user key)"
        : error instanceof Error
          ? error.message
          : String(error);
    add("spend-readable", "fail", detail);
    skipRest(["sees-rows"]);
  }
  return results;
}
