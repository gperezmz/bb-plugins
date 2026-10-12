// The colours the plugin draws in, each one of bb's theme tokens, so a page follows bb's palette and its own light or
// dark setting. A token class follows bb's `.dark` class; Tailwind's `dark:` variant follows the operating system
// instead, so the plugin never uses it. Coloured text takes the text variants of the error and warning tones, which
// stay readable in both modes.
import type { InboxRowView } from "@/src/fleet/application/views";

type WaitsFor = InboxRowView["waitsFor"];

export type Tone = "blue" | "purple" | "green" | "amber" | "red" | "grey";

/** The text colour of each tone, which an icon drawn in the current colour takes too. */
export const TONE_TEXT: Readonly<Record<Tone, string>> = {
  blue: "text-timeline-accent",
  purple: "text-pr-merged",
  green: "text-success",
  amber: "text-warning-text",
  red: "text-destructive-text",
  grey: "text-muted-foreground",
};

/** The fill of each tone, for a bar or a dot. */
export const TONE_FILL: Readonly<Record<Tone, string>> = {
  blue: "bg-timeline-accent",
  purple: "bg-pr-merged",
  green: "bg-success",
  amber: "bg-warning",
  red: "bg-destructive",
  grey: "bg-muted-foreground",
};

/** The border of each tone, for an outlined control. */
export const TONE_BORDER: Readonly<Record<Tone, string>> = {
  blue: "border-timeline-accent",
  purple: "border-pr-merged",
  green: "border-success",
  amber: "border-warning",
  red: "border-destructive",
  grey: "border-border",
};

/** The tone of each kind of wait: your answer blue, a grant to merge purple, your ready label green, anything else grey. */
export const KIND_TONES: Readonly<Record<WaitsFor, Tone>> = { answer: "blue", grant: "purple", ready: "green", other: "grey" };

/** The four Status counts, in the order they are always drawn. */
export const COUNTS = ["blocked", "inFlight", "waiting", "landed"] as const;
export type CountKey = (typeof COUNTS)[number];

/** The tone of each count. Waits on you is amber, the strongest of the four. */
export const COUNT_TONES: Readonly<Record<CountKey, Tone>> = { blocked: "grey", inFlight: "blue", waiting: "amber", landed: "purple" };

/** The tone of each manager state: working green, idle grey, no manager red. */
export const MANAGER_TONES: Readonly<Record<"working" | "idle" | "none", Tone>> = { working: "green", idle: "grey", none: "red" };

/** The tone of a fleet's problem and of its warning. */
export const FLAG_TONES: Readonly<Record<"problem" | "warning", Tone>> = { problem: "red", warning: "amber" };
