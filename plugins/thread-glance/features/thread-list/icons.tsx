// The icons the list draws, by name. bb draws most of them; the six it lacks
// (Pulse, PauseCircle, Car, Meditation, the port indicator's plug and Clean's
// broom) come from Hugeicons' free set, the set bb is built on, and are
// registered with bb under namespaced names so `experimental_Icon` draws every
// icon the same way.
import { createElement, type ComponentType } from "react";
import { Car01Icon, CleanIcon, PauseCircleIcon, PlugSocketIcon, Pulse01Icon, Yoga01Icon } from "@hugeicons/core-free-icons";
import type { Shelf } from "@/shared/lifecycle";

/** Hugeicons' icon data: tags with their attributes. */
type IconData = readonly (readonly [string, Readonly<Record<string, string | number>>])[];

function drawing(data: IconData): ComponentType<{ className?: string }> {
  return function Drawing({ className }) {
    return createElement(
      "svg",
      { viewBox: "0 0 24 24", fill: "none", className, "aria-hidden": true, "data-icon-root": "" },
      ...data.map(([tag, attributes]) => createElement(tag, attributes)),
    );
  };
}

/** The icons bb lacks, by the name they are registered under. */
export const EXTRA_ICONS: Readonly<Record<string, ComponentType<{ className?: string }>>> = {
  "thread-glance-pulse": drawing(Pulse01Icon as IconData),
  "thread-glance-pause-circle": drawing(PauseCircleIcon as IconData),
  "thread-glance-car": drawing(Car01Icon as IconData),
  // Hugeicons' free set has no Meditation; its seated-pose Yoga icon stands for it.
  "thread-glance-meditation": drawing(Yoga01Icon as IconData),
  "thread-glance-ports": drawing(PlugSocketIcon as IconData),
  "thread-glance-clean": drawing(CleanIcon as IconData),
};

/** The icon of each shelf's header. */
export const SHELF_ICONS: Readonly<Record<Shelf, string>> = {
  pinned: "Pin",
  active: "thread-glance-pulse",
  working: "Loading",
  inactive: "thread-glance-pause-circle",
  snoozed: "Clock",
  parked: "thread-glance-car",
  settled: "thread-glance-meditation",
};

export const SHELF_NAMES: Readonly<Record<Shelf, string>> = {
  pinned: "Pinned",
  active: "Active",
  working: "Working",
  inactive: "Inactive",
  snoozed: "Snoozed",
  parked: "Parked",
  settled: "Settled",
};
