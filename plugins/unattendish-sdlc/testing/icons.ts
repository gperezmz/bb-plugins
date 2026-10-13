// Whether icon names resolve in bb 0.46: a built-in name, or a name the plugin declares under
// bb.branding.experimental_icons, spelled `unattendish-sdlc/<name>`.
import { expect } from "vitest";
import { DECLARED_ICONS, own } from "@/shared/look/icons";
import { BB_0_46_ICON_NAMES } from "./bb-icons";

const DECLARED = new Set<string>(DECLARED_ICONS.map(own));

/** The names among `names` bb 0.46 would draw its fallback for. */
export function unresolvedIcons(names: Iterable<string>): string[] {
  return [...names].filter((name) => !BB_0_46_ICON_NAMES.has(name) && !DECLARED.has(name));
}

export function expectIconsResolve(names: Iterable<string>): void {
  expect(unresolvedIcons(names)).toEqual([]);
}

/** Every brand logo drawn under `root`, by the service it stands for: the plugin's own SVG, which the SDK stub never draws. */
export function drawnLogos(root: ParentNode): string[] {
  return [...root.querySelectorAll("[data-logo]")].map((logo) => logo.getAttribute("data-logo")!);
}

/** Every icon name drawn under `root`, as the SDK stub marks each. */
export function drawnIcons(root: ParentNode): string[] {
  return [...root.querySelectorAll("[data-icon]")].map((icon) => icon.getAttribute("data-icon")!);
}
