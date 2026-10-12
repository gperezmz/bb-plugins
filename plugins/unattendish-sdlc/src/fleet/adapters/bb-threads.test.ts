import { createFakeSdk, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import { BbManagerChannel, BbThreadDirectory, httpStatusOf } from "./bb-threads";

type Overrides = NonNullable<Parameters<typeof createFakeSdk>[0]["overrides"]>;

const fake = (overrides: Overrides) => createFakeSdk({ pluginId: "unattendish-sdlc", overrides });
const httpError = (status: number, text = "secret wake text") => Object.assign(new Error(`HTTP ${status}: ${text}`), { status });
const row = (over: object = {}) => ({ id: "q1", updatedAt: 100, editable: true, ...over });

describe("httpStatusOf", () => {
  it("reads the status from the error, else from an `HTTP <status>` message, else null", () => {
    expect(httpStatusOf(Object.assign(new Error("x"), { status: 409 }))).toBe(409);
    expect(httpStatusOf(new Error("request failed: HTTP 404 not found"))).toBe(404);
    expect(httpStatusOf(new Error("boom"))).toBeNull();
    expect(httpStatusOf(null)).toBeNull();
  });
});

describe("BbThreadDirectory", () => {
  const state = async (get: () => unknown) => new BbThreadDirectory(fake({ threads: { get } }).sdk).state("thr_1");

  it("is live for a thread bb lists", async () => {
    expect(await state(async () => makeThreadResponse({ archivedAt: null, deletedAt: null }))).toBe("live");
  });

  it("is archived for a thread with an archive time", async () => {
    expect(await state(async () => makeThreadResponse({ archivedAt: 1_700_000_000_000, deletedAt: null }))).toBe("archived");
  });

  it("is gone for a deleted thread and for a 404", async () => {
    expect(await state(async () => makeThreadResponse({ archivedAt: 1, deletedAt: 2 }))).toBe("gone");
    expect(
      await state(async () => {
        throw httpError(404);
      }),
    ).toBe("gone");
  });

  it("passes any other failure on, so a poll does not mistake an outage for a vanished manager", async () => {
    await expect(
      state(async () => {
        throw httpError(500);
      }),
    ).rejects.toThrow("HTTP 500");
  });

  it("asks bb for the thread by id", async () => {
    const { sdk, harness } = fake({ threads: { get: async () => makeThreadResponse() } });
    await new BbThreadDirectory(sdk).state("thr_9");
    expect(harness.callsTo("threads.get")).toEqual([[{ threadId: "thr_9" }]]);
  });
});

describe("BbManagerChannel.send", () => {
  it("sends one text part, queued behind a running turn, as the plugin's own submission", async () => {
    const { sdk, harness } = fake({ threads: { send: async () => ({ ok: true, delivery: "sent" }) } });
    expect(await new BbManagerChannel(sdk, "unattendish-sdlc").send("thr_1", "From Unattendish Fleet: ...")).toEqual({ delivered: "sent" });
    expect(harness.callsTo("threads.send")).toEqual([
      [{ threadId: "thr_1", input: [{ type: "text", text: "From Unattendish Fleet: ...", mentions: [] }], mode: "queue-if-active", pluginSubmission: { pluginId: "unattendish-sdlc", data: {} } }],
    ]);
  });

  it("reports a queued delivery with the queued message's id", async () => {
    const { sdk } = fake({ threads: { send: async () => ({ ok: true, delivery: "queued", queuedMessage: row({ id: "q42" }) }) } });
    expect(await new BbManagerChannel(sdk, "p").send("thr_1", "t")).toEqual({ delivered: "queued", queuedMessageId: "q42" });
  });

  it("reports a refusal as the HTTP status alone, never bb's message", async () => {
    const { sdk } = fake({
      threads: {
        send: async () => {
          throw httpError(409, "text of the wake");
        },
      },
    });
    const result = await new BbManagerChannel(sdk, "p").send("thr_1", "t");
    expect(result).toEqual({ delivered: "refused", reason: "HTTP 409" });
  });

  it("reports a failure with no status without its message", async () => {
    const { sdk } = fake({
      threads: {
        send: async () => {
          throw new Error("connect ECONNREFUSED text");
        },
      },
    });
    const result = await new BbManagerChannel(sdk, "p").send("thr_1", "t");
    expect(result).toEqual({ delivered: "refused", reason: "no answer from bb" });
  });
});

describe("BbManagerChannel.amend", () => {
  const channel = (queuedMessages: object) => {
    const made = fake({ threads: { queuedMessages } });
    return { ...made, channel: new BbManagerChannel(made.sdk, "p") };
  };

  it("updates the queued row's text, guarded by the row's updatedAt", async () => {
    const { channel: c, harness } = channel({ list: async () => [row({ id: "other" }), row({ id: "q1", updatedAt: 77 })], update: async () => row() });
    expect(await c.amend("thr_1", "q1", "new text")).toBe("amended");
    expect(harness.callsTo("threads.queuedMessages.update")).toEqual([[{ threadId: "thr_1", queuedMessageId: "q1", expectedUpdatedAt: 77, input: [{ type: "text", text: "new text", mentions: [] }] }]]);
  });

  it("is gone when the row is no longer queued, and updates nothing", async () => {
    const { channel: c, harness } = channel({ list: async () => [row({ id: "other" })], update: async () => row() });
    expect(await c.amend("thr_1", "q1", "t")).toBe("gone");
    expect(harness.callsTo("threads.queuedMessages.update")).toEqual([]);
  });

  it("is gone when bb no longer lets the row be edited", async () => {
    const { channel: c, harness } = channel({ list: async () => [row({ editable: false })], update: async () => row() });
    expect(await c.amend("thr_1", "q1", "t")).toBe("gone");
    expect(harness.callsTo("threads.queuedMessages.update")).toEqual([]);
  });

  it("is gone when bb answers 404 to the update", async () => {
    const { channel: c } = channel({
      list: async () => [row()],
      update: async () => {
        throw httpError(404);
      },
    });
    expect(await c.amend("thr_1", "q1", "t")).toBe("gone");
  });

  it("retries once on 409 against the freshly listed row, then amends", async () => {
    let updates = 0;
    const listed = [[row({ updatedAt: 1 })], [row({ updatedAt: 2 })]];
    const { channel: c, harness } = channel({
      list: async () => listed.shift(),
      update: async () => {
        if (++updates === 1) throw httpError(409);
        return row();
      },
    });
    expect(await c.amend("thr_1", "q1", "t")).toBe("amended");
    expect(harness.callsTo("threads.queuedMessages.update").map(([args]) => (args as { expectedUpdatedAt: number }).expectedUpdatedAt)).toEqual([1, 2]);
  });

  it("is gone when 409 repeats or the row vanished meanwhile", async () => {
    const stale = channel({
      list: async () => [row()],
      update: async () => {
        throw httpError(409);
      },
    });
    expect(await stale.channel.amend("thr_1", "q1", "t")).toBe("gone");
    const listed = [[row()], []];
    const vanished = channel({
      list: async () => listed.shift(),
      update: async () => {
        throw httpError(409);
      },
    });
    expect(await vanished.channel.amend("thr_1", "q1", "t")).toBe("gone");
  });

  it("refuses with the HTTP status alone on any other failure", async () => {
    const failing = channel({
      list: async () => [row()],
      update: async () => {
        throw httpError(500, "wake text");
      },
    });
    expect(await failing.channel.amend("thr_1", "q1", "t")).toEqual({ refused: "HTTP 500" });
    const listing = channel({
      list: async () => {
        throw httpError(503);
      },
    });
    expect(await listing.channel.amend("thr_1", "q1", "t")).toEqual({ refused: "HTTP 503" });
  });

  it("is gone when listing the thread's queue answers 404", async () => {
    const { channel: c } = channel({
      list: async () => {
        throw httpError(404);
      },
    });
    expect(await c.amend("thr_1", "q1", "t")).toBe("gone");
  });
});
