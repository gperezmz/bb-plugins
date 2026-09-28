/**
 * What a Claude Code transcript says about a thread's cache: when its last
 * request ran, which cache lifetime Anthropic applied, how big its context
 * is, and how many requests a user message costs.
 *
 * One API response is written as several assistant lines sharing
 * `message.id` and `requestId`; they count as one request. The fold is
 * incremental: lines are fed in file order, as they are appended.
 */
import type { CacheLifetime } from "./line";
import { isKeeperMessage } from "./messages";

/** A request in the transcript, as the cost of a check-in reads it. */
export interface TranscriptRequest {
  at: number;
  model: string | null;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
}

export interface TranscriptFacts {
  /** Epoch ms of the most recent request; null before the first. */
  lastRequestAt: number | null;
  /** Cache lifetime of the most recent request that wrote to the cache. */
  lifetime: CacheLifetime | null;
  /** Input size of the most recent request, or the post-compaction size of a later compaction. */
  context: number | null;
  model: string | null;
  requests: number;
  userMessages: number;
  lastCompaction: { at: number; preTokens: number | null; postTokens: number } | null;
}

export const EMPTY_FACTS: TranscriptFacts = {
  lastRequestAt: null,
  lifetime: null,
  context: null,
  model: null,
  requests: 0,
  userMessages: 0,
  lastCompaction: null,
};

type Json = Record<string, unknown>;
const rec = (v: unknown): Json => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const toMs = (v: unknown): number | null => {
  if (typeof v !== "string") return null;
  const ms = Date.parse(v);
  return Number.isNaN(ms) ? null : ms;
};

/** The text of a user line, or null for a tool result, a meta line or a compaction summary. */
function userText(line: Json): string | null {
  if (line.type !== "user" || line.isMeta === true || line.isCompactSummary === true || line.isSidechain === true) return null;
  const content = rec(line.message).content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content) || content.some((block) => rec(block).type === "tool_result")) return null;
  const texts = content.filter((block) => rec(block).type === "text").map((block) => str(rec(block).text) ?? "");
  return texts.length === 0 ? null : texts.join("\n");
}

/** Lines Claude Code writes as the user without anyone typing them, and `/compact` itself. */
const NOT_TYPED = /^\s*<(task-notification|local-command-stdout|local-command-stderr|local-command-caveat)>|<command-name>\/compact<\/command-name>/;

/** Reads one request from an assistant line, or null. */
export function requestOf(line: Json): (TranscriptRequest & { key: string }) | null {
  if (line.type !== "assistant" || line.isSidechain === true) return null;
  const message = rec(line.message);
  const usage = rec(message.usage);
  const model = str(message.model);
  if (model === "<synthetic>" || Object.keys(usage).length === 0) return null;
  const at = toMs(line.timestamp);
  if (at === null) return null;
  const creation = rec(usage.cache_creation);
  let write5m = num(creation.ephemeral_5m_input_tokens);
  const write1h = num(creation.ephemeral_1h_input_tokens);
  // Older transcripts carry only the total, which Anthropic wrote at 5 minutes.
  if (write5m + write1h === 0) write5m = num(usage.cache_creation_input_tokens);
  const id = str(message.id);
  const requestId = str(line.requestId);
  return {
    key: id !== null && requestId !== null ? `${id}:${requestId}` : `${at}`,
    at,
    model,
    input: num(usage.input_tokens),
    output: num(usage.output_tokens),
    cacheRead: num(usage.cache_read_input_tokens),
    cacheWrite5m: write5m,
    cacheWrite1h: write1h,
  };
}

/**
 * Where a fold stands between reads, so the next read carries on from the
 * byte it stopped at instead of from the start. It holds the facts and the
 * little the fold needs to read on, not the requests themselves.
 */
export interface FoldState {
  facts: TranscriptFacts;
  lastKey: string | null;
  /** Null before the first request or compaction. */
  contextAt: number | null;
  keeperTurn: boolean;
  awaitingRequest: boolean;
}

/**
 * How far a transcript has been read: which file, by its slug and inode, how
 * many bytes of it, and where the fold over them stands. The server keeps it,
 * so a restarted daemon, host or plugin reads on from `offset`.
 */
export interface TranscriptCursor {
  cwdSlug: string;
  ino: number;
  offset: number;
  fold: FoldState;
}

/** Incremental fold over a transcript's lines. */
export class TranscriptFold {
  private facts: TranscriptFacts = { ...EMPTY_FACTS };
  private lastKey: string | null = null;
  private contextAt = -Infinity;
  private readonly recent: (TranscriptRequest & { key: string })[] = [];
  /** Inside a turn a Cache Keeper message started: its requests are not the user's calls per message. */
  private keeperTurn = false;
  /**
   * A typed message not yet followed by a request. It counts as a user message
   * only once a request follows, so a local command such as /model, and the
   * copies Claude Code writes again after compacting, do not.
   */
  private awaitingRequest = false;

  /**
   * `toClock` puts a line's wall time on the plugin's clock; `from` carries
   * on from where an earlier fold stood.
   */
  constructor(
    private readonly keepRecent = 200,
    private readonly toClock: (wall: number) => number = (wall) => wall,
    from: FoldState | null = null,
  ) {
    if (from !== null) {
      this.facts = { ...from.facts, lastCompaction: from.facts.lastCompaction === null ? null : { ...from.facts.lastCompaction } };
      this.lastKey = from.lastKey;
      this.contextAt = from.contextAt ?? -Infinity;
      this.keeperTurn = from.keeperTurn;
      this.awaitingRequest = from.awaitingRequest;
    }
  }

  state(): FoldState {
    return {
      facts: this.result(),
      lastKey: this.lastKey,
      contextAt: Number.isFinite(this.contextAt) ? this.contextAt : null,
      keeperTurn: this.keeperTurn,
      awaitingRequest: this.awaitingRequest,
    };
  }

  add(line: Json): void {
    if (line.type === "system" && line.subtype === "compact_boundary") {
      const meta = rec(line.compactMetadata);
      const wall = toMs(line.timestamp);
      const at = wall === null ? null : this.toClock(wall);
      const post = num(meta.postTokens);
      if (at !== null && post > 0) {
        this.facts.lastCompaction = { at, preTokens: typeof meta.preTokens === "number" ? meta.preTokens : null, postTokens: post };
        if (at >= this.contextAt) {
          this.facts.context = post;
          this.contextAt = at;
        }
      }
      return;
    }
    const text = userText(line);
    if (text !== null && text.trim() !== "" && !NOT_TYPED.test(text)) {
      this.keeperTurn = isKeeperMessage(text);
      this.awaitingRequest = !this.keeperTurn;
      return;
    }
    const read = requestOf(line);
    if (read === null) return;
    const request = { ...read, at: this.toClock(read.at) };
    if (request.key !== this.lastKey) {
      if (this.awaitingRequest) {
        this.facts.userMessages += 1;
        this.awaitingRequest = false;
      }
      if (!this.keeperTurn) this.facts.requests += 1;
      this.lastKey = request.key;
      this.recent.push(request);
      if (this.recent.length > this.keepRecent) this.recent.shift();
    } else {
      this.recent[this.recent.length - 1] = request;
    }
    if (this.facts.lastRequestAt === null || request.at >= this.facts.lastRequestAt) {
      this.facts.lastRequestAt = request.at;
      this.facts.model = request.model;
    }
    if (request.cacheWrite5m > 0) this.facts.lifetime = "5m";
    else if (request.cacheWrite1h > 0) this.facts.lifetime = "1h";
    if (request.at >= this.contextAt) {
      this.facts.context = request.input + request.cacheRead + request.cacheWrite5m + request.cacheWrite1h;
      this.contextAt = request.at;
    }
  }

  result(): TranscriptFacts {
    return { ...this.facts, lastCompaction: this.facts.lastCompaction === null ? null : { ...this.facts.lastCompaction } };
  }

  /** Requests at or after `since`, oldest first, from the most recent ones kept. */
  requestsSince(since: number): TranscriptRequest[] {
    return this.recent.filter((r) => r.at >= since).map(({ key: _key, ...r }) => r);
  }
}

/**
 * Mean requests per user message, or the default for a thread with none.
 * `keeperReports` are bb's reports that started Cache Keeper turns: the
 * transcript cannot tell them from a real report, so they are taken out here.
 */
export function callsPerMessage(
  facts: Pick<TranscriptFacts, "requests" | "userMessages">,
  fallback: number,
  keeperReports: { turns: number; requests: number } = { turns: 0, requests: 0 },
): number {
  const messages = facts.userMessages - keeperReports.turns;
  return messages > 0 ? Math.max(0, facts.requests - keeperReports.requests) / messages : fallback;
}

/** The minute before the cache expires in which Cache Keeper acts. */
export const CACHE_MARGIN_MS = 60_000;

/** When the cache expires, less the minute Cache Keeper acts before it; null without a request or lifetime. */
export function deadlineOf(facts: Pick<TranscriptFacts, "lastRequestAt" | "lifetime">): number | null {
  if (facts.lastRequestAt === null || facts.lifetime === null) return null;
  return facts.lastRequestAt + lifetimeMs(facts.lifetime) - CACHE_MARGIN_MS;
}

export function lifetimeMs(lifetime: CacheLifetime): number {
  return lifetime === "5m" ? 5 * 60_000 : 60 * 60_000;
}
