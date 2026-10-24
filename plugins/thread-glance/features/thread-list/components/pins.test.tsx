// @vitest-environment jsdom
// #339: projects are pinned from the picker's rows into a row of icons above
// the list, where a click puts a project in the scope or takes it out in step
// with the picker. The pins are kept per device and Reset leaves them.
import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { makeThread, titleOf } from "@/testing/fixtures";
import { flush, mount, useListHarness } from "../testing/harness";

useListHarness();

const NOW = Date.now();
const fresh = { createdAt: NOW - 5 * 60_000, updatedAt: NOW - 5 * 60_000, latestAttentionAt: NOW - 5 * 60_000 };

const threads = () => [
  makeThread({ id: "a1", title: "Alpha active", projectId: "proj_a", ...fresh }),
  makeThread({ id: "b1", title: "Beta active", projectId: "proj_b", ...fresh }),
];

function titles(): string[] {
  return [...document.querySelectorAll<HTMLElement>("[data-card]")].map((row) => titleOf(row));
}

// Buttons are found by their label with a selector: a role query over the whole list is slow under load.
const button = (label: string) => screen.getByLabelText(label, { selector: "button" });
const maybeButton = (label: string) => screen.queryByLabelText(label, { selector: "button" });
const pinsRow = () => screen.queryByRole("group", { name: "Pinned projects" });
const pinned = () => (pinsRow() === null ? [] : [...pinsRow()!.querySelectorAll("button")].map((b) => b.getAttribute("aria-label")));
const option = (name: string | RegExp) => within(screen.getByRole("listbox", { name: "Projects" })).getByRole("option", { name });

async function openPicker() {
  fireEvent.click(screen.getByLabelText(/^Project scope/, { selector: "button" }));
  await screen.findByRole("combobox", { name: "Filter projects" });
}

async function pin(...names: string[]) {
  await openPicker();
  for (const name of names) fireEvent.click(button(`Pin ${name}`));
  await flush();
}

describe("AC1: a project is pinned or unpinned from its row in the picker", () => {
  it("shows no row while nothing is pinned or limiting the list", async () => {
    await mount({ threads: threads() });
    expect(pinsRow()).toBeNull();
  });

  it("puts a pinned project in the row above the list, in the order pinned, and takes it out when unpinned", async () => {
    await mount({ threads: threads() });
    await pin("Beta", "Alpha");
    expect(pinned()).toEqual(["Beta", "Alpha"]);
    expect(maybeButton("Pin Beta")).toBeNull();
    fireEvent.click(button("Unpin Beta"));
    await flush();
    expect(pinned()).toEqual(["Alpha"]);
    fireEvent.click(button("Unpin Alpha"));
    await flush();
    expect(pinsRow()).toBeNull();
    expect(button("Pin Alpha")).toBeTruthy();
  });

  it("pins from a row without ticking it, and offers no pin on All projects", async () => {
    await mount({ threads: threads() });
    await pin("Alpha");
    expect(option("Alpha").getAttribute("aria-selected")).toBe("false");
    expect(titles()).toEqual(["Alpha active", "Beta active"]);
    expect(maybeButton("Pin All projects")).toBeNull();
  });

  it("draws each pin as its project's mark", async () => {
    await mount({ threads: threads() });
    await pin("Alpha");
    expect(pinsRow()!.querySelector("[data-monogram]")?.textContent).toBe("A");
  });

  it("leaves out a pin whose project bb no longer lists", async () => {
    localStorage.setItem("thread-glance:pinnedProjects", JSON.stringify(["proj_gone", "proj_a"]));
    await mount({ threads: threads() });
    expect(pinned()).toEqual(["Alpha"]);
  });
});

describe("AC2: a click on a pin adds its project to the scope or removes it, in step with the picker", () => {
  it("adds a pinned project to All projects as its scope, then returns to All projects on the second click", async () => {
    await mount({ threads: threads() });
    await pin("Alpha", "Beta");
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await flush();
    expect(button("Alpha").getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(button("Alpha"));
    await flush();
    expect(titles()).toEqual(["Alpha active"]);
    expect(button("Alpha").getAttribute("aria-pressed")).toBe("true");
    expect(button("Beta").getAttribute("aria-pressed")).toBe("false");
    await openPicker();
    expect(option("Alpha").getAttribute("aria-selected")).toBe("true");
    expect(option("All projects").getAttribute("aria-selected")).toBe("false");
    fireEvent.click(button("Alpha"));
    await flush();
    expect(titles()).toEqual(["Alpha active", "Beta active"]);
    expect(option("All projects").getAttribute("aria-selected")).toBe("true");
    expect(button("Alpha").getAttribute("aria-pressed")).toBe("false");
  });

  it("adds a second project to the scope, and shows a project ticked in the picker as selected", async () => {
    await mount({ threads: threads() });
    await pin("Alpha", "Beta");
    fireEvent.click(option("Beta"));
    await flush();
    expect(button("Beta").getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(button("Alpha"));
    await flush();
    expect(titles()).toEqual(["Alpha active", "Beta active"]);
    expect(option("Alpha").getAttribute("aria-selected")).toBe("true");
    expect(option("Beta").getAttribute("aria-selected")).toBe("true");
  });

  it("marks a pinned project the scope leaves out that has a thread waiting on the person", async () => {
    const { host } = await mount({ threads: threads() });
    await pin("Alpha", "Beta");
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    fireEvent.click(button("Alpha"));
    host.updateThread("b1", { hasPendingInteraction: true });
    await flush();
    expect(button("Beta. Needs you").querySelector("[data-icon=CircleQuestion]")).not.toBeNull();
    expect(maybeButton("Alpha. Needs you")).toBeNull();
    fireEvent.click(button("Beta. Needs you"));
    await flush();
    expect(maybeButton("Beta. Needs you")).toBeNull();
    expect(button("Beta")).toBeTruthy();
  });
});

describe("AC3: pins are kept per device, and Reset clears the scope but keeps them", () => {
  it("keeps the pins when the list reloads on this device, but not the scope of another window", async () => {
    const first = await mount({ threads: threads() });
    await pin("Alpha", "Beta");
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    first.view.unmount();
    sessionStorage.clear();
    await mount({ threads: threads() });
    expect(pinned()).toEqual(["Alpha", "Beta"]);
    expect(JSON.parse(localStorage.getItem("thread-glance:pinnedProjects")!)).toEqual(["proj_a", "proj_b"]);
  });

  it("has no Reset while the scope is All projects, and clears the scope but not the pins when chosen", async () => {
    await mount({ threads: threads() });
    await pin("Alpha", "Beta");
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await flush();
    expect(maybeButton("Reset")).toBeNull();
    fireEvent.click(button("Alpha"));
    fireEvent.click(button("Beta"));
    await flush();
    expect(titles()).toEqual(["Alpha active", "Beta active"]);
    fireEvent.click(button("Beta"));
    await flush();
    expect(titles()).toEqual(["Alpha active"]);
    fireEvent.click(button("Reset"));
    await flush();
    expect(titles()).toEqual(["Alpha active", "Beta active"]);
    expect(screen.getByLabelText("Project scope: All projects", { selector: "button" })).toBeTruthy();
    expect(pinned()).toEqual(["Alpha", "Beta"]);
    expect(maybeButton("Reset")).toBeNull();
  });

  it("offers Reset for a scope picked in the picker with nothing pinned", async () => {
    await mount({ threads: threads() });
    await openPicker();
    fireEvent.click(option("Beta"));
    await flush();
    expect(pinned()).toEqual(["Reset"]);
    fireEvent.click(button("Reset"));
    await flush();
    expect(pinsRow()).toBeNull();
    expect(titles()).toEqual(["Alpha active", "Beta active"]);
  });

  it("draws Reset as an icon with no text", async () => {
    await mount({ threads: threads() });
    await pin("Alpha");
    fireEvent.click(button("Alpha"));
    await flush();
    expect(button("Reset").textContent).toBe("");
  });
});
