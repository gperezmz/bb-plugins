// @vitest-environment jsdom
import type { ReactElement } from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FLEET_NEEDS } from "@/shared/client";
import { closeConnect, currentConnect } from "@/shared/connect/requests";
import { sdk } from "@/testing/sdk";
import { drawnIcons, expectIconsResolve } from "@/testing/icons";
import { NeedsToasts } from "./index";

const toast = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast }));
vi.mock("@get-bb/plugin-sdk/app", async () => (await import("@/testing/sdk")).sdkModule());

beforeEach(() => {
  sdk.reset();
  toast.mockClear();
});
afterEach(() => {
  cleanup();
  closeConnect();
});

const signal = { fleet: "other-org/x", managerThreadId: "thr_x", role: "forge", text: "other-org/x needs a GitHub account that can read other-org" };

describe("the needs toasts", () => {
  it("toasts nothing on mount", () => {
    render(<NeedsToasts />);
    expect(toast).not.toHaveBeenCalled();
  });

  it("says the fleet can't be read, and what it needs under that, once per fleet half", () => {
    render(<NeedsToasts />);
    sdk.emit(FLEET_NEEDS, signal);
    expect(toast.mock.calls[0]![0]).toBe("other-org/x can't be read");
    expect(toast.mock.calls[0]![1]).toMatchObject({ id: "needs:other-org/x:forge", description: "other-org/x needs a GitHub account that can read other-org" });
  });

  it("leads with a red plug", () => {
    render(<NeedsToasts />);
    sdk.emit(FLEET_NEEDS, signal);
    const { icon } = toast.mock.calls[0]![1] as { icon: ReactElement };
    const drawn = render(icon).baseElement;
    expect(drawnIcons(drawn)).toEqual(["ElectricPlugs"]);
    expect(drawn.querySelector(".text-destructive-text")).not.toBeNull();
    expectIconsResolve(drawnIcons(drawn));
  });

  it("opens Connect… for the half from the toast's action, over the current view", () => {
    render(<NeedsToasts />);
    sdk.emit(FLEET_NEEDS, signal);
    const { action } = toast.mock.calls[0]![1] as { action: { label: string; onClick(): void } };
    expect(action.label).toBe("Connect…");
    action.onClick();
    expect(currentConnect()?.request).toEqual({ target: { fleet: "other-org/x", role: "forge" } });
    expect(sdk.navigate.toPluginPanel).not.toHaveBeenCalled();
  });

  it("offers Renew… for a token refused because it expired yesterday, saying it expired, and renews that token (#261 AC7)", () => {
    render(<NeedsToasts />);
    const expiresAt = new Date(Date.now() - 86_400_000).toISOString();
    sdk.emit(FLEET_NEEDS, { ...signal, fleet: "org/dash", expired: { label: "GitHub · yuser for org", accountId: "acc_y", credentialId: "cred_y", expiresAt } });
    expect(toast.mock.calls[0]![0]).toBe("org/dash can't be read");
    const { description, action } = toast.mock.calls[0]![1] as { description: string; action: { label: string; onClick(): void } };
    expect(description).toBe("GitHub · yuser for org: token expired 1 day ago");
    expect(action.label).toBe("Renew…");
    action.onClick();
    expect(currentConnect()?.request).toEqual({ target: { fleet: "org/dash", role: "forge" }, account: "acc_y", replaces: "cred_y" });
  });

  it("keeps Connect… for a refused credential whose token has not expired (#261 AC7)", () => {
    render(<NeedsToasts />);
    sdk.emit(FLEET_NEEDS, { ...signal, expired: null });
    expect((toast.mock.calls[0]![1] as { action: { label: string } }).action.label).toBe("Connect…");
  });

  it("ignores a payload that is not the signal", () => {
    render(<NeedsToasts />);
    sdk.emit(FLEET_NEEDS, { nonsense: true });
    expect(toast).not.toHaveBeenCalled();
  });

  it("draws nothing", () => {
    expect(render(<NeedsToasts />).baseElement.textContent).toBe("");
  });
});
