// What UI Tweaks reaches for in bb's thread view. bb does not promise these
// as a contract, so a view lacking any of them is left alone and reported.

/**
 * bb's own thread view, in the main area and in each split pane. The
 * `ThreadChat` another plugin embeds carries `data-surface-tone` and is not
 * one.
 */
export const THREAD_VIEW = "[data-thread-window]:not([data-surface-tone])";

/** A target inside a thread view, and the name a warning gives it. */
export interface Target {
  name: string;
  selector: string;
}

export const COLUMN: Target = {
  name: 'the transcript column (.max-w-[760px] with an inline --md-content-w)',
  selector: '.max-w-\\[760px\\][style*="--md-content-w"]',
};

export const COMPOSER: Target = {
  name: "the composer column (.chat-prompt-box.max-w-[760px])",
  selector: ".chat-prompt-box.max-w-\\[760px\\]",
};

export const VIEW_TARGETS: readonly Target[] = [COLUMN, COMPOSER];

/**
 * bb's text size variables, set at the root. The first one missing counts
 * as a missing target, since the text size tweak works through them.
 */
export const TEXT_VARIABLES = ["--text-2xs", "--text-xs", "--text-sm", "--text-base", "--text-lg", "--text-xl", "--text-2xl"] as const;

export const TEXT_SM_VARIABLE = "the text size variable --text-sm at :root";

/** Names of the targets a thread view lacks, in a fixed order. */
export function missingTargets(view: ParentNode, rootVariables: Readonly<Record<string, string>>): string[] {
  const missing = VIEW_TARGETS.filter((target) => view.querySelector(target.selector) === null).map((target) => target.name);
  if (!rootVariables["--text-sm"]) missing.push(TEXT_SM_VARIABLE);
  return missing;
}
