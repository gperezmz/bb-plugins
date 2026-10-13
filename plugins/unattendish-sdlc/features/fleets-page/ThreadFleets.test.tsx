// @vitest-environment jsdom
// The Fleets page's links into a manager thread holding two fleets, and their shared spend (#270 AC1, AC5).
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FleetCardView, ProblemView } from "@/src/fleet/application/views";
import { clearFleetTabWishes } from "@/shared/pending-open";
import { clearReviewRequests, takeReview } from "@/shared/review-request";
import { clearShownFleets, shownFleetOf } from "@/shared/shown-fleet";
import { fake, resetFakeApi } from "@/testing/api";
import { fleetCard, fleetsView, unreadableInboxRow } from "@/testing/fixtures";
import { sdk } from "@/testing/sdk";
import { setCompactViewport } from "@/testing/viewport";
import { FleetsPage } from "./index";

vi.mock("@get-bb/plugin-sdk/app", async () => (await import("@/testing/sdk")).sdkModule());
vi.mock("@/shared/client", async (original) => (await import("@/testing/api")).withFakeClient(await original()));

beforeEach(() => {
  sdk.reset();
  resetFakeApi();
  setCompactViewport(false);
});
afterEach(() => {
  cleanup();
  clearFleetTabWishes();
  clearReviewRequests();
  clearShownFleets();
});

const unreadable: ProblemView = { code: "unreadable-rows", text: "1 manifest row cannot be read: Inbox", fix: { kind: "fleet-tab" } };
const cost = (sharedWith: string[]) => ({ amount: 4.12, currency: "$", period: "since this manager started", sharedWith });
const onA = (repo: string, over: Partial<FleetCardView> = {}) => fleetCard({ repo, managerThreadId: "thr_a", tracker: "forge-issues", ...over });

async function show(fleets: FleetCardView[], over = {}) {
  fake.api.fleets.mockResolvedValue(fleetsView({ fleets, ...over }));
  await act(async () => {
    render(<FleetsPage />);
  });
  await screen.findByRole("region", { name: "Queue" });
}
const line = (repo: string) => within(screen.getByRole("region", { name: "Fleet board" })).getByRole("listitem", { name: `Fleet ${repo}` });

describe("links that open the Fleet tab of one of a thread's fleets (#270 AC1)", () => {
  it("opens A's Fleet tab on org/wake at the row from Review on its unreadable row", async () => {
    await show([onA("org/dash", { waiting: 6 }), onA("org/wake", { waiting: 2, problems: [unreadable] })], { unreadableInbox: [unreadableInboxRow({ fleet: "org/wake", managerThreadId: "thr_a", line: 9 })] });
    fireEvent.click(screen.getByRole("button", { name: "Review the manifest of org/wake in its Fleet tab" }));
    expect(sdk.navigate.toThread).toHaveBeenCalledWith("thr_a");
    expect(shownFleetOf("thr_a")).toBe("org/wake");
    expect(takeReview("thr_a", "org/wake")).toBe(true);
  });

  it("opens the tab on the fleet whose line's Review or Fleet tab button is pressed", async () => {
    await show([onA("org/dash", { waiting: 6 }), onA("org/wake", { waiting: 2, problems: [unreadable] })]);
    fireEvent.click(within(line("org/dash")).getByRole("button", { name: "Open the Fleet tab of org/dash" }));
    expect(shownFleetOf("thr_a")).toBe("org/dash");
    fireEvent.click(within(line("org/wake")).getByRole("button", { name: unreadable.text }));
    expect(shownFleetOf("thr_a")).toBe("org/wake");
    expect(takeReview("thr_a", "org/wake")).toBe(true);
  });

  it("opens the tab in place, with the thread's one Fleet tab params, from the manager thread's own view", async () => {
    sdk.context.threadId = "thr_a";
    await show([onA("org/dash", { waiting: 1 }), onA("org/wake", { waiting: 1 })]);
    fireEvent.click(within(line("org/wake")).getByRole("button", { name: "Open the Fleet tab of org/wake" }));
    expect(sdk.navigate.openThreadPanel).toHaveBeenCalledWith({ actionId: "fleet", params: { threadId: "thr_a" } });
    expect(sdk.navigate.toThread).not.toHaveBeenCalled();
    expect(shownFleetOf("thr_a")).toBe("org/wake");
  });
});

describe("the spend of two fleets on one thread (#270 AC5)", () => {
  it("shows $4.12 on both lines, each marked shared with the other", async () => {
    await show([onA("org/dash", { waiting: 1, cost: cost(["org/wake"]) }), onA("org/wake", { waiting: 1, cost: cost(["org/dash"]) })]);
    expect(within(line("org/dash")).getByText("$4.12")).toBeTruthy();
    expect(within(line("org/dash")).getByText("shared with org/wake")).toBeTruthy();
    expect(within(line("org/wake")).getByText("$4.12")).toBeTruthy();
    expect(within(line("org/wake")).getByText("shared with org/dash")).toBeTruthy();
  });

  it("leaves a fleet alone on its thread unmarked", async () => {
    await show([onA("org/dash", { waiting: 1, cost: cost([]) })]);
    expect(within(line("org/dash")).getByText("$4.12")).toBeTruthy();
    expect(within(line("org/dash")).queryByText(/shared with/)).toBeNull();
  });
});
