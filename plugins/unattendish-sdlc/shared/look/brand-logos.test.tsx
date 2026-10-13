// @vitest-environment jsdom
// GitLab's, Jira's and Linear's logos are their owners' artwork in their owners' colours, named as the service, and
// shown in a brand's dark version only where bb's `.dark` class is set.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BRAND_ARTWORK } from "./brand-logos";
import { ServiceLogo } from "./Glyph";

vi.mock("@get-bb/plugin-sdk/app", async () => (await import("@/testing/sdk")).sdkModule());

afterEach(cleanup);

const fillsOf = (root: ParentNode) => [...new Set([...root.querySelectorAll("[fill]")].map((el) => el.getAttribute("fill")!))].sort();
const drawings = (root: ParentNode) => [...root.querySelectorAll("svg")];

describe("a brand's logo", () => {
  it("is drawn in the colours its owner publishes, and none from the text colour", () => {
    const { baseElement: drawn } = render(
      <>
        <ServiceLogo service="gitlab" />
        <ServiceLogo service="jira" />
        <ServiceLogo service="linear" />
      </>,
    );
    const [gitlab, jira, linear] = [...drawn.querySelectorAll("[data-logo]")];
    expect(fillsOf(gitlab!)).toEqual(["#e24329", "#fc6d26", "#fca326"]);
    expect(fillsOf(jira!)).toEqual(["#1868DB", "white"]);
    expect(fillsOf(linear!)).toEqual(["#222326", "#fff"]);
    expect(drawn.innerHTML).not.toMatch(/currentColor|stroke=/);
  });

  it("is an image named as the service, or hidden from assistive technology where the name is beside it", () => {
    render(
      <>
        <ServiceLogo service="gitlab" />
        <ServiceLogo service="jira" />
        <ServiceLogo service="linear" />
        <ServiceLogo service="gitlab" decorative />
      </>,
    );
    expect(screen.getAllByRole("img").map((logo) => logo.getAttribute("aria-label"))).toEqual(["GitLab", "Jira", "Linear"]);
    expect(screen.getAllByRole("img").every((logo) => drawings(logo).every((svg) => svg.getAttribute("aria-hidden") === "true"))).toBe(true);
    const decorative = document.querySelectorAll("[data-logo]")[3]!;
    expect(decorative.getAttribute("aria-hidden")).toBe("true");
    expect(decorative.getAttribute("role")).toBeNull();
    expect(decorative.getAttribute("aria-label")).toBeNull();
  });

  it("is the size GitHub's logo is, unless a size is given", () => {
    const { baseElement: drawn } = render(
      <>
        <ServiceLogo service="github" />
        <ServiceLogo service="linear" />
        <ServiceLogo service="linear" className="size-6" />
      </>,
    );
    const sizes = [...drawn.querySelectorAll("[role=img]")].map((logo) => logo.className.split(" ").filter((name) => name.startsWith("size-")));
    expect(sizes).toEqual([["size-3.5"], ["size-3.5"], ["size-6"]]);
  });

  it("gives each Jira drawing a clip path of its own, since a page holds many", () => {
    const { baseElement: drawn } = render(
      <>
        <ServiceLogo service="jira" />
        <ServiceLogo service="jira" />
      </>,
    );
    const ids = [...drawn.querySelectorAll("clipPath")].map((clip) => clip.id);
    expect(new Set(ids).size).toBe(2);
    const used = [...drawn.querySelectorAll("g[clip-path]")].map((group) => group.getAttribute("clip-path"));
    expect(used).toEqual(ids.map((id) => `url(#${id})`));
  });

  it("has a dark version where its owner publishes one: Linear's, shown under bb's .dark class and hidden elsewhere", () => {
    expect(Object.entries(BRAND_ARTWORK).filter(([, art]) => art.dark !== undefined).map(([service]) => service)).toEqual(["linear"]);
    const { baseElement: drawn } = render(<ServiceLogo service="linear" />);
    const [light, dark] = drawings(drawn);
    expect(drawings(drawn)).toHaveLength(2);
    expect(fillsOf(light!)).toEqual(["#222326"]);
    expect(fillsOf(dark!)).toEqual(["#fff"]);
    expect(light!.getAttribute("class")!.split(" ")).toContain("[.dark_&]:hidden");
    expect(dark!.getAttribute("class")!.split(" ")).toEqual(expect.arrayContaining(["hidden", "[.dark_&]:block"]));
    for (const svg of drawings(drawn)) expect(svg.getAttribute("class")).not.toMatch(/(^|\s)dark:/);
  });

  it("is drawn once where its owner publishes one version", () => {
    for (const service of ["gitlab", "jira"] as const) {
      const { baseElement: drawn } = render(<ServiceLogo service={service} />);
      expect(drawings(drawn)).toHaveLength(1);
      expect(drawings(drawn)[0]!.getAttribute("class")).not.toContain("hidden");
      cleanup();
    }
  });
});
