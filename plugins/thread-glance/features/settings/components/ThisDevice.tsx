// The settings that belong to this browser and are not the server's: they are
// stored on the device, never autosaved with the server settings, and follow
// the other tabs of this browser.
import { portLinkMachine, usePortLinkMachine } from "@/features/thread-list";
import { useMachineList } from "@/shared/machines";
import { Group, SelectRow } from "./Fields";

export const NO_MACHINE_LABEL = "No machine";
export const MACHINES_FAILED_TEXT = "Could not load machines";

export function ThisDevice() {
  const list = useMachineList();
  const chosen = usePortLinkMachine();
  const listed = list.status === "ready" ? list.machines : [];
  const choices = [
    { value: "", label: NO_MACHINE_LABEL },
    ...listed.map((machine) => ({ value: machine.id, label: machine.name })),
    // The choice stays shown when the machine list lacks it, or could not be read.
    ...(chosen !== null && !listed.some((machine) => machine.id === chosen) ? [{ value: chosen, label: chosen }] : []),
  ];
  return (
    <Group id="tg-this-device" title="This device">
      <SelectRow
        label="Port link machine"
        description={
          list.status === "failed"
            ? MACHINES_FAILED_TEXT
            : "Hover-card ports of threads on this machine link to 127.0.0.1 or ::1. Pick the machine this browser runs on, if bb lists it."
        }
        value={chosen ?? ""}
        choices={choices}
        onChange={(value) => portLinkMachine.set(value === "" ? null : value)}
      />
    </Group>
  );
}
