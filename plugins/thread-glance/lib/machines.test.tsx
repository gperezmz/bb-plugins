// @vitest-environment jsdom
import { act, screen, waitFor } from "@testing-library/react";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultMachineId, useMachineList, type MachineList } from "./machines";

afterEach(() => vi.restoreAllMocks());

function Probe() {
  const list = useMachineList();
  return (
    <>
      <output>{list.status}</output>
      {list.status === "ready" ? list.machines.map((machine) => <span key={machine.id}>{machine.name}</span>) : null}
    </>
  );
}

const READY: MachineList = {
  status: "ready",
  machines: [
    { id: "host_1", name: "Laptop" },
    { id: "host_2", name: "Server" },
  ],
};

describe("useMachineList", () => {
  it("lists the machines bb lists once they load", async () => {
    renderSlot({ component: Probe }, {}, { sdk: { hosts: { list: async () => [{ id: "host_1", name: "Laptop" }, { id: "host_2", name: "Server" }] } } } as never);
    expect(screen.getByText("loading")).toBeTruthy();
    expect(await screen.findByText("Laptop")).toBeTruthy();
    expect(screen.getByText("Server")).toBeTruthy();
    expect(screen.getByText("ready")).toBeTruthy();
  });

  it("reports a failed load", async () => {
    renderSlot({ component: Probe }, {}, { sdk: { hosts: { list: () => Promise.reject(new Error("offline")) } } } as never);
    expect(await screen.findByText("failed")).toBeTruthy();
  });

  it("lets a load that ends after the component unmounts finish quietly", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    let finish: (hosts: { id: string; name: string }[]) => void = () => {};
    const list = vi.fn(() => new Promise<{ id: string; name: string }[]>((resolve) => (finish = resolve)));
    const view = renderSlot({ component: Probe }, {}, { sdk: { hosts: { list } } } as never);
    await waitFor(() => expect(list).toHaveBeenCalledTimes(1));
    view.unmount();
    await act(async () => finish([{ id: "host_1", name: "Laptop" }]));
    expect(errors).not.toHaveBeenCalled();
  });
});

describe("defaultMachineId", () => {
  it("is the first machine bb lists", () => {
    expect(defaultMachineId(READY)).toBe("host_1");
  });

  it("is empty while the list loads, fails to load, or lists nothing", () => {
    expect(defaultMachineId({ status: "loading" })).toBe("");
    expect(defaultMachineId({ status: "failed" })).toBe("");
    expect(defaultMachineId({ status: "ready", machines: [] })).toBe("");
  });
});
