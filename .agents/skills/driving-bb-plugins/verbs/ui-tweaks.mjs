// UI Tweaks' feature verbs: each drives one sub-feature of features/ui-tweaks.md
// through Settings → UI Tweaks, the New-thread screen or a thread view, with the
// roles and names the plugin gives its elements, and returns what the page showed
// before and after and what the plugin stored, read back over its RPC.
//
//   drive-bb-plugins ui-tweaks --run <run> <verb> [args] [--second-window] [--reload] [--mobile] [--label <label>]
//
// The tweaks reach a freshly loaded page a few seconds after load, so a verb
// that reads the effect waits for the value the stored tweaks call for, and
// where that is bb's own look, which nothing changes, waits out the plugin's
// 5-second grace instead.

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** What each segment draws: the font of the New-thread composer and the width of the transcript and composer columns. */
const FONT = { small: "12px", medium: "13px", large: "15px" };
const WIDTH = { narrow: "640px", medium: "760px", wide: "960px" };

/** Writes an RPC input to a file beside the run's UI evidence and returns its path. */
function writeInput(value) {
  const file = `${process.env.DBP_UI}/input-${process.pid}-${Date.now()}.json`;
  writeFileSync(file, JSON.stringify(value));
  return file;
}

/** The plugin's stored tweaks, read over its `getTweaks` RPC through the harness, logged in cli.md. */
function stored(cli, label) {
  const answer = JSON.parse(cli(label, "plugin", "rpc", "call", "ui-tweaks", "getTweaks", "--json"));
  return answer.result ?? answer;
}

/** The stored tweaks once they read `want` (a save is a call of its own after the click), else as they are after 5 seconds. */
async function storedAs(cli, label, want) {
  let now = stored(cli, label);
  for (let i = 0; i < 10 && (now.textSize !== want.textSize || now.width !== want.width); i++) {
    await sleep(500);
    now = stored(cli, label);
  }
  return now;
}

/** The two radiogroups of the settings section. */
const groups = (page) => ({
  textSize: page.getByRole("radiogroup", { name: "Text size" }),
  width: page.getByRole("radiogroup", { name: "Transcript width" }),
});

/** Opens Settings → UI Tweaks and waits for both groups to have a checked radio, which they have only once the plugin's first read answered. */
async function openSettings(page, url) {
  await page.goto(`${url}settings/plugins/ui-tweaks`);
  const { textSize, width } = groups(page);
  await textSize.getByRole("radio", { checked: true }).waitFor();
  await width.getByRole("radio", { checked: true }).waitFor();
}

/** The name of each group's checked radio, and any alert or dialog the page shows. */
async function readSettings(page) {
  const { textSize, width } = groups(page);
  return {
    textSize: await textSize.getByRole("radio", { checked: true }).evaluate((r) => r.getAttribute("aria-label") ?? r.innerText.trim()),
    width: await width.getByRole("radio", { checked: true }).evaluate((r) => r.getAttribute("aria-label") ?? r.innerText.trim()),
    alerts: await page.getByRole("alert").allInnerTexts(),
  };
}

/** Clicks a segment's radio in its group and waits for it to be checked. */
async function choose(group, name) {
  await group.getByRole("radio", { name, exact: true }).click();
  await group.getByRole("radio", { name, exact: true, checked: true }).waitFor();
}

/**
 * The tweak the page carries: bb's own look reads `medium` for both. The <style> the plugin adds has no id, so it is
 * the one in the head whose text holds `--md-content-w`.
 */
function readLook(page, scope) {
  return page.evaluate((scope) => {
    const columns = scope === "thread"
      ? [...document.querySelectorAll("[data-thread-window]:not([data-surface-tone]) .max-w-\\[760px\\]")]
      : [...document.querySelectorAll(".max-w-\\[760px\\]")].filter((e) => e.querySelector("#root-compose-prompt")).slice(-1);
    const prompt = document.querySelector("#root-compose-prompt");
    return {
      columns: columns.map((c) => getComputedStyle(c).maxWidth),
      fontSize: prompt === null ? null : getComputedStyle(prompt).fontSize,
      styles: [...document.head.querySelectorAll("style")].filter((s) => s.textContent.includes("--md-content-w")).length,
    };
  }, scope);
}

/**
 * Waits for the page's look to be the one `tweaks` call for: every column the width, and on the New-thread screen the
 * composer the font. A look that is bb's own is proved by waiting 5 seconds with the plugin's style absent.
 * Returns whether it was reached.
 */
async function waitForLook(page, scope, tweaks, timeout = 20000) {
  const wide = WIDTH[tweaks.width];
  const font = scope === "new-thread" ? FONT[tweaks.textSize] : null;
  const bbs = tweaks.width === "medium" && (scope === "thread" || tweaks.textSize === "medium");
  if (bbs) await sleep(5000);
  return page
    .waitForFunction(
      ([scope, wide, font, bbs]) => {
        const columns = scope === "thread"
          ? [...document.querySelectorAll("[data-thread-window]:not([data-surface-tone]) .max-w-\\[760px\\]")]
          : [...document.querySelectorAll(".max-w-\\[760px\\]")].filter((e) => e.querySelector("#root-compose-prompt")).slice(-1);
        const styled = [...document.head.querySelectorAll("style")].some((s) => s.textContent.includes("--md-content-w"));
        return columns.length > 0 && columns.every((c) => getComputedStyle(c).maxWidth === wide) &&
          (font === null || getComputedStyle(document.querySelector("#root-compose-prompt")).fontSize === font) &&
          (!bbs || !styled);
      },
      [scope, wide, font, bbs],
      { timeout },
    )
    .then(() => true, () => false);
}

/** Opens the New-thread screen, or the thread titled `title`, and returns which scope its columns are read in. */
async function openEffect(page, url, cli, title) {
  if (title === undefined) {
    await page.goto(url);
    await page.locator("#root-compose-prompt").waitFor();
    return "new-thread";
  }
  const threads = JSON.parse(cli("ui-tweaks.thread/list", "thread", "list", "--json"));
  const found = threads.find((t) => t.title === title);
  if (found === undefined) throw new Error(`no thread is titled ${title}`);
  await page.goto(`${url}projects/${found.projectId}/threads/${found.id}`);
  await page.locator("[data-thread-window]:not([data-surface-tone]) .max-w-\\[760px\\]").first().waitFor();
  return "thread";
}

export const verbs = {
  settings: {
    usage: "[--text-size <Small|Medium|Large>] [--width <Narrow|Medium|Wide>] [--second-window] [--reload]: open Settings → UI Tweaks and read both radiogroups; --text-size and --width press that radio in its group and wait for it to be checked; the `getTweaks` RPC; --second-window reads a second Settings window opened before, with no reload, --reload this window after one",
    valued: ["text-size", "width"],
    async run({ page, url, capture, cli, newPage, flags }) {
      await openSettings(page, url);
      let second = null;
      if (flags["second-window"]) {
        second = await newPage();
        await openSettings(second, url);
        await page.bringToFront();
      }
      const before = { ...(await readSettings(page)), stored: stored(cli, "ui-tweaks.settings/rpc") };
      await capture("before", "open Settings → UI Tweaks");
      let dialogs = 0;
      page.on("dialog", () => dialogs++);
      const { textSize, width } = groups(page);
      if (flags["text-size"]) await choose(textSize, flags["text-size"]);
      if (flags.width) await choose(width, flags.width);
      const after = await readSettings(page);
      await capture("after", ["text size", flags["text-size"], "width", flags.width].filter((p) => p && p !== true).join(" ") || "no change");
      const want = { textSize: after.textSize.toLowerCase(), width: after.width.toLowerCase() };
      const result = { before, after: { ...after, dialogs }, stored: await storedAs(cli, "ui-tweaks.settings/rpc", want) };
      if (second !== null) {
        await second.bringToFront();
        const want = { textSize: flags["text-size"] ?? before.textSize, width: flags.width ?? before.width };
        const followed = await Promise.all([
          groups(second).textSize.getByRole("radio", { name: want.textSize, exact: true, checked: true }).waitFor({ timeout: 10000 }),
          groups(second).width.getByRole("radio", { name: want.width, exact: true, checked: true }).waitFor({ timeout: 10000 }),
        ]).then(() => true, () => false);
        result.secondWindow = { followed, state: await readSettings(second) };
        await capture("second-after", `the second window, no reload (${followed ? "followed" : "did not follow within 10 s"})`, second);
      }
      if (flags.reload) {
        await page.reload();
        await groups(page).textSize.getByRole("radio", { checked: true }).waitFor();
        const state = await readSettings(page);
        result.reloaded = { kept: state.textSize === after.textSize && state.width === after.width, state };
        await capture("reloaded", "after a reload");
      }
      return result;
    },
  },

  effect: {
    usage: "[--thread <title>] [--second-window] [--reload]: open the New-thread screen (or the thread with that title) and read the look the stored tweaks call for: the transcript and composer columns' computed maxWidth, the composer's fontSize (New-thread only) and how many tweak <style>s the head holds; waits for the value `getTweaks` stores (5 seconds where it is bb's own look); --second-window reads a window opened before on Settings with no reload, --reload this window after one",
    valued: ["thread"],
    async run({ page, url, capture, cli, newPage, flags }) {
      const tweaks = stored(cli, "ui-tweaks.effect/rpc");
      const scope = await openEffect(page, url, cli, flags.thread);
      const reached = await waitForLook(page, scope, tweaks);
      const shown = await readLook(page, scope);
      await capture("effect", `${scope} with ${tweaks.textSize} text and ${tweaks.width} width stored`);
      const result = { scope, stored: tweaks, expected: { maxWidth: WIDTH[tweaks.width], fontSize: scope === "thread" ? null : FONT[tweaks.textSize] }, reached, shown };
      if (flags["second-window"]) {
        const second = await newPage();
        await openSettings(second, url);
        result.settingsWindow = await readSettings(second);
        await capture("settings-window", "a Settings window beside it", second);
        await page.bringToFront();
      }
      if (flags.reload) {
        await page.reload();
        await page.locator("#root-compose-prompt").or(page.locator("[data-thread-window]")).first().waitFor();
        const again = await waitForLook(page, scope, tweaks);
        result.reloaded = { reached: again, state: await readLook(page, scope) };
        await capture("reloaded", "after a reload");
      }
      return result;
    },
  },

  keyboard: {
    usage: "[--group <Text size|Transcript width>] [--from <radio>] [--key <ArrowLeft|ArrowRight|ArrowUp|ArrowDown>]: on Settings → UI Tweaks focus that radio of that group (default Text size, Large) and press the arrow key (default ArrowRight); both groups' checked radio before and after and the `getTweaks` RPC; a key past the group's end wraps",
    valued: ["group", "from", "key"],
    async run({ page, url, capture, cli, flags }) {
      const name = flags.group ?? "Text size";
      const from = flags.from ?? "Large";
      const key = flags.key ?? "ArrowRight";
      await openSettings(page, url);
      const before = { ...(await readSettings(page)), stored: stored(cli, "ui-tweaks.keyboard/rpc") };
      await capture("before", "open Settings → UI Tweaks");
      const group = page.getByRole("radiogroup", { name, exact: true });
      await group.getByRole("radio", { name: from, exact: true }).focus();
      await page.keyboard.press(key);
      // The choice moves to the neighbouring segment: wait for it to leave the one the key started from.
      await group.getByRole("radio", { name: from, exact: true, checked: false }).waitFor();
      const after = await readSettings(page);
      await capture("after", `${key} from ${from} in ${name}`);
      const want = { textSize: after.textSize.toLowerCase(), width: after.width.toLowerCase() };
      return { group: name, from, key, before, after, stored: await storedAs(cli, "ui-tweaks.keyboard/rpc", want) };
    },
  },

  phone: {
    usage: "--mobile [--wait <ms>]: open the New-thread screen as a touch phone, wait out the plugin's 5-second grace (--wait, default 5000), and read the column's computed maxWidth, the composer's fontSize and how many tweak <style>s the head holds, beside the `getTweaks` RPC; with Narrow stored the column still reads 760px",
    valued: ["wait"],
    async run({ page, url, capture, cli, flags }) {
      const width = page.viewportSize().width;
      if (width > 767) throw new Error(`the phone exclusion needs a touch phone: run with --mobile (this window is ${width}px wide)`);
      const tweaks = stored(cli, "ui-tweaks.phone/rpc");
      await page.goto(url);
      await page.locator("#root-compose-prompt").waitFor();
      await sleep(Number(flags.wait ?? 5000));
      const shown = await readLook(page, "new-thread");
      await capture("phone", `${flags.wait ?? 5000} ms on the New-thread screen with ${tweaks.width} width stored`);
      return { stored: tweaks, shown, applied: shown.columns.some((c) => c !== "760px") || shown.styles > 0 };
    },
  },

  live: {
    usage: "[--text-size <small|medium|large>] [--width <narrow|medium|wide>]: open Settings → UI Tweaks and, in a second window, the New-thread screen; write the partial `setTweaks` over RPC and read what both windows show with no reload: the Settings window's checked radios and the New-thread window's column and font, waiting for each to follow; the `getTweaks` RPC",
    valued: ["text-size", "width"],
    async run({ page, url, capture, cli, newPage, flags }) {
      const set = { ...(flags["text-size"] && { textSize: flags["text-size"] }), ...(flags.width && { width: flags.width }) };
      if (Object.keys(set).length === 0) throw new Error("name --text-size or --width");
      await openSettings(page, url);
      const effect = await newPage();
      const scope = await openEffect(effect, url, cli);
      const was = stored(cli, "ui-tweaks.live/rpc");
      await waitForLook(effect, scope, was);
      const before = { settings: await readSettings(page), effect: await readLook(effect, scope) };
      await capture("before", "Settings window");
      await capture("effect-before", "New-thread window", effect);
      cli("ui-tweaks.live/rpc", "plugin", "rpc", "call", "ui-tweaks", "setTweaks", "--input-file", writeInput(set), "--json");
      const now = stored(cli, "ui-tweaks.live/rpc");
      const label = (v) => v[0].toUpperCase() + v.slice(1);
      const settings = await Promise.all([
        groups(page).textSize.getByRole("radio", { name: label(now.textSize), exact: true, checked: true }).waitFor({ timeout: 15000 }),
        groups(page).width.getByRole("radio", { name: label(now.width), exact: true, checked: true }).waitFor({ timeout: 15000 }),
      ]).then(() => true, () => false);
      await capture("after", `setTweaks ${JSON.stringify(set)} from RPC, no reload`);
      const reached = await waitForLook(effect, scope, now, 15000);
      await capture("effect-after", "New-thread window, no reload", effect);
      return {
        set,
        before,
        after: { settings: await readSettings(page), effect: await readLook(effect, scope) },
        followed: { settings, effect: reached },
        stored: now,
      };
    },
  },
};
