// @vitest-environment jsdom
// AC2: the project scope filters every shelf, starts on All projects at every
// mount, falls back when its project goes, and is picked from a filterable
// list with the arrow keys.
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

async function openPicker() {
  fireEvent.click(screen.getByRole("button", { name: /Project scope/ }));
  return screen.findByRole("combobox", { name: "Filter projects" });
}

describe("AC2: the project scope", () => {
  it("starts on All projects, lists every project including the personal one, and filters every shelf", async () => {
    await mount({ threads: threads(), server: { rows } });
    expect(screen.getByRole("button", { name: "Project scope: All projects" })).toBeTruthy();
    await openPicker();
    expect(scopeOptions().map((option) => option.textContent)).toEqual(["All projects", "Alpha", "Beta", "Personal"]);
    fireEvent.click(within(screen.getByRole("listbox", { name: "Projects" })).getByRole("option", { name: "Alpha" }));
    await flush();
    expect(screen.getByRole("button", { name: "Project scope: Alpha" })).toBeTruthy();
    expect(titles()).toEqual(["Alpha active"]);
    expect(screen.getByRole("button", { name: "Parked (1)" })).toBeTruthy();
  });

  it("shows All projects again when the list mounts again", async () => {
    const first = await mount({ threads: threads(), server: { rows } });
    await openPicker();
    fireEvent.click(within(screen.getByRole("listbox", { name: "Projects" })).getByRole("option", { name: "Beta" }));
    await flush();
    expect(titles()).toEqual(["Beta active"]);
    first.view.unmount();
    await mount({ threads: threads(), server: { rows } });
    expect(screen.getByRole("button", { name: "Project scope: All projects" })).toBeTruthy();
    expect(titles()).toEqual(["Alpha active", "Beta active"].sort());
  });

  it("falls back to All projects when its project is removed", async () => {
    const { host } = await mount({ threads: threads(), server: { rows } });
    await openPicker();
    fireEvent.click(within(screen.getByRole("listbox", { name: "Projects" })).getByRole("option", { name: "Beta" }));
    await flush();
    host.update({ projects: PROJECTS.filter((project) => project.id !== "proj_b"), threads: host.state().threads.filter((thread) => thread.projectId !== "proj_b") });
    await flush();
    expect(screen.getByRole("button", { name: "Project scope: All projects" })).toBeTruthy();
    expect(titles()).toEqual(["Alpha active"]);
  });

  it("filters by name and moves with the arrow keys, wrapping, Home and End", async () => {
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
    expect(scopeOptions().map((option) => option.textContent)).toEqual(["Gamma"]);
    fireEvent.keyDown(input, { key: "Enter" });
    await flush();
    expect(screen.getByRole("button", { name: "Project scope: Gamma" })).toBeTruthy();
  });
});
