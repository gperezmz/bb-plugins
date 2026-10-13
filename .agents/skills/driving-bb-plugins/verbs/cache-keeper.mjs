// Cache Keeper's feature verbs: each drives one sub-feature of
// features/cache-keeper.md through a thread's composer chip and banner, the
// Cache Keeper page or the settings section, with the roles and names the
// plugin gives its elements, and returns what the page showed before and after
// and what the plugin stored, read back over `cache-keeper status --json` and
// its RPC.
//
//   drive-bb-plugins cache-keeper --run <run> <verb> [args] [--second-window] [--reload] [--mobile] [--label <label>]
//
// The threads, their switches and the drive clock are set before a verb runs,
// as the feature file's recipe does it; the verbs open a thread by id and read
// or press what the plugin draws. The chip and banner refresh on the plugin's
// change signal, so run `cache-keeper drive now` before a verb that must see an
// advance.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const lines = (text) => text.split("\n").map((t) => t.trim()).filter(Boolean);

/** Opens a thread by its id, at the address bb gives it. */
async function openThread(page, url, cli, thread, label) {
  const { thread: t } = JSON.parse(cli(label, "thread", "show", thread, "--json"));
  await page.goto(`${url}projects/${t.projectId}/threads/${t.id}`);
  await page.waitForLoadState("networkidle");
}

/** The composer chip: `Cache Keeper: <sentence>`, its text `≥ <line>`, `<n>m`, `paused` or `no line`, shown on every Claude Code thread. */
const chipOf = (page) => page.getByRole("button", { name: /^Cache Keeper:/ });

/** The chip's name and text. */
async function readChip(page) {
  const chip = chipOf(page);
  return { name: await chip.getAttribute("aria-label"), text: (await chip.innerText()).trim() };
}

/** The switch of the popover by its name. */
const switchOf = (page, name) => page.getByRole("switch", { name, exact: true });

/** The popover's frame: the nearest ancestor of a switch that holds both switches, a dialog on a phone. */
const popoverOf = (page) => switchOf(page, "Compact when idle").locator("xpath=ancestor::*[count(.//*[@role='switch']) >= 2][1]");

/** Opens the popover from the chip and waits for its switches. */
async function openPopover(page) {
  await chipOf(page).waitFor({ timeout: 30000 });
  await chipOf(page).click();
  await switchOf(page, "Compact when idle").waitFor();
  await switchOf(page, "Keep warm while waiting").waitFor();
  // The chip's hover card would sit over the popover in a capture: move the pointer off both.
  await page.mouse.move(5, 5);
  await sleep(300);
}

/**
 * What the popover draws: each switch's state, the Compaction line slider (value text, and the handle button, which is
 * named for the size alone, `210k`, no `≥`; none until the first turn has ended), and its lines of text.
 */
async function readPopover(page) {
  const slider = page.getByRole("slider", { name: "Compaction line" });
  const handle = page.getByRole("button", { name: /^(≥ )?\d+(\.\d+)?[kM]$/ });
  const size = page.getByRole("textbox", { name: "Compaction line size" });
  return {
    compactWhenIdle: (await switchOf(page, "Compact when idle").getAttribute("aria-checked")) === "true",
    keepWarmWhileWaiting: (await switchOf(page, "Keep warm while waiting").getAttribute("aria-checked")) === "true",
    slider: (await slider.count()) ? await slider.getAttribute("aria-valuetext") : null,
    handle: (await handle.count()) ? (await handle.first().innerText()).trim() : null,
    size: (await size.count()) ? await size.inputValue() : null,
    lines: lines(await popoverOf(page).innerText()),
  };
}

/** What the plugin stored for a thread: `cache-keeper status --json`, the fields a drive reads. */
function status(cli, label, thread) {
  const s = JSON.parse(cli(label, "cache-keeper", "status", thread, "--json"));
  const { compactOn, line, context, deadline, compactionDue, compactSkipped, compactedAt, canCompactNow, waiting, keptWarm, warmPlanned, warmSkipped, statusText } = s;
  return { compactOn, line, context, deadline, compactionDue, compactSkipped, compactedAt, canCompactNow, waiting, keptWarm, warmPlanned, warmSkipped, statusText };
}

/** A plugin RPC method's result, through the harness, logged in cli.md. */
function rpc(cli, label, method) {
  const answer = JSON.parse(cli(label, "plugin", "rpc", "call", "cache-keeper", method, "--json"));
  return answer.result ?? answer;
}

/**
 * The banner above the composer: a `status` with `Compacting in Nm, before the cache goes cold`, `Skip` and `Compact
 * now`, or after a Skip `Skipped until this thread next runs` and `Undo`.
 */
const bannerOf = (page, text) => page.getByRole("status").filter({ hasText: text });

/** Which banner is drawn, with its text and buttons; null when there is none. */
async function readBanner(page) {
  const banner = bannerOf(page, /Compacting in|Skipped until/);
  if ((await banner.count()) === 0) return null;
  return { lines: lines(await banner.first().innerText()), buttons: await banner.first().getByRole("button").allInnerTexts() };
}

/**
 * Opens the Cache Keeper page from the sidebar navigation and waits for its heading. The navigation draws a plugin's
 * button only once it has loaded, so it waits for the built-in Automations and then a few seconds for that button
 * before looking in the More menu.
 */
async function openPage(page, url) {
  await page.goto(url);
  const nav = page.getByRole("navigation", { name: "Primary navigation" });
  const direct = nav.getByRole("button", { name: "Cache Keeper", exact: true });
  await nav.getByRole("button", { name: "Automations", exact: true }).waitFor();
  // Built-in buttons come first and the plugin's after them: give it a few seconds to be drawn before taking the More menu.
  const drawn = await direct.waitFor({ timeout: 5000 }).then(() => true, () => false);
  let via = "navigation";
  let entry = direct;
  if (!drawn) {
    via = "More menu";
    await nav.getByRole("button", { name: "More", exact: true }).click();
    entry = page.getByRole("menuitem", { name: "Cache Keeper", exact: true });
  }
  // A button drawn is not always live yet: a click in the first moments can be ignored, so press again until the page opens.
  for (let tries = 0; ; tries++) {
    await entry.first().click();
    if (await page.waitForURL(/plugins\/cache-keeper\//, { timeout: 4000 }).then(() => true, () => false)) break;
    if (tries === 4) throw new Error("the navigation entry never opened the page");
  }
  await page.getByRole("heading", { name: "Cache Keeper", level: 1 }).waitFor();
  return via;
}

export const verbs = {
  chip: {
    usage: "<thread> [--switch <Compact when idle|Keep warm while waiting>] [--handle] [--size <size>]: open a thread and read its composer chip, then click it and read the popover (both switches, the Compaction line slider and its handle button, named for the size alone); --switch presses that switch and waits for it to flip, --handle presses the handle button and reads the `Compaction line size` textbox it becomes, --size types a size in it and presses Enter, each read as `after`; `cache-keeper status --json` before and after",
    valued: ["switch", "size"],
    async run({ page, url, capture, cli, args, flags }) {
      const thread = args[0];
      await openThread(page, url, cli, thread, "cache-keeper.chip/show");
      await chipOf(page).waitFor({ timeout: 30000 });
      const result = { chip: await readChip(page) };
      await capture("chip", `open ${thread}`);
      await openPopover(page);
      const before = await readPopover(page);
      result.before = { popover: before, stored: status(cli, "cache-keeper.chip/cli", thread) };
      await capture("popover", "click the chip");
      if (!flags.switch && !flags.handle && !flags.size) return result;
      if (flags.switch) {
        const sw = switchOf(page, flags.switch);
        const was = await sw.getAttribute("aria-checked");
        await sw.click();
        await page.getByRole("switch", { name: flags.switch, exact: true, checked: was !== "true" }).waitFor();
      }
      if (flags.handle || flags.size) {
        await page.getByRole("button", { name: /^(≥ )?\d+(\.\d+)?[kM]$/ }).first().click();
        await page.getByRole("textbox", { name: "Compaction line size" }).waitFor();
        if (flags.size) {
          await page.getByRole("textbox", { name: "Compaction line size" }).fill(flags.size);
          await page.keyboard.press("Enter");
          await page.getByRole("textbox", { name: "Compaction line size" }).waitFor({ state: "detached" });
        }
      }
      // The chip and popover follow the plugin's change signal: wait for the stored state to be on the page.
      await page.waitForLoadState("networkidle");
      result.after = { chip: await readChip(page), popover: await readPopover(page), stored: status(cli, "cache-keeper.chip/cli", thread) };
      await capture("after", [flags.switch && `press ${flags.switch}`, flags.handle && "press the handle", flags.size && `type ${flags.size}`].filter((a) => a && a !== true).join(", "));
      return result;
    },
  },

  banner: {
    usage: "<thread> [--skip] [--undo]: open a thread with a compaction due and read the banner above the composer (`Compacting in Nm, before the cache goes cold`, Skip, Compact now) and the chip; --skip presses Skip and reads `Skipped until this thread next runs` with Undo, --undo (after --skip) presses Undo and reads the banner back; `cache-keeper status --json` at each step",
    async run({ page, url, capture, cli, args, flags }) {
      const thread = args[0];
      await openThread(page, url, cli, thread, "cache-keeper.banner/show");
      const due = bannerOf(page, "Compacting in");
      await due.waitFor({ timeout: 30000 });
      const result = { shown: { chip: await readChip(page), banner: await readBanner(page) }, stored: status(cli, "cache-keeper.banner/cli", thread) };
      await capture("banner", `open ${thread}`);
      if (flags.skip || flags.undo) {
        const skipped = bannerOf(page, "Skipped until this thread next runs");
        await due.getByRole("button", { name: "Skip", exact: true }).click();
        await skipped.waitFor();
        result.skipped = { chip: await readChip(page), banner: await readBanner(page), stored: status(cli, "cache-keeper.banner/cli", thread) };
        await capture("skipped", "press Skip");
        if (flags.undo) {
          await skipped.getByRole("button", { name: "Undo", exact: true }).click();
          await due.waitFor();
          result.undone = { chip: await readChip(page), banner: await readBanner(page), stored: status(cli, "cache-keeper.banner/cli", thread) };
          await capture("undone", "press Undo");
        }
      }
      return result;
    },
  },

  page: {
    usage: "[--second-window]: open the Cache Keeper page from the sidebar navigation (the More menu where the navigation folds it) and read its h1, each h2 section (`Compact when idle`, `Waiting on background work`, `Recent`, `Last 30 days`) with its lines; the `overview` RPC; --second-window reads a page opened before with no reload",
    async run({ page, url, capture, cli, newPage, flags }) {
      const read = async (on) => {
        await sleep(500);
        const main = on.getByRole("main").last();
        const sections = [];
        for (const h of await main.getByRole("heading", { level: 2 }).all()) {
          const section = h.locator("xpath=..");
          sections.push({ heading: (await h.innerText()).trim(), lines: lines(await section.innerText()).slice(1) });
        }
        return { url: on.url(), h1: await main.getByRole("heading", { level: 1 }).innerText(), sections };
      };
      let second = null;
      if (flags["second-window"]) {
        second = await newPage();
        await openPage(second, url);
        await page.bringToFront();
      }
      const via = await openPage(page, url);
      for (const h of ["Compact when idle", "Waiting on background work", "Recent", "Last 30 days"]) await page.getByRole("heading", { name: h, level: 2 }).waitFor();
      const shown = await read(page);
      await capture("page", `open Cache Keeper from the ${via}`);
      const o = rpc(cli, "cache-keeper.page/rpc", "overview");
      const result = {
        via,
        shown,
        stored: {
          switchedOn: o.switchedOn.map((t) => t.title),
          waiting: o.waiting.map((t) => t.title),
          recent: o.recent.map((r) => ({ kind: r.kind, title: r.title, contextBefore: r.record?.contextBefore })),
          totals: o.totals,
        },
      };
      if (second !== null) {
        await second.bringToFront();
        result.secondWindow = await read(second);
        await capture("second-after", "a second window, no reload", second);
      }
      return result;
    },
  },

  settings: {
    usage: "[--keep-warm <every|switched|never>]: open Settings → Cache Keeper and read its sections (`Waiting threads` with `Keep caches warm while waiting`, `Stalled tasks`, `Prices`, `Agent tools`), each combobox and switch; --keep-warm picks that option and reads the page again as `after`; the `settings` RPC",
    valued: ["keep-warm"],
    async run({ page, url, capture, cli, flags }) {
      await page.goto(`${url}settings/plugins/cache-keeper`);
      const warm = page.getByRole("combobox", { name: "Keep caches warm while waiting" });
      await warm.waitFor();
      const read = async () => {
        await sleep(500);
        const controls = await page.evaluate(() => {
          // An element's accessible name: aria-label, else aria-labelledby, else its <label>.
          const nameOf = (el) =>
            el.getAttribute("aria-label") ||
            (el.getAttribute("aria-labelledby") ?? "").split(" ").map((id) => document.getElementById(id)?.textContent.trim()).filter(Boolean).join(" ") ||
            el.labels?.[0]?.textContent.trim() ||
            null;
          return {
            comboboxes: [...document.querySelectorAll("select, [role=combobox]")].map((c) => `${nameOf(c)}: ${c.selectedOptions?.[0]?.textContent.trim() ?? c.innerText.trim()}`),
            switches: [...document.querySelectorAll("[role=switch]")].map((s) => `${nameOf(s)}: ${s.getAttribute("aria-checked")}`),
          };
        });
        return {
          sections: await Promise.all(["Waiting threads", "Stalled tasks", "Prices", "Agent tools"].map(async (t) => ((await page.getByText(t, { exact: true }).count()) > 0 ? t : `${t} (missing)`))),
          ...controls,
        };
      };
      const result = { shown: await read(), stored: rpc(cli, "cache-keeper.settings/rpc", "settings") };
      await capture("settings", "open Settings → Cache Keeper");
      if (flags["keep-warm"]) {
        // A native select: choose the option by its value.
        await warm.selectOption(flags["keep-warm"]);
        await sleep(800);
        result.after = await read();
        result.stored = rpc(cli, "cache-keeper.settings/rpc", "settings");
        await capture("after", `Keep caches warm while waiting: ${flags["keep-warm"]}`);
      }
      return result;
    },
  },

  "keep-warm": {
    usage: "<thread>: open a thread inside a tree that is waiting on background work, click the chip and read the popover's `Keep warm while waiting` switch (checked where the tree is kept warm) and its lines; `cache-keeper status --json` (`keptWarm`, `warmPlanned`, `waiting`)",
    async run({ page, url, capture, cli, args }) {
      const thread = args[0];
      await openThread(page, url, cli, thread, "cache-keeper.keep-warm/show");
      await chipOf(page).waitFor({ timeout: 30000 });
      const chip = await readChip(page);
      await capture("chip", `open ${thread}`);
      await openPopover(page);
      const popover = await readPopover(page);
      await capture("popover", "click the chip");
      return { chip, popover, stored: status(cli, "cache-keeper.keep-warm/cli", thread) };
    },
  },

  rows: {
    usage: "<timer|flame> [--wait <ms>]: open the web UI and wait (--wait, default 45000; the glyphs refresh every 20 s) for a row of bb's built-in thread list to carry that glyph: the timer `Cache Keeper: compacting before the cache goes cold`, the flame `Cache Keeper: keeping the cache warm while it waits`; every glyph drawn, by name. Thread Glance's list draws none, so start the run without it",
    valued: ["wait"],
    async run({ page, url, capture, args, flags }) {
      const names = { timer: "Cache Keeper: compacting before the cache goes cold", flame: "Cache Keeper: keeping the cache warm while it waits" };
      const name = names[args[0]];
      if (name === undefined) throw new Error("rows takes timer or flame");
      await page.goto(url);
      await page.getByRole("img", { name, exact: true }).first().waitFor({ timeout: Number(flags.wait ?? 45000) });
      const glyphs = await page.getByRole("img", { name: /^Cache Keeper: / }).evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
      await capture("rows", `wait for the ${args[0]} on a row`);
      return { glyphs };
    },
  },
};
