// @vitest-environment jsdom
import { type ReactNode, useEffect } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fake, resetFakeApi } from "@/testing/api";
import { fleetCard } from "@/testing/fixtures";
import { sdk } from "@/testing/sdk";
import { clearFleetTabWishes, requestFleetTab } from "@/shared/pending-open";
import { FleetChip } from "./index";

vi.mock("@get-bb/plugin-sdk/app", async () => (await import("@/testing/sdk")).sdkModule());
vi.mock("@/shared/client", async (original) => (await import("@/testing/api")).withFakeClient(await original()));

beforeEach(() => {
  sdk.reset();
  resetFakeApi();
});
afterEach(() => {
  cleanup();
  clearFleetTabWishes();
});

async function show(card: ReturnType<typeof fleetCard> | null, compact = false) {
  fake.api.threadFleet.mockResolvedValue(card === null ? { kind: "none", holder: null } : { kind: "manager", card });
  await act(async () => {
    render(<FleetChip threadId="thr_acme" projectId="proj_a" isCompactViewport={compact} />);
  });
}

describe("the Fleet chip", () => {
  it("spells out the labelled counts of a manager's fleet", async () => {
    await show(fleetCard({ waiting: 1, inFlight: 3, landedToday: 2 }));
    expect(screen.getByRole("button", { name: "Fleet: 1 waits on you · 3 in flight · 2 landed today" }).textContent).toBe("1 waits on you · 3 in flight · 2 landed today");
  });

  it("leaves out a count of zero", async () => {
    await show(fleetCard({ waiting: 0, inFlight: 3, landedToday: 0 }));
    expect(screen.getByRole("button").textContent).toBe("3 in flight");
  });

  it("reads Fleet idle with none", async () => {
    await show(fleetCard());
    expect(screen.getByRole("button").textContent).toBe("Fleet idle");
  });

  it("is named Fleet idle when idle, and keeps its text on one line", async () => {
    await show(fleetCard({ waiting: 1, inFlight: 3, landedToday: 2 }));
    const button = screen.getByRole("button");
    expect(button.className).toContain("whitespace-nowrap");
    // Never cut, never shrunk, one line of text where it fits.
    expect(button.className).toContain("shrink-0");
    expect(button.querySelectorAll("span.tabular-nums > span")).toHaveLength(1);
    cleanup();
    await show(fleetCard());
    expect(screen.getByRole("button", { name: "Fleet idle" })).toBeTruthy();
  });

  it("shows counts of three digits whole, on two lines of the chip, and is named by all of them", async () => {
    await show(fleetCard({ waiting: 987, inFlight: 654, landedToday: 321 }));
    const button = screen.getByRole("button", { name: "Fleet: 987 waits on you · 654 in flight · 321 landed today" });
    const lines = [...button.querySelectorAll("span.tabular-nums > span")].map((line) => line.textContent);
    expect(lines).toEqual(["987 waits on you · 654 in flight", "321 landed today"]);
    expect(button.className).toContain("shrink-0");
  });

  it("draws nothing for a thread that is no manager", async () => {
    await show(null);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("draws nothing while loading", () => {
    fake.api.threadFleet.mockReturnValue(new Promise(() => {}));
    render(<FleetChip threadId="thr_acme" projectId="proj_a" isCompactViewport={false} />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("asks for the thread it is in", async () => {
    await show(fleetCard());
    expect(fake.api.threadFleet).toHaveBeenCalledWith({ threadId: "thr_acme" });
  });

  it("opens the Fleet tab for its thread when clicked", async () => {
    await show(fleetCard());
    fireEvent.click(screen.getByRole("button"));
    expect(sdk.navigate.openThreadPanel).toHaveBeenCalledWith({ actionId: "fleet", params: { threadId: "thr_acme" } });
  });

  it("shows the fleet's card on hover", async () => {
    await show(fleetCard({ repo: "acme/web", tracker: "linear" }));
    fireEvent.pointerEnter(screen.getByRole("button"));
    fireEvent.focus(screen.getByRole("button"));
    expect(await screen.findByRole("article", { name: "Fleet acme/web" }, { timeout: 2000 })).toBeTruthy();
  });
});

describe("on a compact viewport", () => {
  it("shows only the count waiting on the operator", async () => {
    await show(fleetCard({ waiting: 2, inFlight: 3, landedToday: 1 }), true);
    expect(screen.getByRole("button").textContent).toBe("2");
  });

  it("shows a dot with none waiting", async () => {
    await show(fleetCard({ waiting: 0, inFlight: 3 }), true);
    const button = screen.getByRole("button", { name: "Fleet: 3 in flight" });
    expect(button.textContent).toBe("");
    expect(button.querySelector("span[aria-hidden]")).toBeTruthy();
  });

  it("opens the Fleet tab when tapped", async () => {
    await show(fleetCard({ waiting: 1 }), true);
    fireEvent.click(screen.getByRole("button"));
    expect(sdk.navigate.openThreadPanel).toHaveBeenCalledWith({ actionId: "fleet", params: { threadId: "thr_acme" } });
  });
});

describe("a card link that navigated to this thread", () => {
  it("opens the Fleet tab once the chip mounts, once", async () => {
    requestFleetTab("thr_acme");
    await show(fleetCard());
    await waitFor(() => expect(sdk.navigate.openThreadPanel).toHaveBeenCalledTimes(1));
    cleanup();
    await show(fleetCard());
    expect(sdk.navigate.openThreadPanel).toHaveBeenCalledTimes(1);
  });

  it("opens it after the thread view's own mount, which hides a compact drawer", async () => {
    // bb's thread view hides its compact panel drawer in a mount effect, which React runs after its header's.
    let drawerShown = false;
    sdk.navigate.openThreadPanel.mockImplementationOnce(() => {
      drawerShown = true;
      return true;
    });
    function ThreadView({ children }: { children: ReactNode }) {
      useEffect(() => {
        drawerShown = false;
      }, []);
      return children;
    }
    requestFleetTab("thr_acme");
    fake.api.threadFleet.mockResolvedValue({ kind: "manager", card: fleetCard() });
    await act(async () => {
      render(
        <ThreadView>
          <FleetChip threadId="thr_acme" projectId="proj_a" isCompactViewport />
        </ThreadView>,
      );
    });
    await waitFor(() => expect(drawerShown).toBe(true));
  });

  it("opens nothing when no link asked", async () => {
    await show(fleetCard());
    expect(sdk.navigate.openThreadPanel).not.toHaveBeenCalled();
  });
});
