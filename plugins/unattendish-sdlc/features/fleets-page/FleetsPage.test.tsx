// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fake, resetFakeApi } from "@/testing/api";
import { actionRecord, ago, fleetCard, fleetsView, HOUR, inboxRow, landedRow, MINUTE, unreadableInboxRow } from "@/testing/fixtures";
import { sdk } from "@/testing/sdk";
import { setCompactViewport } from "@/testing/viewport";
import { BOARD_CHANGED } from "@/shared/client";
import { FleetsHeaderCount, FleetsPage } from "./index";

vi.mock("@get-bb/plugin-sdk/app", async () => (await import("@/testing/sdk")).sdkModule());
vi.mock("@/shared/client", async (original) => (await import("@/testing/api")).withFakeClient(await original()));

beforeEach(() => {
  sdk.reset();
  resetFakeApi();
  setCompactViewport(false);
});
afterEach(cleanup);

describe("the header count", () => {
  it("counts every Inbox row across fleets", async () => {
    fake.api.fleets.mockResolvedValue(fleetsView({ waiting: 3 }));
    render(<FleetsHeaderCount />);
    expect((await screen.findByLabelText("3 waiting on you")).textContent).toBe("3");
  });

  it("shows no count at zero", async () => {
    render(<FleetsHeaderCount />);
    await waitFor(() => expect(fake.api.fleets).toHaveBeenCalled());
    expect(screen.queryByLabelText(/waiting on you/)).toBeNull();
  });

  it("follows the board when the server says it changed", async () => {
    fake.api.fleets.mockResolvedValueOnce(fleetsView({ waiting: 1 }));
    render(<FleetsHeaderCount />);
    await screen.findByLabelText("1 waiting on you");
    fake.api.fleets.mockResolvedValue(fleetsView({ waiting: 2 }));
    sdk.emit(BOARD_CHANGED);
    await screen.findByLabelText("2 waiting on you");
  });
});

describe("the Fleets page", () => {
  it("waits for the view, then fails in words when it cannot load", async () => {
    fake.api.fleets.mockRejectedValue(new Error("the server is not running"));
    render(<FleetsPage />);
    expect(screen.getByText(/Loading the Fleets page/)).toBeTruthy();
    expect((await screen.findByRole("alert")).textContent).toContain("Could not load the Fleets page: the server is not running");
  });

  it("says no fleet is registered, and how one appears, with the three empty states", async () => {
    render(<FleetsPage />);
    expect(await screen.findByText(/No fleet is registered\. A fleet appears here once/)).toBeTruthy();
    expect(screen.getByText("/run-fleet")).toBeTruthy();
    expect(screen.getByText(/from unattendish-sdlc runs with this plugin installed\./)).toBeTruthy();
    expect(screen.getByText("Nothing waits on you")).toBeTruthy();
    expect(screen.getByText("Nothing landed in the last 7 days")).toBeTruthy();
  });

  it("lists the Inbox rows of every fleet in one table, the unreadable ones among them", async () => {
    fake.api.fleets.mockResolvedValue(
      fleetsView({
        waiting: 3,
        inbox: [inboxRow({ id: "a", ref: "ENG-212", fleet: "acme/web" }), inboxRow({ id: "b", ref: "#167", fleet: "org/tickets", what: "an oversized id answers 503", waitsFor: "ready", offer: { kind: "build", label: "Build it", regrant: false } })],
        unreadableInbox: [unreadableInboxRow({ fleet: "group/billing", managerThreadId: "thr_billing" })],
      }),
    );
    render(<FleetsPage />);
    const table = await screen.findByRole("table");
    expect(within(table).getAllByRole("row")).toHaveLength(4);
    expect(within(table).getByText("org/tickets")).toBeTruthy();
    expect(within(table).getByRole("button", { name: "Build it #167" })).toBeTruthy();
    expect(within(table).getByText(/unreadable:/)).toBeTruthy();
    fireEvent.click(within(table).getByRole("button", { name: "Open the Fleet tab of group/billing" }));
    expect(sdk.navigate.toThread).toHaveBeenCalledWith("thr_billing");
  });

  it("stacks the rows on a compact viewport", async () => {
    setCompactViewport(true);
    fake.api.fleets.mockResolvedValue(fleetsView({ waiting: 1, inbox: [inboxRow()] }));
    render(<FleetsPage />);
    const item = await screen.findByRole("listitem");
    expect(item.className).toContain("flex-col");
  });

  it("draws a card per registered fleet", async () => {
    fake.api.fleets.mockResolvedValue(
      fleetsView({ fleets: [fleetCard({ repo: "acme/web", managerThreadId: "thr_a" }), fleetCard({ repo: "org/tickets", managerThreadId: "thr_t", waiting: 1 })] }),
    );
    render(<FleetsPage />);
    expect(await screen.findByRole("article", { name: "Fleet acme/web" })).toBeTruthy();
    expect(screen.getByRole("article", { name: "Fleet org/tickets" })).toBeTruthy();
    expect(screen.queryByText(/No fleet is registered/)).toBeNull();
  });

  it("lists what landed in the last 7 days with a link to each pull request", async () => {
    fake.api.fleets.mockResolvedValue(fleetsView({ landed: [landedRow({ fleet: "acme/web", ref: "ENG-198", spec: "dark mode" })] }));
    render(<FleetsPage />);
    const strip = (await screen.findByRole("heading", { name: /Recently landed/ })).parentElement!;
    expect(within(strip).getByText("ENG-198 dark mode")).toBeTruthy();
    expect(within(strip).getByRole("link", { name: /#88/ }).getAttribute("href")).toBe("https://github.test/acme/web/pull/88");
    expect(within(strip).queryByText("Nothing landed in the last 7 days")).toBeNull();
  });

  it("lists recently finished actions briefly", async () => {
    fake.api.fleets.mockResolvedValue(fleetsView({ recentActions: [actionRecord({ ref: "#163", state: "done", doneAt: ago(MINUTE), sentAt: ago(HOUR) })] }));
    render(<FleetsPage />);
    expect(await screen.findByText("acme/web answered #163 · done")).toBeTruthy();
  });

  it("shows an action sent from any window as sent, from the server's view", async () => {
    fake.api.fleets.mockResolvedValue(fleetsView({ waiting: 1, inbox: [inboxRow({ offer: null, action: actionRecord({ sentAt: ago(3 * MINUTE) }) })] }));
    render(<FleetsPage />);
    expect(await screen.findByText("sent · 3m")).toBeTruthy();
  });
});
