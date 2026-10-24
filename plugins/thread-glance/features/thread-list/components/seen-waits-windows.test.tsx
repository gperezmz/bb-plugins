// @vitest-environment jsdom
// What one window does with the questions and queued failures another window
// on the device has seen, through the device's storage.
import { act } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { makeThread } from "@/testing/fixtures";
import { mount, useListHarness } from "../testing/harness";
import { storedKeyName } from "../storage/device-storage";

useListHarness();

const NOW = Date.now();
const fresh = { createdAt: NOW - 300_000, updatedAt: NOW - 300_000, latestAttentionAt: NOW - 300_000 };

describe("waits seen in another window", () => {
  // keeps: a window whose list does not have a thread yet, such as one hidden since before the thread
  // was created, must not forget what another window saw of it. In real bb (0.47.1) that window wrote
  // the shorter set back on every storage event: the two windows wrote over each other some 5,000 times
  // a second while the thread stayed open, and once it was left the question unfolded in every window.
  // Only a two-window run shows it, and no other check runs one.
  it("keeps a question another window saw on a thread this window's list does not have", async () => {
    await mount({ threads: [makeThread({ id: "other", ...fresh })], server: { settings: { threadDisplay: "compact-all" } }, activeThreadId: "other" });
    const key = storedKeyName("seenWaits");
    act(() => {
      localStorage.setItem(key, JSON.stringify(["question:new"]));
      window.dispatchEvent(new StorageEvent("storage", { key }));
    });
    expect(JSON.parse(localStorage.getItem(key) ?? "[]")).toEqual(["question:new"]);
  });
});
