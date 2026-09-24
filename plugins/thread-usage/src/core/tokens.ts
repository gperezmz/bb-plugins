/**
 * Token counts by kind. `cacheWrite` is every cache write; `cacheWrite1h` is
 * the part known to be a 1-hour write (only harness logs tell them apart).
 * `reasoning` is informational and already included in `output`.
 */
export interface Tokens {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cacheWrite1h: number;
  reasoning: number;
}

export const ZERO_TOKENS: Tokens = Object.freeze({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  cacheWrite1h: 0,
  reasoning: 0,
});

export function addTokens(a: Tokens, b: Tokens): Tokens {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
    cacheWrite1h: a.cacheWrite1h + b.cacheWrite1h,
    reasoning: a.reasoning + b.reasoning,
  };
}

/** `a - b`, floored at zero per kind. */
export function subtractTokens(a: Tokens, b: Tokens): Tokens {
  return {
    input: Math.max(0, a.input - b.input),
    output: Math.max(0, a.output - b.output),
    cacheRead: Math.max(0, a.cacheRead - b.cacheRead),
    cacheWrite: Math.max(0, a.cacheWrite - b.cacheWrite),
    cacheWrite1h: Math.max(0, a.cacheWrite1h - b.cacheWrite1h),
    reasoning: Math.max(0, a.reasoning - b.reasoning),
  };
}

export function scaleTokens(a: Tokens, factor: number): Tokens {
  const s = (n: number) => Math.round(n * factor);
  return {
    input: s(a.input),
    output: s(a.output),
    cacheRead: s(a.cacheRead),
    cacheWrite: s(a.cacheWrite),
    cacheWrite1h: s(a.cacheWrite1h),
    reasoning: s(a.reasoning),
  };
}

export function totalTokens(t: Tokens): number {
  return t.input + t.output + t.cacheRead + t.cacheWrite;
}

export function isZeroTokens(t: Tokens): boolean {
  return totalTokens(t) === 0;
}

/** Input side of the prompt: uncached input plus cache reads and writes. */
export function promptTokens(t: Tokens): number {
  return t.input + t.cacheRead + t.cacheWrite;
}

/** Share of prompt tokens served from cache, or null with no prompt tokens. */
export function cacheHitRatio(t: Tokens): number | null {
  const prompt = promptTokens(t);
  return prompt === 0 ? null : t.cacheRead / prompt;
}

/** The token breakdown bb puts on `thread/tokenUsage/updated`. */
export interface BbTokenBreakdown {
  totalTokens: number;
  inputTokens: number;
  cachedInputTokens: number;
  cacheReadInputTokens?: number;
  cacheWriteInputTokens?: number;
  outputTokens: number;
  reasoningOutputTokens: number;
}

/**
 * Converts bb's breakdown to {@link Tokens}.
 *
 * Harnesses disagree on whether `inputTokens` includes cached tokens: Claude
 * Code reports uncached input only (total = input + cached + output), while
 * OpenAI-style harnesses include cached tokens in input (total = input +
 * output). The breakdown's own `totalTokens` decides which reading applies.
 */
export function fromBbBreakdown(b: BbTokenBreakdown): Tokens {
  const cached = nonNegative(b.cachedInputTokens);
  const cacheWrite = nonNegative(b.cacheWriteInputTokens ?? 0);
  const cacheRead =
    b.cacheReadInputTokens !== undefined
      ? nonNegative(b.cacheReadInputTokens)
      : Math.max(0, cached - cacheWrite);
  const input = nonNegative(b.inputTokens);
  const output = nonNegative(b.outputTokens);
  const inputIncludesCached =
    cached > 0 &&
    input >= cached &&
    Math.abs(b.totalTokens - (input + output)) <
      Math.abs(b.totalTokens - (input + cached + output));
  return {
    input: inputIncludesCached ? input - cached : input,
    output,
    cacheRead,
    cacheWrite,
    cacheWrite1h: 0,
    reasoning: nonNegative(b.reasoningOutputTokens),
  };
}

function nonNegative(n: number | undefined): number {
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : 0;
}
