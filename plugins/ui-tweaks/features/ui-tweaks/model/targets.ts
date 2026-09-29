// What UI Tweaks reaches for in bb's thread view and New-thread screen. bb
// does not promise these as a contract, so a view or screen lacking any of
// them is left alone and reported.

/**
 * bb's own thread view, in the main area and in each split pane. The
 * `ThreadChat` another plugin embeds carries `data-surface-tone` and is not
 * one.
 */
export const THREAD_VIEW = "[data-thread-window]:not([data-surface-tone])";

/** A target inside a thread view or New-thread screen, and the name a warning gives it. */
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

/**
 * The wrapper around the thread composer's editor, which sets the size of
 * its text. The editor for a queued message sits in the same composer column
 * outside `[data-follow-up-composer]`, and keeps bb's size.
 */
export const COMPOSER_EDITOR: Target = {
  name: "the composer's editor wrapper ([data-follow-up-composer] [data-promptbox-editor-scroll])",
  selector: "[data-follow-up-composer] [data-promptbox-editor-scroll]",
};

/**
 * An editor of any kind. A composer column holding none shows no editor, so
 * lacking the editor wrapper is not a missing target there.
 */
export const EDITABLE = ":is([contenteditable], textarea)";

export const VIEW_TARGETS: readonly Target[] = [COLUMN, COMPOSER];

/** The New-thread screen's editor: a screen showing it is a New-thread screen. */
export const NEW_THREAD_EDITOR = "#root-compose-prompt";

/** The New-thread screen's column, which holds its composer. */
export const NEW_THREAD_COLUMN: Target = {
  name: "its column (.max-w-[760px] with an inline --md-content-w)",
  selector: COLUMN.selector,
};

/** The wrapper around the New-thread screen's editor, which sets the size of its text. */
export const NEW_THREAD_EDITOR_WRAPPER: Target = {
  name: "its editor wrapper ([data-promptbox-editor-scroll])",
  selector: "[data-promptbox-editor-scroll]",
};

/** bb's text size variables, set at the root, that the text size tweak scales. */
export const TEXT_VARIABLES = ["--text-2xs", "--text-xs", "--text-sm", "--text-base", "--text-lg", "--text-xl", "--text-2xl"] as const;

/** The warning's name for --text-sm, the one text variable that counts as a target. */
export const TEXT_SM_TARGET = "the text size variable --text-sm at :root";

/** Whether the root holds --text-sm, without which no thread view or New-thread screen has all its targets. */
export function hasTextTarget(rootVariables: Readonly<Record<string, string>>): boolean {
  return Boolean(rootVariables["--text-sm"]);
}

/** Names of the targets a thread view lacks, in a fixed order. */
export function missingTargets(view: ParentNode, rootVariables: Readonly<Record<string, string>>): string[] {
  const missing = VIEW_TARGETS.filter((target) => view.querySelector(target.selector) === null).map((target) => target.name);
  const composer = view.querySelector(COMPOSER.selector);
  if (composer?.querySelector(EDITABLE) && !composer.querySelector(COMPOSER_EDITOR.selector)) {
    missing.push(COMPOSER_EDITOR.name);
  }
  if (!hasTextTarget(rootVariables)) missing.push(TEXT_SM_TARGET);
  return missing;
}

/**
 * Names of the targets the New-thread screen around `editor` lacks, in a
 * fixed order.
 *
 * @param editor The screen's `#root-compose-prompt`.
 */
export function missingNewThreadTargets(editor: Element, rootVariables: Readonly<Record<string, string>>): string[] {
  const missing: string[] = [];
  const column = editor.closest(NEW_THREAD_COLUMN.selector);
  const wrapper = editor.closest(NEW_THREAD_EDITOR_WRAPPER.selector);
  if (!column) missing.push(NEW_THREAD_COLUMN.name);
  if (!wrapper || (column && !column.contains(wrapper))) missing.push(NEW_THREAD_EDITOR_WRAPPER.name);
  if (!hasTextTarget(rootVariables)) missing.push(TEXT_SM_TARGET);
  return missing;
}
