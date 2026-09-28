import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { afterEach, describe, expect, it } from "vitest";
import uiTweaks from "./server";

const hosts: { harness: { lifecycle: { dispose(): Promise<void> } } }[] = [];

async function load() {
  const host = createFakePluginHost({ pluginId: "ui-tweaks" });
  hosts.push(host);
  await uiTweaks(host.bb);
  return host;
}

afterEach(async () => {
  for (const host of hosts.splice(0)) await host.harness.lifecycle.dispose();
});

describe("the saved tweaks", () => {
  it("are Medium on a fresh install", async () => {
    const host = await load();
    expect(await host.harness.behavior.callRpc("getTweaks", null)).toEqual({ textSize: "medium", width: "medium" });
  });

  it("keep a change, announce it and return both tweaks", async () => {
    const host = await load();
    expect(await host.harness.behavior.callRpc("setTweaks", { textSize: "large" })).toEqual({
      textSize: "large",
      width: "medium",
    });
    expect(host.harness.inspection.realtimeSignals.at(-1)).toMatchObject({
      channel: "tweaks",
      payload: { textSize: "large", width: "medium" },
    });
    expect(await host.harness.behavior.callRpc("getTweaks", null)).toEqual({ textSize: "large", width: "medium" });
  });

  it("refuse a choice that is not one of the segments", async () => {
    const host = await load();
    await expect(host.harness.behavior.callRpc("setTweaks", { width: "huge" })).rejects.toThrow();
    expect(await host.harness.behavior.callRpc("getTweaks", null)).toEqual({ textSize: "medium", width: "medium" });
  });

  it("survive a reload, as after a bb restart or a plugin update", async () => {
    const host = await load();
    await host.harness.behavior.callRpc("setTweaks", { textSize: "small", width: "wide" });
    const reloaded = await host.harness.lifecycle.reload(uiTweaks);
    expect(await reloaded.harness.behavior.callRpc("getTweaks", null)).toEqual({ textSize: "small", width: "wide" });
  });

  it("go back to Medium on a reinstall", async () => {
    const host = await load();
    await host.harness.behavior.callRpc("setTweaks", { textSize: "small", width: "wide" });
    const reinstalled = await host.harness.lifecycle.reload(uiTweaks);
    await reinstalled.harness.lifecycle.install();
    expect(await reinstalled.harness.behavior.callRpc("getTweaks", null)).toEqual({ textSize: "medium", width: "medium" });
  });

  it("read an unreadable row as Medium", async () => {
    const host = await load();
    await host.bb.storage.kv.set("tweak:width", "enormous");
    expect(await host.harness.behavior.callRpc("getTweaks", null)).toEqual({ textSize: "medium", width: "medium" });
  });
});
