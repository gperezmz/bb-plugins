// @vitest-environment jsdom
// What a person can do in a group header or on a row, against a store fed
// bb's data: which bb calls each makes, with bb's calls recorded.
import { describe, expect, it } from "vitest";
import type { OrganizationMode } from "@/shared/preferences";
import { makeThread, PROJECTS, T0 } from "../testing/fixtures";
import { createCommands } from "../commands/commands";
import { NO_HOST } from "./derive";
import { createListStore } from "./list-store";

const SECTIONS = [{ id: "sec_1", name: "Later", createdAt: 1, updatedAt: 1 }];

/** Commands over a store drawn in `mode`, and the calls bb was sent. */
function setup(mode: OrganizationMode, threads = [makeThread({ id: "a" })]) {
  const calls: { method: string; args: unknown }[] = [];
  const recorder = (method: string) => async (args: unknown) => {
    calls.push({ method, args });
    return {};
  };
  const store = createListStore();
  store.edge = {
    navigate: { toCompose: (options: unknown) => calls.push({ method: "toCompose", args: options }) },
    onNavigate: () => undefined,
    sdk: {
      threads: { update: recorder("threads.update"), unpin: recorder("threads.unpin") },
      projects: { update: recorder("projects.update"), delete: recorder("projects.delete") },
    },
  } as never;
  store.feedHost({ ...NO_HOST, status: "ready", threads, projects: PROJECTS, sections: SECTIONS });
  store.feed(({ prefs }) => ({ prefs: { ...prefs, organizationMode: mode } }));
  store.flush();
  return { store, commands: createCommands(store), calls };
}

describe("New thread from a group header", () => {
  it("files the thread pinned from Pinned", () => {
    const { commands, calls } = setup("project", [makeThread({ id: "a", pinnedAt: T0, isPinned: true })]);
    commands.newThreadInGroup("pinned");
    expect(calls).toEqual([{ method: "toCompose", args: { placement: { sectionId: null, pinned: true }, focusPrompt: true } }]);
  });

  it("files the thread in the section, under the personal project", () => {
    const { commands, calls } = setup("chronological", [makeThread({ id: "a", sectionId: "sec_1" })]);
    commands.newThreadInGroup("section:sec_1");
    expect(calls).toEqual([
      { method: "toCompose", args: { projectId: "proj_personal", placement: { sectionId: "sec_1", pinned: false }, focusPrompt: true } },
    ]);
  });

  it("runs the thread on the machine", () => {
    const { commands, calls } = setup("machine");
    commands.newThreadInGroup("machine:host_1");
    expect(calls).toEqual([{ method: "toCompose", args: { hostId: "host_1", focusPrompt: true } }]);
  });

  it("selects the project from a project's header, and the personal one from Threads", () => {
    const { commands, calls } = setup("project", [makeThread({ id: "a" }), makeThread({ id: "b", projectId: "proj_personal" })]);
    commands.newThreadInGroup("project:proj_a");
    commands.newThreadInGroup("threads");
    expect(calls.map((call) => call.args)).toEqual([
      { projectId: "proj_a", focusPrompt: true },
      { projectId: "proj_personal", focusPrompt: true },
    ]);
  });
});

describe("a project's header", () => {
  it("renames the project through bb", async () => {
    const { commands, calls } = setup("project");
    await commands.renameGroup("project:proj_a", "Alpha two");
    expect(calls).toEqual([{ method: "projects.update", args: { projectId: "proj_a", name: "Alpha two" } }]);
  });

  it("asks before it removes the project, and removes it through bb once confirmed", () => {
    const { store, commands, calls } = setup("project");
    commands.removeProject("project:proj_a");
    expect(store.getState().ui.confirm).toMatchObject({
      title: "Remove Alpha?",
      confirmLabel: "Remove project",
      destructive: true,
    });
    expect(calls).toEqual([]);
    commands.confirm();
    expect(calls).toEqual([{ method: "projects.delete", args: { projectId: "proj_a" } }]);
  });

  it("removes nothing from a group that is not a project", () => {
    const { store, commands } = setup("project");
    commands.removeProject("threads");
    expect(store.getState().ui.confirm).toBeNull();
  });
});
