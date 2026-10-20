// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SettingsStatus } from "../../src/core/report-types";
import { SettingsPanel } from "../../src/ui/SettingsPanel";

const sdk = vi.hoisted(() => ({ status: null as unknown, call: vi.fn(), rpc: null as unknown }));
sdk.rpc = { call: sdk.call };

vi.mock("@get-bb/plugin-sdk/app", () => ({
  useRpc: () => sdk.rpc,
  useSettings: () => ({ values: {} }),
  useRealtime: () => {},
  experimental_Icon: () => <svg />,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

sdk.call.mockImplementation(async () => sdk.status);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const status = (prices: Partial<SettingsStatus["prices"]> = {}): SettingsStatus => ({
  prices: { updatedAt: Date.now() - 3 * 3_600_000, bundledDate: "2026-10-19T00:00:00Z", refreshOn: true, stale: false, lastError: null, models: 4014, ...prices },
  backfill: { queued: 0, running: 0, done: 2, failed: 0, paused: false, failures: [] },
  logsMissing: [],
  threadsTracked: 2,
});

async function show(s: SettingsStatus) {
  sdk.status = s;
  await act(async () => {
    render(<SettingsPanel />);
  });
}

describe("the settings section", () => {
  it("has no gateway connection, connection test or request-tagging snippet", async () => {
    await show(status());
    expect(screen.queryByRole("button", { name: /Test connection/ })).toBeNull();
    expect(document.body.textContent).not.toMatch(/gateway|litellm|BB_USAGE_SESSION|x-litellm|read key/i);
    expect(screen.getByRole("button", { name: /Pause/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /JSON/ })).toBeTruthy();
  });

  it("names models.dev in the Prices section and says when the list was fetched", async () => {
    await show(status());
    expect(screen.getByText("Estimated with models.dev prices, fetched 3 hours ago. The list holds 4,014 models.")).toBeTruthy();
  });

  it("says the bundled copy is in use until a fetch succeeded", async () => {
    await show(status({ updatedAt: null }));
    expect(screen.getByText(/Estimated with the models.dev list bundled with the plugin \(2026-10-19\); it has not been fetched yet/)).toBeTruthy();
    cleanup();
    await show(status({ updatedAt: null, refreshOn: false }));
    expect(screen.getByText(/bundled with the plugin \(2026-10-19\)\. Online updates are off/)).toBeTruthy();
  });

  it("says that the last refresh failed, and why", async () => {
    await show(status({ lastError: "HTTP 503" }));
    expect(screen.getByText(/The last refresh failed: HTTP 503/)).toBeTruthy();
  });
});
