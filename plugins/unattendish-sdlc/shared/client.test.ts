import { describe, expect, it, vi } from "vitest";
import { createDashboardApi } from "./client";

describe("the dashboard client", () => {
  it("calls the RPC method of the same name with the input", async () => {
    const call = vi.fn(async () => ({ ok: true }));
    const api = createDashboardApi({ call });
    await api.sendAction({ fleet: "acme/web", rowId: "r1", kind: "build" });
    expect(call).toHaveBeenCalledWith("sendAction", { fleet: "acme/web", rowId: "r1", kind: "build" });
    await api.setInterval({ repo: "acme/web", seconds: null });
    expect(call).toHaveBeenLastCalledWith("setInterval", { repo: "acme/web", seconds: null });
  });

  it("calls a method that takes no input with null, as the server's schema asks", async () => {
    const call = vi.fn(async () => ({}));
    await createDashboardApi({ call }).fleets();
    expect(call).toHaveBeenCalledWith("fleets", null);
  });
});
