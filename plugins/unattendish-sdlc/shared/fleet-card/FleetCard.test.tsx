// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ago, fleetCard, half, HOUR, NOW } from "@/testing/fixtures";
import { sdk } from "@/testing/sdk";
import { closeConnect, currentConnect } from "../connect/requests";
import { clearFleetTabWishes, takeFleetTab } from "../pending-open";
import { FleetCard } from "./FleetCard";

vi.mock("@get-bb/plugin-sdk/app", async () => (await import("@/testing/sdk")).sdkModule());

beforeEach(() => sdk.reset());
afterEach(() => {
  cleanup();
  clearFleetTabWishes();
  closeConnect();
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
  it("lists every reason, each offering the place that mends it", () => {
    show({
      reasons: [
        { code: "no-credential", text: "other-org/x needs a GitHub account that can read other-org", fix: { kind: "connect", role: "forge" } },
        { code: "unreadable-rows", text: "2 manifest rows cannot be read, in In flight", fix: { kind: "fleet-tab" } },
        { code: "manifest-missing", text: "no manifest at the registered path", fix: { kind: "none" } },
      ],
    });
    expect(screen.getByText("other-org/x needs a GitHub account that can read other-org")).toBeTruthy();
    expect(screen.getByText("2 manifest rows cannot be read, in In flight")).toBeTruthy();
    expect(screen.getByText("no manifest at the registered path")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open the Fleet tab" }));
    expect(sdk.navigate.toThread).toHaveBeenCalledWith("thr_acme");
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("opens Connect… for the role of a reason that names one, over the current view", () => {
    show({ reasons: [{ code: "no-credential", text: "Linear needs an account", fix: { kind: "connect", role: "tracker" } }] });
    fireEvent.click(screen.getByRole("button", { name: /^Connect… tracker of acme\/web/ }));
    expect(currentConnect()?.request).toEqual({ target: { fleet: "acme/web", role: "tracker" } });
  });
});

describe("a card inside its own Fleet tab", () => {
  const reasons = [
    { code: "no-credential" as const, text: "Linear needs an account", fix: { kind: "connect" as const, role: "tracker" as const } },
    { code: "unreadable-rows" as const, text: "2 manifest rows cannot be read, in In flight", fix: { kind: "fleet-tab" as const } },
  ];

  it("offers no link to the tab it is in, but still says the reason and offers Connect…", () => {
    render(<FleetCard card={fleetCard({ reasons })} now={NOW} inFleetTab />);
    expect(screen.queryByRole("button", { name: "Open the Fleet tab" })).toBeNull();
    expect(screen.getByText("2 manifest rows cannot be read, in In flight")).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Connect…/ })).toBeTruthy();
  });

  it("offers both on the Fleets page", () => {
    render(<FleetCard card={fleetCard({ reasons })} now={NOW} />);
    expect(screen.getByRole("button", { name: "Open the Fleet tab of acme/web" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open the Fleet tab" })).toBeTruthy();
  });
});

describe("a card's halves", () => {
  it("names the account each half reads as, with Change account… on a watched one", () => {
    show({ halves: [half({ credential: "GitHub · yuser for acme" })] });
    const halves = screen.getByRole("list", { name: "Accounts of acme/web" });
    expect(within(halves).getByText("acme/web · reads as GitHub · yuser")).toBeTruthy();
    fireEvent.click(within(halves).getByRole("button", { name: "Change account… forge of acme/web" }));
    expect(currentConnect()?.request.target).toEqual({ fleet: "acme/web", role: "forge" });
  });

  it("says what a half needs, with Connect… for it", () => {
    show({ halves: [half({ role: "tracker", what: "OPS", account: null, credential: null, needs: "needs a Jira account for acme.atlassian.net" })] });
    expect(screen.getByText("needs a Jira account for acme.atlassian.net")).toBeTruthy();
    expect(screen.getByText("OPS · no account yet")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Connect… tracker of acme/web" }));
    expect(currentConnect()?.request.target).toEqual({ fleet: "acme/web", role: "tracker" });
  });

  it("labels a half whose credential can write", () => {
    show({ halves: [half({ canWrite: true })] });
    expect(screen.getByText("can write")).toBeTruthy();
  });
});

describe("a card's warnings", () => {
  const expires = { kind: "expires" as const, label: "GitHub · yuser for acme", credentialId: "cred_1", accountId: "acc_1", role: "forge" as const, expiresAt: "2026-10-18", daysLeft: 6 };

  it("warns of a credential expiring within days, in the warning tone, with Renew", () => {
    show({ warnings: [expires] });
    expect(screen.getByText("token expires in 6 days").parentElement?.className).toContain("text-warning");
    fireEvent.click(screen.getByRole("button", { name: "Renew GitHub · yuser for acme" }));
    expect(currentConnect()?.request).toEqual({ target: { fleet: "acme/web", role: "forge" }, account: "acc_1", replaces: "cred_1" });
  });

  it("says a gh or glab login shares the agents' rate limit, with nothing to renew", () => {
    show({ warnings: [{ kind: "shares-rate-limit", label: "GitHub · yuser" }] });
    expect(screen.getByText("shares the agents' rate limit")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Renew/ })).toBeNull();
  });
});
