// @vitest-environment jsdom
// The shelf icons by name, and the icons bb lacks, registered with it.
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { loadPluginApp } from "@get-bb/plugin-sdk/testing/app";
import { SHELVES } from "@/shared/lifecycle";
import { EXTRA_ICONS, SHELF_ICONS } from "./icons";

describe("the shelf icons", () => {
  it("are Pin, Pulse, Loading, PauseCircle, Clock, Car and Meditation", () => {
    expect(SHELVES.map((shelf) => SHELF_ICONS[shelf])).toEqual([
      "Pin",
      "thread-glance-pulse",
      "Loading",
      "thread-glance-pause-circle",
      "Clock",
      "thread-glance-car",
      "thread-glance-meditation",
    ]);
  });

  it("draw as sized outlines in the current colour", () => {
    for (const [name, Icon] of Object.entries(EXTRA_ICONS)) {
      const { container } = render(<Icon className="size-4" />);
      const svg = container.querySelector("svg")!;
      expect(svg.getAttribute("viewBox"), name).toBe("0 0 24 24");
      expect(svg.querySelectorAll("path").length, name).toBeGreaterThan(0);
      expect(svg.querySelector("path")!.getAttribute("stroke"), name).toBe("currentColor");
    }
  });

  it("are registered with bb when the app loads", async () => {
    const app = await loadPluginApp(() => import("../../app"));
    expect(app.icons.map((icon) => icon.name).sort()).toEqual(Object.keys(EXTRA_ICONS).sort());
  });
});
