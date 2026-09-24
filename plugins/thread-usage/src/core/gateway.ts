/**
 * Gateway request rows: assignment to turns and the
 * session-id tag that attributes them to threads.
 */

/** One request as the gateway logged it. */
export interface GatewayRow {
  requestId: string;
  threadId: string;
  /** Epoch ms. */
  startTime: number;
  endTime: number | null;
  model: string | null;
  promptTokens: number;
  completionTokens: number;
  spend: number;
  durationMs: number | null;
  status: string | null;
}

export const SESSION_PREFIX = "bb-";
/** Rows landing this long after a turn completed still belong to it. */
export const TURN_GRACE_MS = 30_000;

export function sessionIdFor(threadId: string): string {
  return `${SESSION_PREFIX}${threadId}`;
}

/** The bb thread id a gateway session id names, or null. */
export function threadIdFromSession(sessionId: string | null | undefined): string | null {
  if (typeof sessionId !== "string") return null;
  const match = /^bb-(thr_[A-Za-z0-9_-]+)$/.exec(sessionId.trim());
  return match === null ? null : (match[1] as string);
}

/** A gateway row with spend 0 but output tokens is unpriced, not free. */
export function isUnpricedRow(row: GatewayRow): boolean {
  return row.spend <= 0 && row.completionTokens > 0;
}

export interface TurnWindow {
  turnId: string;
  startedAt: number;
  /** Null while the turn runs. */
  completedAt: number | null;
}

export const OUTSIDE_TURNS = "outside";

/**
 * Assigns each row to the turn whose `[started, completed + 30 s]` window
 * contains its start time, or to {@link OUTSIDE_TURNS}.
 *
 * When windows overlap (a row in one turn's grace period after the next turn
 * started), a turn whose `[started, completed]` span contains the row wins,
 * then the latest-started turn.
 */
export function assignRowsToTurns(
  rows: readonly GatewayRow[],
  turns: readonly TurnWindow[],
  now: number,
): Map<string, GatewayRow[]> {
  const sorted = [...turns].sort((a, b) => a.startedAt - b.startedAt);
  const out = new Map<string, GatewayRow[]>();
  const push = (key: string, row: GatewayRow) => {
    const list = out.get(key);
    if (list === undefined) out.set(key, [row]);
    else list.push(row);
  };
  for (const row of rows) {
    let strict: TurnWindow | null = null;
    let grace: TurnWindow | null = null;
    for (const turn of sorted) {
      if (row.startTime < turn.startedAt) break;
      const end = turn.completedAt ?? now;
      if (row.startTime <= end) strict = turn;
      else if (row.startTime <= end + TURN_GRACE_MS) grace = turn;
    }
    const chosen = strict ?? grace;
    push(chosen === null ? OUTSIDE_TURNS : chosen.turnId, row);
  }
  return out;
}
