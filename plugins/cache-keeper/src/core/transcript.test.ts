import { describe, expect, it } from "vitest";
import { callsPerMessage, deadlineOf, TranscriptFold } from "./transcript";

const at = (min: number) => new Date(Date.UTC(2026, 8, 27, 10, min)).toISOString();

function assistant(min: number, id: string, usage: Record<string, unknown>) {
  return { type: "assistant", timestamp: at(min), requestId: `req_${id}`, message: { id: `msg_${id}`, model: "claude-opus-5-5", usage } };
}
const user = (text: string) => ({ type: "user", message: { role: "user", content: text } });
const toolResult = { type: "user", message: { role: "user", content: [{ type: "tool_result", content: "ok" }] } };

describe("TranscriptFold", () => {
  it("reads the lifetime from the most recent request that wrote to the cache", () => {
    const fold = new TranscriptFold();
    fold.add(assistant(0, "a", { input_tokens: 5, cache_creation: { ephemeral_1h_input_tokens: 1000, ephemeral_5m_input_tokens: 0 } }));
    expect(fold.result().lifetime).toBe("1h");
    fold.add(assistant(1, "b", { input_tokens: 5, cache_creation: { ephemeral_5m_input_tokens: 10, ephemeral_1h_input_tokens: 0 } }));
    expect(fold.result().lifetime).toBe("5m");
    // A request that wrote nothing leaves it as it was.
    fold.add(assistant(2, "c", { input_tokens: 5, cache_read_input_tokens: 1010 }));
    expect(fold.result().lifetime).toBe("5m");
  });

  it("counts a response written over several lines as one request", () => {
    const fold = new TranscriptFold();
    fold.add(user("do it"));
    fold.add(assistant(0, "a", { input_tokens: 1, output_tokens: 3 }));
    fold.add(assistant(0, "a", { input_tokens: 1, output_tokens: 90 }));
    fold.add(toolResult);
    fold.add(assistant(1, "b", { input_tokens: 1 }));
    fold.add({ type: "user", message: { content: "<task-notification>done</task-notification>" } });
    const facts = fold.result();
    expect(facts.requests).toBe(2);
    expect(facts.userMessages).toBe(1);
    expect(callsPerMessage(facts, 3)).toBe(2);
    expect(callsPerMessage({ requests: 4, userMessages: 0 }, 3)).toBe(3);
  });

  it("leaves Cache Keeper's own turns and /compact out of calls per message", () => {
    const fold = new TranscriptFold();
    fold.add(user("do it"));
    fold.add(assistant(0, "a", { input_tokens: 1 }));
    fold.add(assistant(1, "b", { input_tokens: 1 }));
    fold.add(user('Still waiting on child thread thr_c ("x"). Nothing to do yet, just reply "OK".'));
    fold.add(assistant(2, "c", { input_tokens: 1 }));
    fold.add(user("<command-name>/compact</command-name>"));
    expect(fold.result()).toMatchObject({ requests: 2, userMessages: 1 });
    expect(fold.result().lastRequestAt).toBe(Date.parse(at(2)));
  });

  it("counts only messages a request followed, so local commands and rewritten copies drop out", () => {
    const fold = new TranscriptFold();
    fold.add(user("<command-name>/model</command-name>"));
    fold.add(user("<local-command-stdout>Set model</local-command-stdout>"));
    fold.add(user("first question"));
    fold.add(user("first question"));
    fold.add(assistant(0, "a", { input_tokens: 1 }));
    expect(fold.result()).toMatchObject({ requests: 1, userMessages: 1 });
  });

  it("takes the context from the last request, or a later compaction", () => {
    const fold = new TranscriptFold();
    fold.add(assistant(0, "a", { input_tokens: 10, cache_read_input_tokens: 200_000, cache_creation: { ephemeral_1h_input_tokens: 5_000 } }));
    expect(fold.result().context).toBe(205_010);
    fold.add({ type: "system", subtype: "compact_boundary", timestamp: at(5), compactMetadata: { preTokens: 205_010, postTokens: 12_000 } });
    expect(fold.result().context).toBe(12_000);
    expect(fold.result().lastCompaction).toMatchObject({ postTokens: 12_000, preTokens: 205_010 });
    fold.add(assistant(6, "b", { input_tokens: 3, cache_creation: { ephemeral_1h_input_tokens: 13_000 } }));
    expect(fold.result().context).toBe(13_003);
  });

  it("puts the deadline a minute before the cache expires", () => {
    const fold = new TranscriptFold();
    fold.add(assistant(0, "a", { input_tokens: 1, cache_creation: { ephemeral_5m_input_tokens: 10 } }));
    expect(deadlineOf(fold.result())).toBe(Date.parse(at(0)) + 4 * 60_000);
    expect(deadlineOf({ lastRequestAt: null, lifetime: "1h" })).toBeNull();
  });

  it("skips subagent and synthetic lines", () => {
    const fold = new TranscriptFold();
    fold.add({ ...assistant(0, "a", { input_tokens: 1 }), isSidechain: true });
    fold.add({ type: "assistant", timestamp: at(1), message: { model: "<synthetic>", usage: { input_tokens: 1 } } });
    expect(fold.result().requests).toBe(0);
  });

  it("keeps recent requests for the cost of a check-in", () => {
    const fold = new TranscriptFold();
    fold.add(assistant(0, "a", { input_tokens: 1 }));
    fold.add(assistant(3, "b", { input_tokens: 2, output_tokens: 7 }));
    expect(fold.requestsSince(Date.parse(at(2)))).toEqual([
      expect.objectContaining({ input: 2, output: 7, model: "claude-opus-5-5" }),
    ]);
  });
});
