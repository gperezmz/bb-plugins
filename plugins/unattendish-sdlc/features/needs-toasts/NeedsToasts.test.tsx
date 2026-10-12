// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FLEET_NEEDS } from "@/shared/client";
import { closeConnect, currentConnect } from "@/shared/connect/requests";
import { sdk } from "@/testing/sdk";
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

  it("says what the fleet needs, once per fleet half", () => {
    render(<NeedsToasts />);
    sdk.emit(FLEET_NEEDS, signal);
    expect(toast.mock.calls[0]![0]).toBe("other-org/x needs a GitHub account that can read other-org");
    expect(toast.mock.calls[0]![1]).toMatchObject({ id: "needs:other-org/x:forge" });
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

  it("ignores a payload that is not the signal", () => {
    render(<NeedsToasts />);
    sdk.emit(FLEET_NEEDS, { nonsense: true });
    expect(toast).not.toHaveBeenCalled();
  });

  it("draws nothing", () => {
    expect(render(<NeedsToasts />).baseElement.textContent).toBe("");
  });
});
