// @vitest-environment jsdom
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PricesInfo, TopTree, TopTrees } from "../../src/core/report-types";
import { UsagePage } from "../../src/ui/UsagePage";

const sdk = vi.hoisted(() => ({ top: null as unknown, call: vi.fn(), rpc: null as unknown }));
sdk.rpc = { call: sdk.call };

vi.mock("@get-bb/plugin-sdk/app", () => ({
  useRpc: () => sdk.rpc,
  useSettings: () => ({ values: {} }),
  useBbNavigate: () => ({ toThread: vi.fn(), toPluginPanel: vi.fn() }),
  useRealtime: () => {},
  experimental_ProviderIcon: () => <svg />,
  experimental_useProviders: () => ({ providers: [] }),
}));
// The project picker is a Radix select, which jsdom cannot open and no test here needs.
vi.mock("@/components/ui/select", () => ({
  Select: ({ children }: { children: unknown }) => <div>{children as never}</div>,
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: () => null,
  SelectItem: () => null,
}));

sdk.call.mockImplementation(async () => sdk.top);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const prices: PricesInfo = { updatedAt: Date.now() - 3_600_000, bundledDate: null, refreshOn: true, stale: false, lastError: null };

const tree = (n: number, over: Partial<TopTree> = {}): TopTree => ({
  threadId: `thr_${n}`,
  title: `Tree ${n}`,
  providerId: "claude-code",
  projectId: null,
  headline: { primary: "", primaryKind: "usd", detail: "", secondary: null, unpricedNote: null, chip: "", billing: "api-key" },
  usd: 0,
  billedUsd: 0,
  listPriceUsd: 0,
  tokens: 0,
  descendants: 0,
  lastActivityAt: Date.now() - 3_600_000,
  billing: "api-key",
  ...over,
});

async function show(trees: TopTrees) {
  sdk.top = { trees, projects: [], prices };
  await act(async () => {
    render(<UsagePage subPath="" />);
  });
}

const rows = (list: HTMLElement) => within(list).getAllByRole("listitem");

describe("the Thread usage page", () => {
  it("ranks the trees that have dollars by those dollars, from 1, and lists the unpriced trees apart under Not priced, from 1", async () => {
    await show({
      priced: [tree(1, { usd: 12.3, tokens: 3_200_000 }), tree(2, { usd: 1, tokens: 90_000 })],
      notPriced: [tree(3, { tokens: 45_000 }), tree(4, { tokens: 900 })],
    });
    const [pricedList, notPricedList] = screen.getAllByRole("list");
    expect(rows(pricedList!).map((li) => li.textContent)).toEqual([
      expect.stringMatching(/^1.*Tree 1.*\$12\.30/),
      expect.stringMatching(/^2.*Tree 2.*\$1\.00/),
    ]);
    expect(screen.getByRole("heading", { name: "Not priced" })).toBeTruthy();
    const unpriced = rows(notPricedList!);
    expect(unpriced.map((li) => li.textContent)).toEqual([
      expect.stringMatching(/^1.*Tree 3.*45k tokens.*not priced/),
      expect.stringMatching(/^2.*Tree 4.*900 tokens.*not priced/),
    ]);
    // An unpriced row's figure is its token count: no dollars, and no bar.
    for (const li of unpriced) {
      expect(li.textContent).not.toContain("$");
      expect(li.querySelector("[aria-hidden]")).toBeNull();
    }
    // A priced row has its bar.
    expect(rows(pricedList!)[0]!.querySelector("[aria-hidden]")).not.toBeNull();
  });

  it("shows only the Not priced list when no tree has a price, and leaves it out when every tree has one", async () => {
    await show({ priced: [], notPriced: [tree(3, { tokens: 45_000 })] });
    expect(screen.getAllByRole("list")).toHaveLength(1);
    expect(screen.getByRole("heading", { name: "Not priced" })).toBeTruthy();
    cleanup();
    await show({ priced: [tree(1, { usd: 2, tokens: 10 })], notPriced: [] });
    expect(screen.queryByRole("heading", { name: "Not priced" })).toBeNull();
  });

  it("says no tree has usage when both lists are empty", async () => {
    await show({ priced: [], notPriced: [] });
    expect(screen.getByText("No thread trees with usage in the last 7 days.")).toBeTruthy();
  });

  it("names models.dev and says when its list was fetched, and names no LiteLLM", async () => {
    await show({ priced: [tree(1, { usd: 2, tokens: 10 })], notPriced: [] });
    expect(screen.getByText("Estimated with models.dev prices, fetched 1 hour ago")).toBeTruthy();
    expect(document.body.textContent!.toLowerCase()).not.toContain("litellm");
  });
});
