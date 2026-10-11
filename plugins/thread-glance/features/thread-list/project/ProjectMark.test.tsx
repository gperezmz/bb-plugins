// @vitest-environment jsdom
// AC24 and AC25 on a row: the project's mark is its icon once the server has
// answered with one, else its monogram, and a project with no icon is asked
// for once, whatever its rows do.
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { iconLoader } from "./icon-loader";
import { ProjectMark } from "./ProjectMark";

const asked: string[] = [];
let answer: () => Response;

beforeEach(() => {
  asked.length = 0;
  answer = () => new Response(new Blob(["x"], { type: "image/png" }), { status: 200 });
  vi.stubGlobal("fetch", async (url: string) => {
    asked.push(url);
    return answer();
  });
  let made = 0;
  URL.createObjectURL = () => `blob:icon-${++made}`;
  URL.revokeObjectURL = () => undefined;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  iconLoader.clear();
});

const loaded = () => act(() => vi.waitFor(() => expect(asked.length).toBeGreaterThan(0)).then(() => new Promise((done) => setTimeout(done, 0))));

describe("ProjectMark", () => {
  it("draws the monogram while the icon is asked for, and the icon once the server has sent it", async () => {
    const { container } = render(<ProjectMark projectId="p1" name="Thread Glance" colour={null} />);
    expect(container.querySelector("[data-monogram]")?.textContent).toBe("T");
    expect(container.querySelector("img")).toBeNull();
    await loaded();
    expect(asked).toEqual(["/api/v1/plugins/thread-glance/http/project-icon?project=p1"]);
    expect(container.querySelector("img[data-project-icon]")?.getAttribute("src")).toBe("blob:icon-1");
    expect(container.querySelector("[data-monogram]")).toBeNull();
  });

  it("keeps an icon-less project's monogram and does not ask again when its rows mount again (AC1, AC2)", async () => {
    answer = () => new Response(null, { status: 204 });
    const first = render(<ProjectMark projectId="p2" name="Alpha" colour={null} />);
    const second = render(<ProjectMark projectId="p2" name="Alpha" colour={null} />);
    await loaded();
    expect(first.container.querySelector("[data-monogram]")).not.toBeNull();
    expect(second.container.querySelector("[data-monogram]")).not.toBeNull();
    first.unmount();
    second.unmount();
    const again = render(<ProjectMark projectId="p2" name="Alpha" colour={null} />);
    await loaded();
    expect(again.container.querySelector("[data-monogram]")).not.toBeNull();
    expect(asked).toHaveLength(1);
  });

  it("falls back to the monogram when the browser cannot draw the icon", async () => {
    const { container } = render(<ProjectMark projectId="p5" name="Epsilon" colour={null} />);
    await loaded();
    fireEvent.error(container.querySelector("img")!);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("[data-monogram]")).not.toBeNull();
  });

  it("asks for an upload's own URL, so a new upload is a new image", async () => {
    const { pluginData } = await import("../sync");
    pluginData.appearanceSignal({ epoch: "e", version: 1, value: { colours: {}, icons: { p3: { name: "logo.png", mime: "image/png", updatedAt: 42 } } } });
    render(<ProjectMark projectId="p3" name="Gamma" colour={null} />);
    await loaded();
    expect(asked[0]).toContain("&v=42");
  });

  it("tints the monogram with the project colour at 20 %", () => {
    const { container } = render(<ProjectMark projectId="p4" name="Delta" colour={{ fill: "#336699", text: "#224466" }} />);
    const tile = container.querySelector<HTMLElement>("[data-monogram]")!;
    expect(tile.style.backgroundColor).toBe("rgba(51, 102, 153, 0.2)");
    expect(tile.style.color).toBe("rgb(34, 68, 102)");
  });
});
