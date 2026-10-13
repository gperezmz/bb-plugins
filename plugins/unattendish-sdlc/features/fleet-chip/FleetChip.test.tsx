// @vitest-environment jsdom
import { type ReactNode, useEffect } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fake, resetFakeApi } from "@/testing/api";
import type { ProblemView, WarningView } from "@/src/fleet/application/views";
import { actionRecord, ago, fleetCard, managerFleet, MINUTE } from "@/testing/fixtures";
import { drawnIcons, expectIconsResolve } from "@/testing/icons";
import { sdk } from "@/testing/sdk";
import { ConnectOverlay } from "@/shared/connect/ConnectOverlay";
import { closeConnect } from "@/shared/connect/requests";
import { clearFleetTabWishes, requestFleetTab } from "@/shared/pending-open";
import { clearReviewRequests, takeReview } from "@/shared/review-request";
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
  clearReviewRequests();
  closeConnect();
});

async function show(card: ReturnType<typeof fleetCard> | null, compact = false) {
  fake.api.threadFleet.mockResolvedValue(card === null ? { kind: "none", holder: null } : managerFleet(card));
  await act(async () => {
    render(<FleetChip threadId="thr_acme" projectId="proj_a" isCompactViewport={compact} />);
  });
}

const unreadable: ProblemView = { code: "unreadable-rows", text: "1 manifest row cannot be read: Inbox", fix: { kind: "fleet-tab" } };
const expiring: WarningView = { kind: "expires", label: "GitHub · yuser for acme", credentialId: "c", accountId: "a", role: "forge", expiresAt: "2026-10-15T12:00:00Z", daysLeft: 3 };
const dotOf = (button: HTMLElement) => button.querySelector("span[aria-hidden].rounded-full");

describe("the Fleet chip (#258 AC10, AC11)", () => {
  it("shows the fleet icon with a red dot and an amber count of the rows that wait, given 6 rows wait and a row cannot be read", async () => {
    await show(fleetCard({ waiting: 6, problems: [unreadable] }));
    const button = screen.getByRole("button", { name: "Fleet: 6 waiting on you, and it has a problem" });
    expect(drawnIcons(button)).toEqual(["unattendish-sdlc/fleet"]);
    expect(button.textContent).toBe("6");
    expect(within(button).getByText("6").className).toContain("text-warning-text");
    expect(dotOf(button)!.className).toContain("bg-destructive");
  });

  it("is the icon alone given 2 rows in flight and nothing waiting", async () => {
    await show(fleetCard({ inFlight: 2 }));
    const button = screen.getByRole("button", { name: "Fleet: nothing waits on you" });
    expect(button.textContent).toBe("");
    expect(dotOf(button)).toBeNull();
  });

  it("shows an amber dot and no count given only a token expiring in 3 days", async () => {
    await show(fleetCard({ warnings: [expiring] }));
    const button = screen.getByRole("button", { name: "Fleet: nothing waits on you, and it has a warning" });
    expect(button.textContent).toBe("");
    expect(dotOf(button)!.className).toContain("bg-warning");
  });

  it("is drawn like the header's controls: the header's height, a border on desktop, and never a second line", async () => {
    await show(fleetCard({ waiting: 987 }));
    const button = screen.getByRole("button");
    for (const name of ["h-7", "border", "whitespace-nowrap", "shrink-0"]) expect(button.className.split(" ")).toContain(name);
  });

  it("has no border on a phone", async () => {
    await show(fleetCard({ waiting: 2 }), true);
    const button = screen.getByRole("button");
    expect(button.className.split(" ")).not.toContain("border");
    expect(button.className.split(" ")).toContain("border-0");
    expect(button.textContent).toBe("2");
  });
});

describe("what the chip draws, and when (#258 AC13)", () => {
  it("draws nothing for a thread that is no manager", async () => {
    await show(null);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("draws nothing while loading", () => {
    fake.api.threadFleet.mockReturnValue(new Promise(() => {}));
    render(<FleetChip threadId="thr_acme" projectId="proj_a" isCompactViewport={false} />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("draws nothing when its data failed to load", async () => {
    fake.api.threadFleet.mockRejectedValue(new Error("bb is down"));
    await act(async () => {
      render(<FleetChip threadId="thr_acme" projectId="proj_a" isCompactViewport={false} />);
    });
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("asks for the thread it is in", async () => {
    await show(fleetCard());
    expect(fake.api.threadFleet).toHaveBeenCalledWith({ threadId: "thr_acme" });
  });
});

describe("the chip's hover card (#258 AC12)", () => {
  const hover = async () => {
    fireEvent.pointerEnter(screen.getByRole("button"));
    fireEvent.focus(screen.getByRole("button"));
    return screen.findByRole("banner", { name: "Fleet acme/web" }, { timeout: 2000 });
  };

  it("shows the fleet header with the hint to click", async () => {
    fake.api.threadFleet.mockResolvedValue(
      managerFleet(fleetCard({ repo: "acme/web", waiting: 6, inFlight: 2, blocked: 1, landed: 1, cost: { amount: 4.12, currency: "$", period: "since this manager started", sharedWith: [] }, problems: [unreadable] }), {
        lastAction: actionRecord({ kind: "answer", ref: "#5", what: "Which queue", state: "done", doneAt: ago(40 * MINUTE) }),
      }),
    );
    await act(async () => {
      render(<FleetChip threadId="thr_acme" projectId="proj_a" isCompactViewport={false} />);
    });
    const header = await hover();
    expect(within(header).getByLabelText("6 waiting on you")).toBeTruthy();
    expect(within(header).getByText("$4.12")).toBeTruthy();
    expect(within(header).getByText("1 manifest row cannot be read: Inbox")).toBeTruthy();
    expect(within(header).getByText("You answered #5 Which queue · done 40m ago")).toBeTruthy();
    expect(screen.getByText("Click the chip to open the Fleet tab")).toBeTruthy();
    // #258 AC15: every icon the chip and its card draw resolves.
    expectIconsResolve(drawnIcons(document.body));
  });

  it("opens the Fleet tab from Review in the card, asking it to open at what needs reviewing", async () => {
    await show(fleetCard({ repo: "acme/web", problems: [unreadable] }));
    const header = await hover();
    fireEvent.click(within(header).getByRole("button", { name: /^Review/ }));
    expect(sdk.navigate.openThreadPanel).toHaveBeenCalledWith({ actionId: "fleet", params: { threadId: "thr_acme" } });
    expect(takeReview("thr_acme", "acme/web")).toBe(true);
  });

  it("opens the Fleet tab when the chip is clicked", async () => {
    await show(fleetCard());
    fireEvent.click(screen.getByRole("button"));
    expect(sdk.navigate.openThreadPanel).toHaveBeenCalledWith({ actionId: "fleet", params: { threadId: "thr_acme" } });
  });

  it("is not shown on a phone, where a tap opens the Fleet tab", async () => {
    await show(fleetCard({ repo: "acme/web", waiting: 1 }), true);
    fireEvent.pointerEnter(screen.getByRole("button"));
    fireEvent.focus(screen.getByRole("button"));
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(screen.queryByRole("banner")).toBeNull();
    fireEvent.click(screen.getByRole("button"));
    expect(sdk.navigate.openThreadPanel).toHaveBeenCalledWith({ actionId: "fleet", params: { threadId: "thr_acme" } });
  });

  it("opens the Connect popup over the view, outside the hover card, which does not swallow it", async () => {
    fake.api.connectView.mockResolvedValue({ ok: true, connect: (await import("@/testing/fixtures")).connectView() });
    const needs = "needs a Jira account for acme.atlassian.net";
    fake.api.threadFleet.mockResolvedValue(managerFleet(fleetCard({ repo: "acme/web", problems: [{ code: "no-credential", text: needs, fix: { kind: "connect", role: "tracker" } }] })));
    await act(async () => {
      render(
        <>
          <FleetChip threadId="thr_acme" projectId="proj_a" isCompactViewport={false} />
          <ConnectOverlay />
        </>,
      );
    });
    const header = await hover();
    fireEvent.click(within(header).getByRole("button", { name: `Connect… ${needs}` }));
    const dialog = await screen.findByRole("dialog");
    expect(header.contains(dialog)).toBe(false);
    expect(fake.api.connectView).toHaveBeenCalledWith({ fleet: "acme/web", role: "tracker" });
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
    fake.api.threadFleet.mockResolvedValue(managerFleet());
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
