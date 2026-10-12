// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ago, fleetCard, HOUR, NOW } from "@/testing/fixtures";
import { sdk } from "@/testing/sdk";
import { clearFleetTabWishes, takeFleetTab } from "../pending-open";
import { FleetCard } from "./FleetCard";

vi.mock("@get-bb/plugin-sdk/app", async () => (await import("@/testing/sdk")).sdkModule());

beforeEach(() => sdk.reset());
afterEach(() => {
  cleanup();
  clearFleetTabWishes();
});

const show = (over = {}) => render(<FleetCard card={fleetCard(over)} now={NOW} />);

describe("a fleet card", () => {
  it("shows the repo, tracker, the manager's state, its labelled counts and when it was last polled", () => {
    show({ waiting: 1, inFlight: 3, landedToday: 2 });
    const card = screen.getByRole("article", { name: "Fleet acme/web" });
    expect(within(card).getByText("linear · manager idle 12m")).toBeTruthy();
    expect(within(card).getByText("1 waits on you · 3 in flight · 2 landed today")).toBeTruthy();
    expect(within(card).getByText(/polled 40s ago/)).toBeTruthy();
  });

  it("leaves out a count of zero", () => {
    show({ waiting: 0, inFlight: 2, landedToday: 0 });
    expect(screen.getByText("2 in flight")).toBeTruthy();
  });

  it("says working, or no manager", () => {
    show({ manager: { state: "working", since: ago(HOUR) } });
    expect(screen.getByText(/manager working/)).toBeTruthy();
    cleanup();
    show({ manager: { state: "none", since: null } });
    expect(screen.getByText(/no manager/)).toBeTruthy();
  });

  it("shows the cost with the period it covers, and omits it when null", () => {
    show({ cost: { amount: 14.2, currency: "USD", period: "since this manager started" } });
    expect(screen.getByText(/\$14\.20 since this manager started/)).toBeTruthy();
    cleanup();
    show({ cost: null });
    expect(screen.queryByText(/\$/)).toBeNull();
  });

  it("opens the manager's thread and leaves a wish for its Fleet tab", () => {
    show({ managerThreadId: "thr_acme" });
    fireEvent.click(screen.getByRole("button", { name: "Open the Fleet tab of acme/web" }));
    expect(sdk.navigate.toThread).toHaveBeenCalledWith("thr_acme");
    expect(takeFleetTab("thr_acme")).toBe(true);
  });

  it("opens the Fleet tab straight away when the manager's thread is already in view", () => {
    sdk.context.threadId = "thr_acme";
    show({ managerThreadId: "thr_acme" });
    fireEvent.click(screen.getByRole("button", { name: "Open the Fleet tab of acme/web" }));
    expect(sdk.navigate.openThreadPanel).toHaveBeenCalledWith({ actionId: "fleet", params: { threadId: "thr_acme" } });
    expect(sdk.navigate.toThread).not.toHaveBeenCalled();
  });
});

describe("why a fleet is not fully watched", () => {
  it("lists every reason, each linking to the place that mends it", () => {
    show({
      reasons: [
        { code: "credential-refused", text: "Linear is not watched: token refused", fix: { kind: "settings" } },
        { code: "unreadable-rows", text: "2 manifest rows cannot be read, in In flight", fix: { kind: "fleet-tab" } },
        { code: "manifest-missing", text: "no manifest at the registered path", fix: { kind: "none" } },
      ],
    });
    expect(screen.getByText("Linear is not watched: token refused")).toBeTruthy();
    expect(screen.getByText("2 manifest rows cannot be read, in In flight")).toBeTruthy();
    expect(screen.getByText("no manifest at the registered path")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open settings" }).getAttribute("href")).toBe("/extensions/plugins/unattendish-sdlc");
    fireEvent.click(screen.getByRole("button", { name: "Open the Fleet tab" }));
    expect(sdk.navigate.toThread).toHaveBeenCalledWith("thr_acme");
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });
});

describe("a card's warnings", () => {
  it("warns of a credential expiring within days, in the warning tone", () => {
    show({ warnings: [{ kind: "expires", prefix: "org", expiresAt: "2026-10-18", daysLeft: 6 }] });
    expect(screen.getByText("token expires in 6 days").className).toContain("text-warning");
  });

  it("says a gh or glab login shares the agents' rate limit", () => {
    show({ warnings: [{ kind: "shares-rate-limit", prefix: "github.com" }] });
    expect(screen.getByText("shares the agents' rate limit")).toBeTruthy();
  });
});

