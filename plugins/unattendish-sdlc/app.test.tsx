import { describe, expect, it, vi } from "vitest";
import app from "./app";

vi.mock("@get-bb/plugin-sdk/app", async () => (await import("@/testing/sdk")).sdkModule());
vi.mock("sonner", () => ({ toast: vi.fn() }));

/** The slots the app registers, as a collector records them. */
function collect(withOverlay = true) {
  const registered: Record<string, Record<string, unknown>[]> = {};
  const slot = (name: string) => (registration: Record<string, unknown>) => {
    (registered[name] ??= []).push(registration);
  };
  const slots: Record<string, unknown> = {
    navPanel: slot("navPanel"),
    threadPanelAction: slot("threadPanelAction"),
    experimental_threadHeaderAction: slot("experimental_threadHeaderAction"),
    settingsSection: slot("settingsSection"),
  };
  if (withOverlay) slots.experimental_appOverlay = slot("experimental_appOverlay");
  (app as unknown as { setup(builder: unknown): void }).setup({ slots });
  return registered;
}

describe("the app", () => {
  it("registers the Fleets page with its count in the header, under the plugin's own icon", () => {
    const [nav] = collect().navPanel!;
    expect(nav).toMatchObject({ id: "fleets", title: "Fleets", path: "fleets", icon: "unattendish-sdlc/fleet" });
    expect(nav!.headerContent).toBeTypeOf("function");
  });

  it("registers the Fleet tab as a thread panel action that opens a panel for its thread", () => {
    const [action] = collect().threadPanelAction!;
    expect(action).toMatchObject({ id: "fleet", title: "Fleet" });
    const openPanel = vi.fn();
    (action!.run as (context: unknown) => void)({ threadId: "thr_a", openPanel });
    expect(openPanel).toHaveBeenCalledWith({ title: "Fleet", params: { threadId: "thr_a" } });
  });

  it("registers the Fleet chip and the settings section", () => {
    const registered = collect();
    expect(registered.experimental_threadHeaderAction).toHaveLength(1);
    expect(registered.experimental_threadHeaderAction![0]).toMatchObject({ title: "Fleet" });
    expect(registered.settingsSection).toHaveLength(1);
  });

  it("registers the toasts and the Connect popup as overlays where bb offers the slot", () => {
    expect(collect().experimental_appOverlay!.map((overlay) => overlay.id)).toEqual(["inbox-toasts", "needs-toasts", "connect-popup"]);
  });

  it("registers everything else on a bb without the overlay slot", () => {
    const registered = collect(false);
    expect(registered.experimental_appOverlay).toBeUndefined();
    expect(registered.navPanel).toHaveLength(1);
  });
});
