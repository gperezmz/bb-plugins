// @vitest-environment jsdom
// #338: the project scope filters every shelf, takes several projects, is kept
// per window, drops a project that goes, marks a left-out project that needs
// you, and is picked from a filterable list with the arrow keys.
import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DAY, makeProject, makeThread, PROJECTS, titleOf } from "@/testing/fixtures";
import { flush, mount, useListHarness } from "../testing/harness";
import { parkedRow } from "@/shared/lifecycle";

useListHarness();

const NOW = Date.now();
const fresh = { createdAt: NOW - 5 * 60_000, updatedAt: NOW - 5 * 60_000, latestAttentionAt: NOW - 5 * 60_000 };
const old = { createdAt: NOW - 4 * DAY, updatedAt: NOW - 3 * DAY, latestAttentionAt: NOW - 3 * DAY };

const threads = () => [
  makeThread({ id: "a1", title: "Alpha active", projectId: "proj_a", ...fresh }),
  makeThread({ id: "b1", title: "Beta active", projectId: "proj_b", ...fresh }),
  makeThread({ id: "a2", title: "Alpha parked", projectId: "proj_a", ...old }),
  makeThread({ id: "b2", title: "Beta parked", projectId: "proj_b", ...old }),
];
const rows = { a2: parkedRow(NOW - DAY), b2: parkedRow(NOW - DAY) };

function titles(): string[] {
  return [...document.querySelectorAll<HTMLElement>("[data-card]")].map((row) => titleOf(row));
}

const scopeOptions = () => within(screen.getByRole("listbox", { name: "Projects" })).getAllByRole("option");
const option = (name: string | RegExp) => within(screen.getByRole("listbox", { name: "Projects" })).getByRole("option", { name });

async function openPicker() {
  fireEvent.click(screen.getByRole("button", { name: /Project scope/ }));
  return screen.findByRole("combobox", { name: "Filter projects" });
}

async function pick(...names: string[]) {
  await openPicker();
  for (const name of names) fireEvent.click(option(name));
  await flush();
}

const scopeButton = (name: string) => screen.getByRole("button", { name: `Project scope: ${name}` });

describe("AC1: several projects", () => {
  it("starts on All projects, lists every project including the personal one, and filters every shelf as projects are ticked", async () => {
    await mount({ threads: threads(), server: { rows } });
    expect(scopeButton("All projects")).toBeTruthy();
    await openPicker();
    expect(scopeOptions().map((o) => o.textContent)).toEqual(["All projects", "Alpha", "Beta", "Personal"]);
    expect(option("All projects").getAttribute("aria-selected")).toBe("true");
    fireEvent.click(option("Alpha"));
    await flush();
    expect(scopeButton("Alpha")).toBeTruthy();
    expect(titles()).toEqual(["Alpha active"]);
    expect(screen.getByRole("button", { name: "Parked (1)" })).toBeTruthy();
    fireEvent.click(option("Beta"));
    await flush();
    expect(scopeButton("Alpha, Beta")).toBeTruthy();
    expect(titles()).toEqual(["Alpha active", "Beta active"]);
    expect(screen.getByRole("button", { name: "Parked (2)" })).toBeTruthy();
    expect(option("Alpha").getAttribute("aria-selected")).toBe("true");
    expect(option("All projects").getAttribute("aria-selected")).toBe("false");
  });

  it("closes the picker on Done and not before", async () => {
    await mount({ threads: threads(), server: { rows } });
    await pick("Alpha", "Beta");
    expect(screen.getByRole("listbox", { name: "Projects" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await flush();
    expect(screen.queryByRole("listbox", { name: "Projects" })).toBeNull();
    expect(scopeButton("Alpha, Beta")).toBeTruthy();
  });

  it("unticks a project, and ticking All projects resets the selection", async () => {
    await mount({ threads: threads(), server: { rows } });
    await pick("Alpha", "Beta");
    fireEvent.click(option("Alpha"));
    await flush();
    expect(titles()).toEqual(["Beta active"]);
    fireEvent.click(option("Alpha"));
    fireEvent.click(option("All projects"));
    await flush();
    expect(scopeButton("All projects")).toBeTruthy();
    expect(titles()).toEqual(["Alpha active", "Beta active"]);
    expect(screen.getByRole("button", { name: "Parked (2)" })).toBeTruthy();
  });

  it("is All projects again once the last ticked project is unticked", async () => {
    await mount({ threads: threads(), server: { rows } });
    await pick("Beta");
    fireEvent.click(option("Beta"));
    await flush();
    expect(scopeButton("All projects")).toBeTruthy();
    expect(titles()).toEqual(["Alpha active", "Beta active"]);
  });

  it("filters by name and ticks with Enter, moving with the arrow keys, wrapping, Home and End", async () => {
    const projects = [...PROJECTS, makeProject("proj_c", "Gamma")];
    await mount({ threads: threads(), projects, server: { rows } });
    const input = await openPicker();
    const active = () => document.getElementById(input.getAttribute("aria-activedescendant")!)!.textContent;
    expect(active()).toBe("All projects");
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(active()).toBe("Personal");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(active()).toBe("All projects");
    fireEvent.keyDown(input, { key: "End" });
    expect(active()).toBe("Personal");
    fireEvent.keyDown(input, { key: "Home" });
    expect(active()).toBe("All projects");
    fireEvent.change(input, { target: { value: "gam" } });
    expect(scopeOptions().map((o) => o.textContent)).toEqual(["Gamma"]);
    fireEvent.keyDown(input, { key: "Enter" });
    await flush();
    expect(scopeButton("Gamma")).toBeTruthy();
    expect(screen.getByRole("listbox", { name: "Projects" })).toBeTruthy();
  });
});

describe("AC2: the scope is kept per window", () => {
  it("is still there when the window reloads", async () => {
    const first = await mount({ threads: threads(), server: { rows } });
    await pick("Alpha", "Beta");
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    first.view.unmount();
    await mount({ threads: threads(), server: { rows } });
    expect(scopeButton("Alpha, Beta")).toBeTruthy();
    expect(titles()).toEqual(["Alpha active", "Beta active"]);
  });

  it("is a new window's own: it starts on All projects", async () => {
    const first = await mount({ threads: threads(), server: { rows } });
    await pick("Beta");
    first.view.unmount();
    sessionStorage.clear();
    await mount({ threads: threads(), server: { rows } });
    expect(scopeButton("All projects")).toBeTruthy();
    expect(titles()).toEqual(["Alpha active", "Beta active"]);
  });

  it("keeps a project that bb has not listed yet when the window reloads, and drops it once bb has", async () => {
    sessionStorage.setItem("thread-glance:scope", JSON.stringify(["proj_a", "proj_gone"]));
    await mount({ threads: threads(), server: { rows } });
    expect(scopeButton("Alpha")).toBeTruthy();
    expect(titles()).toEqual(["Alpha active"]);
    expect(JSON.parse(sessionStorage.getItem("thread-glance:scope")!)).toEqual(["proj_a"]);
  });

  it("drops a project that is removed from the scope once the project list has loaded", async () => {
    const { host } = await mount({ threads: threads(), server: { rows } });
    await pick("Alpha", "Beta");
    host.update({ projects: PROJECTS.filter((project) => project.id !== "proj_b"), threads: host.state().threads.filter((thread) => thread.projectId !== "proj_b") });
    await flush();
    expect(scopeButton("Alpha")).toBeTruthy();
    expect(titles()).toEqual(["Alpha active"]);
    expect(JSON.parse(sessionStorage.getItem("thread-glance:scope")!)).toEqual(["proj_a"]);
  });

  it("is All projects once the last project leaves the scope, and saves nothing", async () => {
    const { host } = await mount({ threads: threads(), server: { rows } });
    await pick("Beta");
    host.update({ projects: PROJECTS.filter((project) => project.id !== "proj_b"), threads: host.state().threads.filter((thread) => thread.projectId !== "proj_b") });
    await flush();
    expect(scopeButton("All projects")).toBeTruthy();
    expect(titles()).toEqual(["Alpha active"]);
    expect(sessionStorage.getItem("thread-glance:scope")).toBeNull();
  });
});

describe("AC3: a left-out project that needs you", () => {
  const ask = (host: { updateThread(id: string, patch: object): void }, pending: boolean) => host.updateThread("b1", { hasPendingInteraction: pending });

  it("marks the picker's button and the project's row until the question is answered", async () => {
    const { host } = await mount({ threads: threads(), server: { rows } });
    await pick("Alpha");
    expect(screen.queryByRole("img", { name: "Needs you" })).toBeNull();
    ask(host, true);
    await flush();
    expect(scopeButton("Alpha. Needs you in Beta")).toBeTruthy();
    expect(within(option(/^Beta/)).getByRole("img", { name: "Needs you" })).toBeTruthy();
    expect(within(option("Alpha")).queryByRole("img", { name: "Needs you" })).toBeNull();
    ask(host, false);
    await flush();
    expect(scopeButton("Alpha")).toBeTruthy();
    expect(screen.queryByRole("img", { name: "Needs you" })).toBeNull();
  });

  it("marks nothing for a project in the scope or when the scope is All projects", async () => {
    const { host } = await mount({ threads: threads(), server: { rows } });
    ask(host, true);
    await flush();
    expect(scopeButton("All projects")).toBeTruthy();
    await pick("Beta");
    expect(scopeButton("Beta")).toBeTruthy();
    expect(screen.queryByRole("img", { name: "Needs you" })).toBeNull();
  });
});
