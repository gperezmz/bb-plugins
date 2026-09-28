// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChipView } from "../../src/core/report-types";
import { HeaderChip } from "../../src/ui/HeaderChip";

const sdk = vi.hoisted(() => ({
  values: {} as Record<string, unknown>,
  chip: null as unknown,
  openThreadPanel: vi.fn(),
  call: vi.fn(),
  warning: vi.fn(),
  // bb hands out one client per plugin; a new one per render would refetch forever.
  rpc: null as unknown,
}));
sdk.rpc = { call: sdk.call };

vi.mock("@get-bb/plugin-sdk/app", () => ({
  useRpc: () => sdk.rpc,
  useSettings: () => ({ values: sdk.values }),
  useBbNavigate: () => ({ openThreadPanel: sdk.openThreadPanel }),
  useRealtime: () => {},
  experimental_Icon: () => <svg data-testid="coin" />,
}));
vi.mock("sonner", () => ({ toast: { warning: sdk.warning } }));

sdk.call.mockImplementation(async (method: string) => (method === "chip" ? sdk.chip : { claimed: true }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  sdk.values = {};
});

const chip = (over: Partial<ChipView> = {}): ChipView => ({
  visible: true,
  chip: "$1.23",
  headline: { primary: "$1.23", primaryKind: "usd", detail: "estimate", secondary: null, unpricedNote: null, chip: "$1.23", billing: "api" },
  tokens: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, reasoning: 0 },
  untrackedTokens: 0,
  descendants: 2,
  hiddenDescendants: 0,
  turns: 3,
  attention: false,
  toast: null,
  ...over,
} as ChipView);

async function show(view: ChipView, { showAmount = false, compact = false } = {}) {
  sdk.chip = view;
  sdk.values = { showAmount };
  await act(async () => {
    render(<HeaderChip threadId="thr_a" projectId="proj_a" isCompactViewport={compact} />);
  });
}

describe("the header chip", () => {
  it("shows the coin only by default", async () => {
    await show(chip());
    const button = screen.getByRole("button", { name: "Usage: $1.23 with 2 child threads" });
    expect(button.textContent).toBe("");
    expect(screen.getByTestId("coin")).toBeTruthy();
  });

  it("shows the tree total after the coin with showAmount on", async () => {
    await show(chip(), { showAmount: true });
    const button = screen.getByRole("button", { name: /^Usage:/ });
    expect(button.textContent).toBe("$1.23");
    expect(button.firstElementChild).toBe(screen.getByTestId("coin"));
  });

  it("shows the coin only on a compact viewport even with showAmount on", async () => {
    await show(chip(), { showAmount: true, compact: true });
    expect(screen.getByRole("button", { name: /^Usage:/ }).textContent).toBe("");
  });

  it("opens the Usage tab for its pane's thread when clicked", async () => {
    await show(chip());
    fireEvent.click(screen.getByRole("button", { name: /^Usage:/ }));
    expect(sdk.openThreadPanel).toHaveBeenCalledWith({ actionId: "usage", params: { threadId: "thr_a" } });
  });

  it("draws nothing before the tree has a turn record", async () => {
    await show(chip({ visible: false }));
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("shows a budget toast the server hands this window", async () => {
    await show(chip({ toast: { amount: 5, total: "$5.10", title: "Build", rootThreadId: "thr_a" } }));
    expect(sdk.warning).toHaveBeenCalledWith("“Build” crossed $5.00", { description: "Now $5.10. Nothing was stopped." });
  });
});
