// @vitest-environment jsdom
// AC24 and AC25 on a row: the project's mark is its icon once it has loaded,
// else its monogram, a failure is shared by every row of the project, and the
// icon is tried again after a growing wait.
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { iconHealth } from "./icon-health";
import { ProjectMark } from "./ProjectMark";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  iconHealth.clear();
});

const hidden = (container: HTMLElement) => container.querySelector<HTMLImageElement>("img.hidden");

describe("ProjectMark", () => {
  it("draws the monogram while the icon loads, and the icon once it has", () => {
    const { container } = render(<ProjectMark projectId="p1" name="Thread Glance" colour={null} />);
    expect(container.querySelector("[data-monogram]")?.textContent).toBe("T");
    expect(hidden(container)?.getAttribute("src")).toBe("/api/v1/plugins/thread-glance/http/project-icon?project=p1");
    fireEvent.load(hidden(container)!);
    expect(container.querySelector("[data-project-icon]")).not.toBeNull();
    expect(container.querySelector("[data-monogram]")).toBeNull();
  });

  it("keeps the monogram after a failed load, for every row of the project, until the wait has passed", () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    const first = render(<ProjectMark projectId="p2" name="Alpha" colour={null} />);
    const second = render(<ProjectMark projectId="p2" name="Alpha" colour={null} />);
    fireEvent.error(hidden(first.container)!);
    expect(first.container.querySelector("img")).toBeNull();
    expect(first.container.querySelector("[data-monogram]")).not.toBeNull();
    // The other row learns of the failure when it next renders, and does not ask again.
    second.rerender(<ProjectMark projectId="p2" name="Alpha" colour={null} />);
    expect(second.container.querySelector("img")).toBeNull();
    act(() => void vi.advanceTimersByTime(14_999));
    expect(first.container.querySelector("img")).toBeNull();
    act(() => void vi.advanceTimersByTime(1));
    expect(hidden(first.container)?.getAttribute("src")).toContain("&attempt=1");
    fireEvent.error(hidden(first.container)!);
    expect(iconHealth.retryAt("p2", Date.now())).toBe(Date.now() + 30_000);
  });

  it("asks for an upload's own URL, so a new upload is a new image", async () => {
    const { pluginData } = await import("../sync");
    pluginData.appearanceSignal({ epoch: "e", version: 1, value: { colours: {}, icons: { p3: { name: "logo.png", mime: "image/png", updatedAt: 42 } } } });
    const { container } = render(<ProjectMark projectId="p3" name="Gamma" colour={null} />);
    expect(hidden(container)?.getAttribute("src")).toContain("&v=42");
  });

  it("tints the monogram with the project colour at 20 %", () => {
    const { container } = render(<ProjectMark projectId="p4" name="Delta" colour={{ fill: "#336699", text: "#224466" }} />);
    const tile = container.querySelector<HTMLElement>("[data-monogram]")!;
    expect(tile.style.backgroundColor).toBe("rgba(51, 102, 153, 0.2)");
    expect(tile.style.color).toBe("rgb(34, 68, 102)");
  });
});
