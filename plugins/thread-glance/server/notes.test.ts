import type { PluginThreadEventPayloads } from "@get-bb/plugin-sdk";
import { createFakePluginHost, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import plugin from "../server";
import { CHANNELS, NOTE_MAX_LENGTH, threadNotesSchema, type RecordsSignal, type ThreadRecord } from "../shared/contract";
import {
  describeDone,
  describeFailure,
  describeInteraction,
  noteKvKey,
  parseStoredNotes,
  noteText,
} from "./notes";

type PendingInteraction = PluginThreadEventPayloads["interaction.pending"]["interaction"];

const base = {
  id: "int_1",
  threadId: "t1",
  createdAt: 1_000,
  status: "pending",
  statusReason: null,
  resolution: null,
  resolvedAt: null,
};
const providerBase = {
  ...base,
  turnId: "turn_1",
  providerId: "codex",
  providerRequestId: "req_1",
  providerThreadId: "pt_1",
};

function approval(subject: Record<string, unknown>, reason: string | null = null) {
  return {
    ...providerBase,
    payload: { kind: "approval", availableDecisions: ["allow_once", "deny"], reason, subject },
  } as unknown as PendingInteraction;
}

function question(...prompts: string[]) {
  return {
    ...providerBase,
    payload: {
      kind: "user_question",
      questions: prompts.map((prompt, index) => ({
        id: `q${index}`,
        prompt,
        allowFreeText: true,
        multiSelect: false,
      })),
    },
  } as unknown as PendingInteraction;
}

function pluginRequest(
  pluginId: string,
  payload: { title: string; data?: unknown; presentation?: { detail?: string } },
) {
  return {
    ...base,
    turnId: null,
    origin: { kind: "plugin", pluginId, rendererId: "r" },
    payload: { kind: "plugin", data: null, ...payload },
  } as unknown as PendingInteraction;
}

describe("noteText", () => {
  it("collapses whitespace and strips leading markdown marks", () => {
    expect(noteText("  ## Heading\n\n  with   text ")).toBe("Heading with text");
    expect(noteText("- 1. > item")).toBe("item");
  });

  it("truncates to the maximum length with an ellipsis", () => {
    const text = noteText("word ".repeat(100));
    expect(text.length).toBeLessThanOrEqual(NOTE_MAX_LENGTH);
    expect(text.endsWith("…")).toBe(true);
  });
});

describe("describeInteraction", () => {
  it("maps a user question to its first prompt and counts the rest", () => {
    expect(describeInteraction(question("Which database?"))).toEqual({
      kind: "question",
      text: "Which database?",
    });
    expect(describeInteraction(question("Which database?", "Which port?", "TLS?"))).toEqual({
      kind: "question",
      text: "Which database? (+2 more)",
    });
  });

  it("maps a command approval to the command, or the reason when it is empty", () => {
    expect(describeInteraction(approval({ kind: "command", command: "rm -rf dist" }))).toEqual({
      kind: "approval",
      text: "rm -rf dist",
    });
    expect(describeInteraction(approval({ kind: "command", command: " " }, "Needs network"))).toEqual(
      { kind: "approval", text: "Needs network" },
    );
  });

  it("maps file, permission and tool approvals", () => {
    expect(describeInteraction(approval({ kind: "file_change", writeScope: "src/" }))).toEqual({
      kind: "approval",
      text: "File changes in src/",
    });
    expect(describeInteraction(approval({ kind: "file_change", writeScope: null }))).toEqual({
      kind: "approval",
      text: "File changes",
    });
    expect(describeInteraction(approval({ kind: "permission_grant", toolName: "Bash" }))).toEqual({
      kind: "approval",
      text: "Permissions for Bash",
    });
    expect(
      describeInteraction(
        approval({ kind: "tool_use", tool: "deploy", presentation: { title: "Deploy to staging" } }),
      ),
    ).toEqual({ kind: "approval", text: "Deploy to staging" });
    expect(
      describeInteraction(approval({ kind: "tool_use", tool: "deploy", presentation: {} })),
    ).toEqual({ kind: "approval", text: "deploy" });
  });

  it("maps a plan to its first non-empty line without heading marks", () => {
    expect(
      describeInteraction(approval({ kind: "plan", plan: "\n\n##Migrate the store\n\nStep 1" })),
    ).toEqual({ kind: "plan", text: "Migrate the store" });
  });

  it("maps ask-user-question to the first question's prompt", () => {
    const interaction = pluginRequest("ask-user-question", {
      title: "Database",
      data: {
        questions: [
          { id: "q0", prompt: "Which database should we use?", shortLabel: "Database" },
          { id: "q1", prompt: "Port?", shortLabel: "Port" },
        ],
      },
    });
    expect(describeInteraction(interaction)).toEqual({
      kind: "question",
      text: "Which database should we use? (+1 more)",
    });
    expect(describeInteraction(pluginRequest("ask-user-question", { title: "2 questions" }))).toEqual(
      { kind: "question", text: "2 questions" },
    );
  });

  it("maps another plugin's request to input with its title and short detail", () => {
    expect(
      describeInteraction(
        pluginRequest("secrets", { title: "API key", presentation: { detail: "for Stripe" } }),
      ),
    ).toEqual({ kind: "input", text: "API key: for Stripe" });
    expect(
      describeInteraction(
        pluginRequest("secrets", { title: "API key", presentation: { detail: "x".repeat(200) } }),
      ),
    ).toEqual({ kind: "input", text: "API key" });
  });

  it("maps a provider request to input with its title, and anything else to a fallback", () => {
    const request = {
      ...providerBase,
      payload: { kind: "codex/elicit", title: "Pick a branch", data: null },
    } as unknown as PendingInteraction;
    expect(describeInteraction(request)).toEqual({ kind: "input", text: "Pick a branch" });
    const unknown = { ...providerBase, payload: { kind: "mystery" } } as unknown as PendingInteraction;
    expect(describeInteraction(unknown)).toEqual({ kind: "input", text: "Needs your input" });
  });
});

describe("describeFailure and describeDone", () => {
  it("uses the error, or Failed without one", () => {
    expect(describeFailure("Rate limited\n  retry later")).toEqual({
      kind: "failed",
      text: "Rate limited retry later",
    });
    expect(describeFailure(null)).toEqual({ kind: "failed", text: "Failed" });
  });

  it("skips empty assistant text", () => {
    expect(describeDone(null)).toBeNull();
    expect(describeDone("  \n ")).toBeNull();
    expect(describeDone("# Done\nAll tests pass.")).toEqual({
      kind: "done",
      text: "Done All tests pass.",
    });
  });
});

describe("parseStoredNotes", () => {
  const note = { kind: "done", text: "Done.", at: 1 };
  it.each([
    ["notes in every slot", { pending: { ...note, kind: "question" }, failed: { ...note, kind: "failed" }, done: note }],
    ["no notes", {}],
    ["an unknown key beside a note", { done: note, extra: 1 }],
    ["an unknown key inside a note", { done: { ...note, extra: 1 } }],
    ["text at the cap", { done: { ...note, text: "x".repeat(NOTE_MAX_LENGTH) } }],
    ["text past the cap", { done: { ...note, text: "x".repeat(NOTE_MAX_LENGTH + 1) } }],
    ["an unknown kind", { done: { ...note, kind: "maybe" } }],
    ["a missing time", { done: { kind: "done", text: "Done." } }],
    ["a time that is text", { done: { ...note, at: "1" } }],
    ["a note that is text", { done: "Done." }],
    ["a null note", { done: null }],
    ["an array", [note]],
    ["null", null],
    ["text", "Done."],
  ])("reads %s as threadNotesSchema does", (_, raw) => {
    const parsed = threadNotesSchema.safeParse(raw);
    expect(parseStoredNotes(raw)).toEqual(parsed.success ? parsed.data : null);
  });
});

describe("notes through the server", () => {
  afterEach(() => vi.useRealTimers());

  async function load() {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(5_000);
    const host = createFakePluginHost({ pluginId: "thread-glance" });
    await plugin(host.bb);
    return host;
  }

  const thread = makeThreadResponse({ id: "t1" });

  type Harness = Awaited<ReturnType<typeof load>>["harness"];

  /** Each thread's notes as the `records` signals carried them, in order. */
  function noteSignals(harness: Harness) {
    return harness.inspection.realtimeSignals
      .filter((signal) => signal.channel === CHANNELS.records)
      .flatMap((signal) =>
        Object.entries((signal.payload as RecordsSignal).records).map(([threadId, record]) => ({ threadId, notes: record.notes })),
      );
  }

  /** The notes a first `sync` carries, as `{ notes }` by thread. */
  async function listNotes(harness: Harness) {
    const { records } = (await harness.behavior.callRpc("sync", { since: null })) as { records: Record<string, ThreadRecord> };
    return {
      notes: Object.fromEntries(Object.entries(records).flatMap(([threadId, record]) => (record.notes ? [[threadId, record.notes]] : []))),
    };
  }

  it("records a pending question at the interaction's time and lists it", async () => {
    const { harness } = await load();
    await harness.behavior.emitThreadEvent("interaction.pending", {
      thread,
      interaction: question("Which database?"),
    });
    const pending = { kind: "question", text: "Which database?", at: 1_000 };
    expect(await listNotes(harness)).toEqual({
      notes: { t1: { pending } },
    });
    expect(noteSignals(harness)).toEqual([{ threadId: "t1", notes: { pending } }]);
  });

  it("records a failure, and idle replaces pending with done", async () => {
    const { harness } = await load();
    await harness.behavior.emitThreadEvent("interaction.pending", {
      thread,
      interaction: approval({ kind: "command", command: "npm publish" }),
    });
    await harness.behavior.emitThreadEvent("thread.failed", { thread, error: "Out of credits" });
    await harness.behavior.emitThreadEvent("thread.idle", {
      thread,
      lastAssistantText: "Published 1.2.0.",
    });
    expect(await listNotes(harness)).toEqual({
      notes: {
        t1: {
          failed: { kind: "failed", text: "Out of credits", at: 5_000 },
          done: { kind: "done", text: "Published 1.2.0.", at: 5_000 },
        },
      },
    });
  });

  it("idle without text still clears pending", async () => {
    const { harness } = await load();
    await harness.behavior.emitThreadEvent("interaction.pending", {
      thread,
      interaction: question("Go?"),
    });
    await harness.behavior.emitThreadEvent("thread.idle", { thread, lastAssistantText: null });
    expect(await listNotes(harness)).toEqual({ notes: {} });
    expect(noteSignals(harness).at(-1)).toEqual({ threadId: "t1", notes: null });
  });

  it("active clears pending and failed but keeps done", async () => {
    const { harness } = await load();
    await harness.behavior.emitThreadEvent("thread.idle", { thread, lastAssistantText: "Done." });
    await harness.behavior.emitThreadEvent("thread.failed", { thread, error: null });
    await harness.behavior.emitThreadEvent("interaction.pending", {
      thread,
      interaction: question("Go?"),
    });
    await harness.behavior.emitThreadEvent("thread.active", { thread });
    expect(await listNotes(harness)).toEqual({
      notes: { t1: { done: { kind: "done", text: "Done.", at: 5_000 } } },
    });
  });

  it("leaves the notes as they are when active finds nothing to clear", async () => {
    const { harness } = await load();
    await harness.behavior.emitThreadEvent("thread.active", { thread });
    expect(noteSignals(harness)).toEqual([{ threadId: "t1", notes: null }]);
  });

  it("deletes a deleted thread's notes and publishes null", async () => {
    const { harness } = await load();
    await harness.behavior.emitThreadEvent("thread.failed", { thread, error: "boom" });
    await harness.behavior.emitThreadEvent("thread.deleted", { thread });
    expect((await listNotes(harness)).notes).toEqual({});
    expect(noteSignals(harness).at(-1)).toEqual({ threadId: "t1", notes: null });
  });

  it("drops an invalid stored row on a cold read and logs it", async () => {
    const { bb, harness } = await load();
    const done = { kind: "done", text: "Done.", at: 1 };
    await bb.storage.kv.set(noteKvKey("good"), { done });
    await bb.storage.kv.set(noteKvKey("bad"), { done: { kind: "done" } });
    expect(await listNotes(harness)).toEqual({ notes: { good: { done } } });
    expect(await bb.storage.kv.get(noteKvKey("bad"))).toBeUndefined();
    expect(harness.inspection.logEntries.filter((entry) => entry.level === "warn").map((entry) => entry.message)).toEqual([
      "stored notes for bad are invalid; dropping them",
    ]);
  });

  it("prunes notes of threads bb no longer lists on startup", async () => {
    const host = createFakePluginHost({
      pluginId: "thread-glance",
      sdk: {
        threads: {
          list: (async (args?: { archived?: boolean }) =>
            args?.archived ? [] : [makeThreadResponse({ id: "live" })]) as never,
          queue: { list: async () => [] },
        },
      },
    });
    await plugin(host.bb);
    const note = { kind: "failed", text: "x", at: 1 };
    await host.bb.storage.kv.set(noteKvKey("live"), { failed: note });
    await host.bb.storage.kv.set(noteKvKey("gone"), { failed: note });
    const stored = () => host.bb.storage.database().prepare("SELECT thread_id, data FROM notes ORDER BY thread_id").all();
    const service = host.harness.behavior.runService("startup");
    await vi.waitFor(() => {
      expect(stored()).toEqual([{ thread_id: "live", data: JSON.stringify({ failed: note }) }]);
    });
    service.controller.abort();
    await service.done;
  });
});
