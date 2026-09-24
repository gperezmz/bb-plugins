import type { PluginThreadEventPayloads } from "@get-bb/plugin-sdk";
import { createFakePluginHost, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import plugin from "../server";
import { CHANNELS, NOTE_MAX_LENGTH } from "../shared/contract";
import {
  describeDone,
  describeFailure,
  describeInteraction,
  noteKvKey,
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

  function noteSignals(harness: Awaited<ReturnType<typeof load>>["harness"]) {
    return harness.inspection.realtimeSignals
      .filter((signal) => signal.channel === CHANNELS.notes)
      .map((signal) => signal.payload);
  }

  it("records a pending question at the interaction's time and lists it", async () => {
    const { harness } = await load();
    await harness.behavior.emitThreadEvent("interaction.pending", {
      thread,
      interaction: question("Which database?"),
    });
    const pending = { kind: "question", text: "Which database?", at: 1_000 };
    expect(await harness.behavior.callRpc("listNotes", null)).toEqual({
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
    expect(await harness.behavior.callRpc("listNotes", null)).toEqual({
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
    expect(await harness.behavior.callRpc("listNotes", null)).toEqual({ notes: {} });
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
    expect(await harness.behavior.callRpc("listNotes", null)).toEqual({
      notes: { t1: { done: { kind: "done", text: "Done.", at: 5_000 } } },
    });
  });

  it("publishes nothing when active finds nothing to clear", async () => {
    const { harness } = await load();
    await harness.behavior.emitThreadEvent("thread.active", { thread });
    expect(noteSignals(harness)).toEqual([]);
  });

  it("deletes a deleted thread's notes and publishes null", async () => {
    const { bb, harness } = await load();
    await harness.behavior.emitThreadEvent("thread.failed", { thread, error: "boom" });
    await harness.behavior.emitThreadEvent("thread.deleted", { thread });
    expect(await bb.storage.kv.get(noteKvKey("t1"))).toBeUndefined();
    expect(noteSignals(harness).at(-1)).toEqual({ threadId: "t1", notes: null });
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
    const service = host.harness.behavior.runService("startup");
    await vi.waitFor(async () => {
      expect(await host.bb.storage.kv.get(noteKvKey("gone"))).toBeUndefined();
    });
    expect(await host.bb.storage.kv.get(noteKvKey("live"))).toEqual({ failed: note });
    service.controller.abort();
    await service.done;
  });
});
