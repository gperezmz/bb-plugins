import { describe, expect, it, vi } from "vitest";
import type { PluginSidebarSection } from "@get-bb/plugin-sdk/app";
import type { Commands } from "../commands/commands";
import { inlineThreadActions, MOVE_TO_SECTION_LABEL, type InlineInputs } from "./thread-menu";

const SECTIONS = [
  { id: "sec_1", name: "Later", createdAt: 0, updatedAt: 0 },
  { id: "sec_2", name: "Reviews", createdAt: 0, updatedAt: 0 },
] satisfies PluginSidebarSection[];

function inputs(overrides: Partial<InlineInputs> = {}): InlineInputs {
  return {
    threadId: "t",
    descendantsUnread: false,
    archived: false,
    place: { sectionId: null, pinned: false, root: true },
    sections: SECTIONS,
    ...overrides,
  };
}

const keys = (given: InlineInputs) => inlineThreadActions(given, {} as Commands).map((item) => item.key);
const moveToSection = (given: InlineInputs, commands: Partial<Commands> = {}) =>
  inlineThreadActions(given, commands as Commands).find((item) => item.key === "thread-glance/move-to-section");

describe("Move to section", () => {
  it("lists Threads and each section, with the thread's own place disabled", () => {
    const action = moveToSection(inputs({ place: { sectionId: "sec_2", pinned: false, root: true } }))!.action;
    expect(action.label).toBe(MOVE_TO_SECTION_LABEL);
    expect(action.choices?.items).toEqual([
      { id: "threads", label: "Threads", selected: false, disabled: false },
      { id: "section:sec_1", label: "Later", selected: false, disabled: false },
      { id: "section:sec_2", label: "Reviews", selected: true, disabled: true },
    ]);
  });

  it("marks Threads as the place of a loose thread, and no place for a pinned one", () => {
    expect(moveToSection(inputs())!.action.choices?.items.map((item) => item.disabled)).toEqual([true, false, false]);
    const pinned = inputs({ place: { sectionId: null, pinned: true, root: true } });
    expect(moveToSection(pinned)!.action.choices?.items.map((item) => item.disabled)).toEqual([false, false, false]);
  });

  it("files the thread where the choice says, Threads as null", () => {
    const moveToSectionCommand = vi.fn();
    const action = moveToSection(inputs(), { moveToSection: moveToSectionCommand })!.action;
    action.run({ value: "section:sec_1", requestRename() {} });
    action.run({ value: "threads", requestRename() {} });
    expect(moveToSectionCommand.mock.calls).toEqual([
      ["t", "sec_1"],
      ["t", null],
    ]);
  });

  it("is left out where there are no sections, on a child thread and on an archived one", () => {
    expect(keys(inputs({ sections: [] }))).not.toContain("thread-glance/move-to-section");
    expect(keys(inputs({ place: { sectionId: null, pinned: false, root: false } }))).not.toContain("thread-glance/move-to-section");
    expect(keys(inputs({ archived: true }))).not.toContain("thread-glance/move-to-section");
    expect(keys(inputs())).toContain("thread-glance/move-to-section");
  });
});
