import { describe, expect, it } from "vitest";
import { pocketLayout, type LayoutItem } from "./layout";

type Item = LayoutItem & { id: string };

const newThread: Item = { id: "__bb__/new-thread", isVisible: true, action: { kind: "new-thread" } };
const search: Item = { id: "__bb__/search-threads", isVisible: true, action: { kind: "search-threads" } };
const plugins: Item = { id: "__bb__/extensions", isVisible: true, action: { kind: "open-extensions" } };
const usage: Item = {
  id: "usage/usage",
  isVisible: true,
  action: { kind: "open-plugin-panel", pluginId: "usage", panelId: "usage" },
};
const hidden = (item: Item): Item => ({ ...item, isVisible: false });
const ids = (items: readonly Item[]) => items.map((item) => item.id);

describe("pocketLayout", () => {
  it("puts every visible item but New thread and search in the icon row, in bb's order", () => {
    const layout = pocketLayout([usage, newThread, plugins, search]);
    expect(ids(layout.iconRow)).toEqual(["usage/usage", "__bb__/extensions"]);
    expect(layout.newThread?.id).toBe("__bb__/new-thread");
    expect(layout.search?.id).toBe("__bb__/search-threads");
    expect(layout.overflow).toEqual([]);
  });

  it("puts every hidden item in the overflow, in bb's order, New thread and search included", () => {
    const layout = pocketLayout([hidden(search), hidden(usage), plugins, hidden(newThread)]);
    expect(ids(layout.overflow)).toEqual(["__bb__/search-threads", "usage/usage", "__bb__/new-thread"]);
    expect(layout.search).toBeNull();
    expect(ids(layout.iconRow)).toEqual(["__bb__/extensions"]);
  });

  it("leaves the New thread line empty when both New thread and search are hidden", () => {
    const layout = pocketLayout([hidden(newThread), hidden(search), plugins]);
    expect(layout.newThread).toBeNull();
    expect(layout.search).toBeNull();
    expect(ids(layout.overflow)).toEqual(["__bb__/new-thread", "__bb__/search-threads"]);
  });
});
