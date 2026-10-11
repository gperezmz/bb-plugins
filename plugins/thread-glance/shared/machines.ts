// The machines bb lists, read once for each component that shows them. This
// device's port link machine and the Project dialogs' machine choice both need
// the same list, so the load and its three states live here, not in each.
import { useEffect, useState } from "react";
import { useSdk } from "@get-bb/plugin-sdk/app";

export interface Machine {
  id: string;
  name: string;
}

export type MachineList = { status: "loading" } | { status: "failed" } | { status: "ready"; machines: readonly Machine[] };

/** The machines bb lists, read when the component mounts. A load that ends after unmount sets nothing. */
export function useMachineList(): MachineList {
  const sdk = useSdk();
  const [list, setList] = useState<MachineList>({ status: "loading" });
  useEffect(() => {
    let current = true;
    Promise.resolve()
      .then(() => sdk.hosts.list())
      .then(
        (hosts) => current && setList({ status: "ready", machines: hosts.map((host) => ({ id: host.id, name: host.name })) }),
        () => current && setList({ status: "failed" }),
      );
    return () => {
      current = false;
    };
  }, [sdk]);
  return list;
}

/** The machine a choice starts on when none is picked yet: the first one bb lists, or none. */
export function defaultMachineId(list: MachineList): string {
  return list.status === "ready" ? (list.machines[0]?.id ?? "") : "";
}
