import { describe, expect, it } from "vitest";
import { actionRecord, ago, inboxRow, MINUTE, NOW } from "@/testing/fixtures";
import { canSend, keyIntent } from "./composer-model";
import { type LocalAction, actionName, recentActionText, rowAction, sendInput, takesText, unreadableText, waitedText, waitsForText } from "./row-model";

const idle: LocalAction = { phase: "idle", acceptedAt: null, refusal: null, unconfirmed: false };

describe("what a row says", () => {
  it("says what each row waits for", () => {
    expect(["answer", "grant", "ready", "other"].map((w) => waitsForText(w as "answer"))).toEqual(["your answer", "a grant to merge", "your ready label", "something else"]);
  });

  it("ages the wait by the view's clock", () => {
    expect(waitedText({ since: ago(5 * MINUTE) }, NOW)).toBe("5m");
  });

  it("says an unreadable row is unreadable, naming the column", () => {
    expect(unreadableText({ reason: 'the table has no "Waits for" column' })).toBe('unreadable: the table has no "Waits for" column');
    expect(unreadableText({ reason: "unreadable: Waits for" })).toBe("unreadable: Waits for");
  });
});

describe("a row's action cell", () => {
  it("offers the action when none was sent", () => {
    expect(rowAction(inboxRow(), NOW, idle)).toMatchObject({ kind: "offer", refusal: null });
  });

  it("offers nothing on a row waiting for something else", () => {
    expect(rowAction(inboxRow({ waitsFor: "other", offer: null }), NOW, idle)).toEqual({ kind: "none" });
  });

  it("shows sent with its age and no action once the server holds the action, whichever window sent it", () => {
    const row = inboxRow({ offer: null, action: actionRecord({ sentAt: ago(3 * MINUTE) }) });
    expect(rowAction(row, NOW, idle)).toEqual({ kind: "sent", text: "sent · 3m" });
  });

  it("never turns a sent action into a failure, however long it has been sent", () => {
    const row = inboxRow({ offer: null, action: actionRecord({ sentAt: ago(30 * 24 * 60 * MINUTE) }) });
    expect(rowAction(row, NOW, idle).kind).toBe("sent");
  });

  it("shows sending… while the call is in flight, never sent", () => {
    expect(rowAction(inboxRow(), NOW, { ...idle, phase: "sending" })).toEqual({ kind: "sending", text: "sending…" });
  });

  it("shows sent, aged from the server's record, once bb has accepted the message and the view is being fetched", () => {
    expect(rowAction(inboxRow(), NOW, { ...idle, phase: "accepted", acceptedAt: ago(2 * MINUTE) })).toEqual({ kind: "sent", text: "sent · 2m" });
  });

  it("says the result is unknown while the view is fetched after a call that failed", () => {
    expect(rowAction(inboxRow(), NOW, { ...idle, phase: "unknown" })).toMatchObject({ kind: "unknown" });
  });

  it("lets the server's view decide after a call that failed: sent if it recorded the action, the offer again if it did not", () => {
    const failed = { ...idle, unconfirmed: true };
    expect(rowAction(inboxRow({ offer: null, action: actionRecord({ sentAt: ago(MINUTE) }) }), NOW, failed)).toEqual({ kind: "sent", text: "sent · 1m" });
    expect(rowAction(inboxRow(), NOW, failed)).toMatchObject({ kind: "offer", unconfirmed: true, refusal: null });
  });

  it("shows the server's action over a call in flight", () => {
    const row = inboxRow({ offer: null, action: actionRecord({ sentAt: ago(MINUTE) }) });
    expect(rowAction(row, NOW, { ...idle, phase: "sending" }).kind).toBe("sent");
  });

  it("shows done when the action is done", () => {
    expect(rowAction(inboxRow({ offer: null, action: actionRecord({ state: "done", doneAt: NOW }) }), NOW, idle)).toEqual({ kind: "done", text: "done" });
  });

  it("keeps the action on a refused row and carries bb's reason", () => {
    expect(rowAction(inboxRow(), NOW, { ...idle, refusal: "thread is archived" })).toMatchObject({ kind: "offer", refusal: "thread is archived" });
  });
});

describe("the call an action makes", () => {
  const row = { id: "row_1", fleet: "acme/web" };

  it("carries the operator's words, trimmed, for Answer… and Grant…", () => {
    expect(sendInput(row, "answer", { text: "  en-GB\n" })).toEqual({ fleet: "acme/web", rowId: "row_1", kind: "answer", text: "en-GB" });
    expect(sendInput(row, "grant", { text: "yes" })).toMatchObject({ kind: "grant", text: "yes" });
  });

  it("carries no text for Build it", () => {
    expect(sendInput(row, "build", { text: "ignored" })).toEqual({ fleet: "acme/web", rowId: "row_1", kind: "build" });
  });

  it("carries regrant and no text for Re-grant", () => {
    expect(sendInput(row, "grant", { regrant: true, text: "ignored" })).toEqual({ fleet: "acme/web", rowId: "row_1", kind: "grant", regrant: true });
  });

  it("asks for words only where the action takes them", () => {
    expect([takesText("answer"), takesText("grant"), takesText("grant", true), takesText("build")]).toEqual([true, true, false, false]);
  });

  it("names a button with its item", () => {
    expect(actionName("Answer…", { ref: "ENG-212" })).toBe("Answer… ENG-212");
    expect(actionName("Answer…", { ref: "—" })).toBe("Answer…");
  });
});

describe("recent actions", () => {
  it("reads as a line", () => {
    expect(recentActionText({ kind: "answer", ref: "#163", state: "done" })).toBe("answered #163 · done");
    expect(recentActionText({ kind: "grant", ref: "!41", state: "sent" })).toBe("granted !41 · sent");
    expect(recentActionText({ kind: "build", ref: "#167", state: "done" })).toBe("asked to build #167 · done");
  });
});

describe("the composer", () => {
  const key = (k: string, mods: { metaKey?: boolean; ctrlKey?: boolean } = {}) => ({ key: k, metaKey: false, ctrlKey: false, ...mods });

  it("sends nothing while empty", () => {
    expect(canSend("")).toBe(false);
    expect(canSend(" \n ")).toBe(false);
    expect(keyIntent(key("Enter", { ctrlKey: true }), "  ")).toBeNull();
  });

  it("sends on ⌘+Enter and Ctrl+Enter", () => {
    expect(keyIntent(key("Enter", { metaKey: true }), "yes")).toBe("send");
    expect(keyIntent(key("Enter", { ctrlKey: true }), "yes")).toBe("send");
  });

  it("leaves a bare Enter to the text area, which takes a new line", () => {
    expect(keyIntent(key("Enter"), "yes")).toBeNull();
  });

  it("cancels on Esc, even with text", () => {
    expect(keyIntent(key("Escape"), "yes")).toBe("cancel");
  });
});
