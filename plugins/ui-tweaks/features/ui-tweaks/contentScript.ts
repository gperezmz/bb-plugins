// Applies the tweaks to bb's thread views and New-thread screens through one
// style element, and warns about each one that lacks a target.
import { PHONE_QUERY, tweaksCss } from "./model/css";
import { missingNewThreadTargets, missingTargets, NEW_THREAD_EDITOR, TEXT_VARIABLES, THREAD_VIEW } from "./model/targets";
import { tweakState } from "./state";

/**
 * How long a thread view or New-thread screen may lack a target before it
 * counts as missing, so one still loading does not.
 */
export const GRACE_MS = 5_000;
const SCAN_DELAY_MS = 500;

export function readRootVariables(): Record<string, string> {
  const style = getComputedStyle(document.documentElement);
  const variables: Record<string, string> = {};
  for (const name of TEXT_VARIABLES) {
    for (const variable of [name, `${name}--line-height`]) {
      const value = style.getPropertyValue(variable).trim();
      if (value) variables[variable] = value;
    }
  }
  return variables;
}

/** The content script: bb calls the function it returns when the plugin is disabled or removed. */
export function mountTweaks(): () => void {
  const style = document.createElement("style");
  const phone = window.matchMedia(PHONE_QUERY);

  const render = () => {
    const tweaks = tweakState.get();
    // bb's root holds its phone sizes on a phone, and the tweaks do not apply there.
    const css = tweaks && !phone.matches ? tweaksCss(tweaks, readRootVariables()) : "";
    if (css === "") {
      style.remove();
      return;
    }
    if (style.textContent !== css) style.textContent = css;
    if (!style.isConnected) document.head.append(style);
  };
  const unsubscribe = tweakState.subscribe(render);
  phone.addEventListener("change", render);
  const stopWatching = watchTargets((message) => console.warn(message));

  return () => {
    unsubscribe();
    phone.removeEventListener("change", render);
    stopWatching();
    style.remove();
  };
}

/** What the watcher looks for: the elements standing for one kind of screen, and what each lacks. */
interface Watched {
  selector: string;
  missing(element: Element, rootVariables: Record<string, string>): string[];
  warning(missing: string[]): string;
}

const WATCHED: readonly Watched[] = [
  {
    selector: THREAD_VIEW,
    missing: missingTargets,
    warning: (missing) =>
      `UI Tweaks: a thread view lacks ${missing.join(", ")}, so neither tweak applies to it. bb may have changed its thread view.`,
  },
  {
    // A New-thread screen is known by its editor, so the editor stands for it.
    selector: NEW_THREAD_EDITOR,
    missing: missingNewThreadTargets,
    warning: (missing) =>
      `UI Tweaks: a New-thread screen lacks ${missing.join(", ")}, so neither tweak applies to it. bb may have changed its New-thread screen.`,
  },
];

/**
 * Warns once about each thread view and New-thread screen that has lacked a
 * target for {@link GRACE_MS}. Returns the function that stops watching.
 */
export function watchTargets(warn: (message: string) => void): () => void {
  const firstSeen = new WeakMap<Element, number>();
  const warned = new WeakSet<Element>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let stopped = false;

  const scanIn = (delay: number) => {
    const timer = setTimeout(() => {
      timers.delete(timer);
      scan();
    }, delay);
    timers.add(timer);
  };

  const scan = () => {
    pending = false;
    if (stopped) return;
    const now = Date.now();
    let rootVariables: Record<string, string> | null = null;
    for (const watched of WATCHED) {
      for (const element of document.querySelectorAll(watched.selector)) {
        if (warned.has(element)) continue;
        const seen = firstSeen.get(element);
        if (seen === undefined) {
          firstSeen.set(element, now);
          scanIn(GRACE_MS);
          continue;
        }
        if (now - seen < GRACE_MS) continue;
        rootVariables ??= readRootVariables();
        const missing = watched.missing(element, rootVariables);
        if (missing.length === 0) continue;
        warned.add(element);
        warn(watched.warning(missing));
      }
    }
  };

  let pending = false;
  const observer = new MutationObserver(() => {
    if (pending) return;
    pending = true;
    scanIn(SCAN_DELAY_MS);
  });
  observer.observe(document.body, { childList: true, subtree: true });
  scan();

  return () => {
    stopped = true;
    observer.disconnect();
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
  };
}
