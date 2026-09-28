// Applies the tweaks to bb's thread views through one style element, and
// warns about each thread view that lacks a target.
import { PHONE_QUERY, tweaksCss } from "./model/css";
import { missingTargets, TEXT_VARIABLES, THREAD_VIEW } from "./model/targets";
import { tweakState } from "./state";

/** How long a thread view may lack a target before it counts as missing, so one still loading does not. */
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
  const stopWatching = watchThreadViews((message) => console.warn(message));

  return () => {
    unsubscribe();
    phone.removeEventListener("change", render);
    stopWatching();
    style.remove();
  };
}

/**
 * Warns once about each thread view that has lacked a target for
 * {@link GRACE_MS}. Returns the function that stops watching.
 */
export function watchThreadViews(warn: (message: string) => void): () => void {
  const firstSeen = new WeakMap<Element, number>();
  const warned = new WeakSet<Element>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let stopped = false;

  const later = (delay: number) => {
    const timer = setTimeout(() => {
      timers.delete(timer);
      scan();
    }, delay);
    timers.add(timer);
  };

  const scan = () => {
    if (stopped) return;
    const now = Date.now();
    let rootVariables: Record<string, string> | null = null;
    for (const view of document.querySelectorAll(THREAD_VIEW)) {
      if (warned.has(view)) continue;
      const seen = firstSeen.get(view);
      if (seen === undefined) {
        firstSeen.set(view, now);
        later(GRACE_MS);
        continue;
      }
      if (now - seen < GRACE_MS) continue;
      rootVariables ??= readRootVariables();
      const missing = missingTargets(view, rootVariables);
      if (missing.length === 0) continue;
      warned.add(view);
      warn(`UI Tweaks: a thread view lacks ${missing.join(", ")}, so neither tweak applies to it. bb may have changed its thread view.`);
    }
  };

  let pending = false;
  const observer = new MutationObserver(() => {
    if (pending) return;
    pending = true;
    const timer = setTimeout(() => {
      timers.delete(timer);
      pending = false;
      scan();
    }, SCAN_DELAY_MS);
    timers.add(timer);
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
