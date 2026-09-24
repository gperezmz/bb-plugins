import {
  createFakePluginHost,
  makeThreadResponse,
  makeTurnFailedEvent,
} from "@get-bb/plugin-sdk/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import plugin from "../server";
import { errorInfoLabel, failureText, isGenericError, latestProviderError } from "./failures";
import { noteText } from "./notes";

const info = (category: string, httpStatusCode: number | null = null) =>
  ({ category, httpStatusCode, providerCode: null }) as never;

/** A `provider/error` row shaped like the live event log's. */
function providerErrorRow(turnId: string, data: Record<string, unknown>) {
  return { type: "provider/error", scope: { kind: "turn", turnId }, data };
}
const turnStarted = (turnId: string) => ({
  type: "turn/started",
  scope: { kind: "turn", turnId },
  data: {},
});

describe("errorInfoLabel", () => {
  it("names the common categories", () => {
    expect(errorInfoLabel(info("rate-limit", 429))).toBe("Rate limited (429)");
    expect(errorInfoLabel(info("unauthorized", 401))).toBe("Not signed in");
    expect(errorInfoLabel(info("billing"))).toBe("Out of credits");
    expect(errorInfoLabel(info("budget-exceeded"))).toBe("Out of credits");
    expect(errorInfoLabel(info("context-window-exceeded"))).toBe("Context window full");
  });

  it("puts other categories in words with the HTTP status", () => {
    expect(errorInfoLabel(info("bad-request", 404))).toBe("Bad request (404)");
    expect(errorInfoLabel(info("overloaded"))).toBe("Overloaded");
    expect(errorInfoLabel(info("unknown", 500))).toBe("Error (500)");
    expect(errorInfoLabel(info("unknown"))).toBeNull();
    expect(errorInfoLabel(null)).toBeNull();
  });
});

describe("isGenericError", () => {
  it("treats bb's step failures as generic", () => {
    expect(isGenericError("Command thread.start failed")).toBe(true);
    expect(isGenericError("github-copilot API error (429): quota exceeded")).toBe(false);
  });
  it("treats empty and stock messages as generic", () => {
    for (const text of [null, "", "  ", "Provider error", "Failed.", "error"]) {
      expect(isGenericError(text)).toBe(true);
    }
    expect(isGenericError("Model not found")).toBe(false);
  });
});

describe("latestProviderError", () => {
  it("reads a system error, which carries no turn (a provider that never started)", () => {
    const system = {
      type: "system/error",
      scope: { kind: "thread" },
      data: { code: "thread_command_failed", message: "Command thread.start failed", detail: 'Failed to resolve Pi model "x"' },
    };
    expect(latestProviderError([system] as never, null)?.detail).toBe('Failed to resolve Pi model "x"');
    expect(latestProviderError([system] as never, "t9")?.detail).toBe('Failed to resolve Pi model "x"');
  });
  const rows = [
    providerErrorRow("t2", { message: "Provider error", detail: "newest" }),
    turnStarted("t2"),
    providerErrorRow("t1", { message: "Provider error", detail: "older turn" }),
  ];

  it("takes the newest error of the latest turn", () => {
    expect(latestProviderError(rows, null)?.detail).toBe("newest");
  });

  it("stops at the latest turn start when that turn had no error", () => {
    expect(latestProviderError(rows.slice(1), null)).toBeNull();
  });

  it("matches the given turn id", () => {
    expect(latestProviderError(rows, "t1")?.detail).toBe("older turn");
    expect(latestProviderError(rows, "t3")).toBeNull();
  });
});

describe("failureText", () => {
  it("prefers a specific error, then detail, then message, then errorInfo", () => {
    const providerError = {
      message: "Upstream said no",
      detail: "The model is unavailable",
      errorInfo: info("bad-request", 404),
    };
    expect(failureText({ error: "Disk full", providerError, errorInfo: null })).toBe("Disk full");
    expect(failureText({ error: null, providerError, errorInfo: null })).toBe(
      "The model is unavailable",
    );
    expect(
      failureText({ error: null, providerError: { ...providerError, detail: undefined }, errorInfo: null }),
    ).toBe("Upstream said no");
    expect(
      failureText({
        error: null,
        providerError: { message: "Provider error", errorInfo: info("bad-request", 404) },
        errorInfo: null,
      }),
    ).toBe("Bad request (404)");
    expect(
      failureText({ error: null, providerError: null, errorInfo: info("rate-limit", 429) }),
    ).toBe("Rate limited (429)");
    expect(failureText({ error: null, providerError: null, errorInfo: null })).toBeNull();
  });
});

describe("failed notes through the server", () => {
  afterEach(() => vi.useRealTimers());

  const detail =
    "There's an issue with the selected model (does-not-exist-model). It may not exist or you may not have access to it.";

  async function load(events: (args: { types?: readonly string[] }) => Promise<unknown[]>) {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(5_000);
    const host = createFakePluginHost({
      pluginId: "thread-glance",
      sdk: { threads: { events: { list: events as never } } },
    });
    await plugin(host.bb);
    return host;
  }

  async function failedNote(harness: Awaited<ReturnType<typeof load>>["harness"]) {
    const { notes } = (await harness.behavior.callRpc("listNotes", null)) as {
      notes: Record<string, { failed?: { text: string } }>;
    };
    return notes.t1?.failed?.text;
  }

  const thread = makeThreadResponse({ id: "t1" });

  it("reads the provider error's detail when thread.failed has no error", async () => {
    const { harness } = await load(async () => [
      providerErrorRow("turn_1", {
        message: "Provider error",
        detail,
        errorInfo: info("bad-request", 404),
      }),
      turnStarted("turn_1"),
    ]);
    await harness.behavior.emitThreadEvent("thread.failed", { thread, error: null });
    expect(await failedNote(harness)).toBe(noteText(detail));
    expect(harness.inspection.sdk.callsTo("threads.events.list")[0]?.[0]).toMatchObject({
      threadId: "t1",
      types: ["provider/error", "system/error", "turn/started"],
      order: "desc",
      limit: "20",
    });
  });

  it("does not read events when thread.failed has a specific error", async () => {
    const { harness } = await load(async () => []);
    await harness.behavior.emitThreadEvent("thread.failed", { thread, error: "Disk full" });
    expect(await failedNote(harness)).toBe("Disk full");
    expect(harness.inspection.sdk.callsTo("threads.events.list")).toHaveLength(0);
  });

  it("falls back to Failed when the events cannot be read", async () => {
    const { harness } = await load(async () => {
      throw new Error("offline");
    });
    await harness.behavior.emitThreadEvent("thread.failed", { thread, error: null });
    expect(await failedNote(harness)).toBe("Failed");
  });

  it("labels turn.failed from errorInfo when the log has no provider error", async () => {
    const { harness } = await load(async () => [turnStarted("turn_1")]);
    await harness.behavior.emitThreadEvent(
      "turn.failed",
      makeTurnFailedEvent({
        threadId: "t1",
        turnId: "turn_1",
        errorInfo: info("rate-limit", 429),
      }),
    );
    expect(await failedNote(harness)).toBe("Rate limited (429)");
  });

  it("keeps turn.failed's note when a generic thread.failed arrives after it", async () => {
    const { harness } = await load(async () => []);
    await harness.behavior.emitThreadEvent(
      "turn.failed",
      makeTurnFailedEvent({ threadId: "t1", errorInfo: info("unauthorized", 401) }),
    );
    await harness.behavior.emitThreadEvent("thread.failed", { thread, error: null });
    expect(await failedNote(harness)).toBe("Not signed in");
  });

  it("writes nothing on turn.failed with nothing to say", async () => {
    const { harness } = await load(async () => []);
    await harness.behavior.emitThreadEvent(
      "turn.failed",
      makeTurnFailedEvent({ threadId: "t1", errorInfo: null }),
    );
    expect(await failedNote(harness)).toBeUndefined();
  });
});

