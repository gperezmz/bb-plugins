// A fake `DashboardApi` for screen tests. A test file replaces the client's hook with it:
//   vi.mock("@/shared/client", async (original) => (await import("@/testing/api")).withFakeClient(await original()));
import { vi, type Mock } from "vitest";
import type { DashboardApi } from "@/src/fleet/application/views";
import { fleetCard, fleetsView, settingsView } from "./fixtures";

export type FakeApi = { [M in keyof DashboardApi]: Mock<DashboardApi[M]> };

/** Every method answers with an empty, valid view until a test says otherwise. */
export function createFakeApi(): FakeApi {
  return {
    fleets: vi.fn(async () => fleetsView()),
    threadFleet: vi.fn(async () => ({ kind: "none", holder: null }) as const),
    fleetDetail: vi.fn(async () => ({ ok: false, reason: "no fleet detail was set" }) as const),
    ledger: vi.fn(async () => ({ ok: false, reason: "no ledger was set" }) as const),
    sendAction: vi.fn(async () => ({ ok: false, reason: "no action was set" }) as const),
    settings: vi.fn(async () => settingsView()),
    saveCredential: vi.fn(async () => ({ ok: true, settings: settingsView() }) as const),
    removeCredential: vi.fn(async () => ({ ok: true, settings: settingsView() }) as const),
    setInterval: vi.fn(async () => ({ ok: true, settings: settingsView() }) as const),
  };
}

export const fake: { api: FakeApi } = { api: createFakeApi() };

export function resetFakeApi(): FakeApi {
  fake.api = createFakeApi();
  return fake.api;
}

export function withFakeClient<T extends object>(original: T): T & { useDashboardApi: () => DashboardApi } {
  return { ...original, useDashboardApi: () => fake.api };
}

export { fleetCard };
