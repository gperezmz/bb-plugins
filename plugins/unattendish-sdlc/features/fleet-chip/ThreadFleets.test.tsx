// @vitest-environment jsdom
// The Fleet chip of a thread holding more than one fleet (#270 AC1, AC4, AC6).
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FleetCardView, ProblemView } from "@/src/fleet/application/views";
import { clearReviewRequests, takeReview } from "@/shared/review-request";
import { clearShownFleets, shownFleetOf } from "@/shared/shown-fleet";
import { fake, resetFakeApi } from "@/testing/api";
import { fleetCard, managerFleets } from "@/testing/fixtures";
import { sdk } from "@/testing/sdk";
import { FleetChip } from "./index";

vi.mock("@get-bb/plugin-sdk/app", async () => (await import("@/testing/sdk")).sdkModule());
vi.mock("@/shared/client", async (original) => (await import("@/testing/api")).withFakeClient(await original()));

beforeEach(() => {
  sdk.reset();
  resetFakeApi();
});
afterEach(() => {
  cleanup();
  clearReviewRequests();
  clearShownFleets();
});

const unreadable: ProblemView = { code: "unreadable-rows", text: "1 manifest row cannot be read: Inbox", fix: { kind: "fleet-tab" } };
const leftBehind: ProblemView = { code: "left-behind", text: "Its manifest now names org/wake, so nothing in it is this fleet's.", fix: { kind: "none" } };
const onA = (repo: string, over: Partial<FleetCardView> = {}) => fleetCard({ repo, managerThreadId: "thr_a", ...over });
const dotOf = (button: HTMLElement) => button.querySelector("span[aria-hidden].rounded-full");

async function show(...cards: FleetCardView[]) {
  fake.api.threadFleet.mockResolvedValue(managerFleets(cards));
  await act(async () => {
    render(<FleetChip threadId="thr_a" projectId="proj_a" isCompactViewport={false} />);
  });
  return screen.getByRole("button");
}
const hover = async () => {
  fireEvent.pointerEnter(screen.getByRole("button"));
  fireEvent.focus(screen.getByRole("button"));
  return screen.findAllByRole("banner", {}, { timeout: 2000 });
};

describe("the chip of a thread holding two fleets (#270 AC4)", () => {
  it("shows a red dot and an amber 8 given 6 rows in org/dash and 2 with an unreadable row in org/wake", async () => {
    const button = await show(onA("org/dash", { waiting: 6 }), onA("org/wake", { waiting: 2, problems: [unreadable] }));
    expect(button.getAttribute("aria-label")).toBe("2 fleets: 8 waiting on you, and a fleet has a problem");
    expect(button.textContent).toBe("8");
    expect(dotOf(button)!.className).toContain("bg-destructive");
  });

  it("is the icon alone when neither fleet has a waiting row or a flag", async () => {
    const button = await show(onA("org/dash"), onA("org/wake"));
    expect(button.textContent).toBe("");
    expect(dotOf(button)).toBeNull();
  });

  it("dots red for a left-behind fleet's problem (#270 AC6)", async () => {
    const button = await show(onA("org/dash", { problems: [leftBehind] }), onA("org/wake", { waiting: 2 }));
    expect(button.textContent).toBe("2");
    expect(dotOf(button)!.className).toContain("bg-destructive");
  });

  it("stacks one fleet header per fleet in order, then the hint", async () => {
    await show(onA("org/dash", { waiting: 6 }), onA("org/wake", { waiting: 2, problems: [unreadable] }));
    const headers = await hover();
    expect(headers.map((header) => header.getAttribute("aria-label"))).toEqual(["Fleet org/wake", "Fleet org/dash"]);
    expect(screen.getByText("Click the chip to open the Fleet tab")).toBeTruthy();
  });
});

describe("the spend in the chip's fleet headers (#270 AC5)", () => {
  it("follows each fleet's spend with the others it is shared with", async () => {
    const cost = (sharedWith: string[]) => ({ amount: 4.12, currency: "$", period: "since this manager started", sharedWith });
    await show(onA("org/dash", { waiting: 6, cost: cost(["org/wake"]) }), onA("org/wake", { waiting: 2, cost: cost(["org/dash"]) }));
    const [dash, wake] = await hover();
    expect(within(dash!).getByLabelText("$4.12 spent since this manager started, shared with org/wake")).toBeTruthy();
    expect(within(wake!).getByText("shared with org/dash", { exact: false })).toBeTruthy();
  });
});

describe("opening the Fleet tab from the chip's card (#270 AC1)", () => {
  it("opens the thread's one Fleet tab on org/wake at the row from Review on org/wake's header", async () => {
    await show(onA("org/dash", { waiting: 6 }), onA("org/wake", { waiting: 2, problems: [unreadable] }));
    const [wake] = await hover();
    fireEvent.click(within(wake!).getByRole("button", { name: /^Review/ }));
    expect(sdk.navigate.openThreadPanel).toHaveBeenCalledWith({ actionId: "fleet", params: { threadId: "thr_a" } });
    expect(shownFleetOf("thr_a")).toBe("org/wake");
    expect(takeReview("thr_a", "org/wake")).toBe(true);
  });

  it("opens it on the fleet whose name is pressed", async () => {
    await show(onA("org/dash", { waiting: 6 }), onA("org/wake", { waiting: 2 }));
    await hover();
    fireEvent.click(screen.getByRole("button", { name: "Open the Fleet tab of org/wake" }));
    expect(shownFleetOf("thr_a")).toBe("org/wake");
    expect(sdk.navigate.openThreadPanel).toHaveBeenCalledWith({ actionId: "fleet", params: { threadId: "thr_a" } });
  });

  it("opens it with no fleet named on a click on the chip", async () => {
    const button = await show(onA("org/dash"), onA("org/wake"));
    fireEvent.click(button);
    expect(sdk.navigate.openThreadPanel).toHaveBeenCalledWith({ actionId: "fleet", params: { threadId: "thr_a" } });
    expect(shownFleetOf("thr_a")).toBeNull();
  });
});
