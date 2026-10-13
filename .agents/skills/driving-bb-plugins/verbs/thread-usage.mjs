// Thread Usage's feature verbs: each drives one sub-feature of
// features/thread-usage.md through a thread's header coin and Usage tab, the
// command palette, the Thread usage page or the budget warning, with the roles
// and names the plugin gives its elements, and returns what the page showed
// before and after and what the plugin reported, read back over the
// `thread-usage` CLI.
//
//   drive-bb-plugins thread-usage --run <run> <verb> [args] [--second-window] [--reload] [--mobile] [--label <label>]
//
// The tree is built before a verb runs, as the feature file's recipe does it;
// the verbs only open threads by id and read what the plugin draws.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const lines = (text) => text.split("\n").map((t) => t.trim()).filter(Boolean);

/** A string as a regular expression's source, matched literally. */
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Opens a thread by its id, at the address bb gives it. */
async function openThread(page, url, cli, thread, label) {
  const { thread: t } = JSON.parse(cli(label, "thread", "show", thread, "--json"));
  await page.goto(`${url}projects/${t.projectId}/threads/${t.id}`);
  await page.waitForLoadState("networkidle");
}

/** The header coin: `Usage: <figure>[ with N child thread(s)]`, drawn once the tree has a turn or any usage. */
const chipOf = (page) => page.getByRole("button", { name: /^Usage: / });

/** The coin's name and text, and whether the budget tints it: `text-warning` in its classes or icon. */
async function readChip(chip) {
  return chip.evaluate((el) => ({
    name: el.getAttribute("aria-label"),
    text: el.innerText.trim(),
    tinted: (el.className + el.innerHTML).includes("text-warning"),
  }));
}

/** The Scope radiogroup, which the Usage tab opens with. */
const scopeOf = (page) => page.getByRole("radiogroup", { name: "Scope" });

/**
 * What the Usage tab draws: the Scope radio checked, the headline block (the figure, the "This thread alone" or "With
 * children" note, API and wall time, lines, turns), the token line, the cost by model, the cost-per-turn bars and the
 * Child threads tree, each item's text.
 */
async function readTab(page) {
  await sleep(300);
  const scope = scopeOf(page);
  // The nearest ancestor that holds the whole tab, down to its Child threads.
  const panel = scope.locator("xpath=ancestor::*[.//h3[normalize-space()='Child threads']][1]");
  const text = lines(await panel.innerText());
  const head = text.slice(2, text.indexOf("Tokens"));
  return {
    scope: await scope.getByRole("radio", { checked: true }).evaluate((r) => r.getAttribute("aria-label") ?? r.innerText.trim()),
    headline: head,
    tokens: text[text.indexOf("Tokens") + 1] ?? null,
    models: await panel.getByRole("row").evaluateAll((rs) => rs.slice(1).map((r) => r.innerText.replace(/\s+/g, " ").trim())),
    turns: await panel.getByRole("button", { name: /^Turn \d+: / }).evaluateAll((bs) => bs.map((b) => b.getAttribute("aria-label"))),
    children: await panel.getByRole("treeitem").evaluateAll((ts) => ts.map((t) => ({ text: t.innerText.replace(/\s+/g, " ").trim(), level: t.getAttribute("aria-level") }))),
  };
}

/** The plugin's report of a tree over the CLI, logged in cli.md: its figures and the children it rolled up. */
function report(cli, label, thread, ...flags) {
  const r = JSON.parse(cli(label, "thread-usage", "show", thread, "--json", ...flags));
  return { scope: r.scope, descendants: r.descendants, usd: r.usd, billedUsd: r.billedUsd, headline: r.headline, children: r.children.map((c) => ({ threadId: c.threadId, title: c.title, usd: c.usd })) };
}

/** The plugin's stored `warnAbove`, from its settings over the CLI. */
const warnAbove = (cli) => JSON.parse(cli("thread-usage.budget/config", "plugin", "config", "thread-usage", "--json")).values.warnAbove;

/** The sonner toasts on screen: each one's text. */
const toasts = (page) => page.locator("[data-sonner-toast]").evaluateAll((ts) => ts.map((t) => t.innerText.split("\n").map((s) => s.trim()).filter(Boolean).join(" ")));

/**
 * Opens the Thread usage page from the sidebar navigation and waits for its Project filter. The navigation draws a
 * plugin's button only once it has loaded, so it waits for the built-in Automations and then a few seconds for that
 * button before looking in the More menu.
 */
async function openPage(page, url) {
  await page.goto(url);
  const nav = page.getByRole("navigation", { name: "Primary navigation" });
  const direct = nav.getByRole("button", { name: "Thread usage", exact: true });
  await nav.getByRole("button", { name: "Automations", exact: true }).waitFor();
  // Built-in buttons come first and the plugin's after them: give it a few seconds to be drawn before taking the More menu.
  const drawn = await direct.waitFor({ timeout: 5000 }).then(() => true, () => false);
  let via = "navigation";
  let entry = direct;
  if (!drawn) {
    via = "More menu";
    await nav.getByRole("button", { name: "More", exact: true }).click();
    entry = page.getByRole("menuitem", { name: "Thread usage", exact: true });
  }
  // A button drawn is not always live yet: a click in the first moments can be ignored, so press again until the page opens.
  for (let tries = 0; ; tries++) {
    await entry.first().click();
    if (await page.waitForURL(/plugins\/thread-usage\/usage/, { timeout: 4000 }).then(() => true, () => false)) break;
    if (tries === 4) throw new Error("the navigation entry never opened the page");
  }
  await page.getByRole("combobox", { name: "Project" }).waitFor();
  return via;
}

/** What the page draws: its filters and each ranked tree's text, once the list or its empty line is there. */
async function readPage(page) {
  await sleep(500);
  const main = page.getByRole("main").last();
  const period = main.getByRole("radiogroup", { name: "Period" });
  return {
    url: page.url(),
    project: await main.getByRole("combobox", { name: "Project" }).innerText(),
    period: await period.getByRole("radio", { checked: true }).evaluate((r) => r.getAttribute("aria-label") ?? r.innerText.trim()),
    trees: await main.getByRole("listitem").evaluateAll((items) => items.map((li) => li.innerText.split("\n").map((s) => s.trim()).filter(Boolean).join(" | "))),
  };
}

export const verbs = {
  tab: {
    usage: "<thread> [--this-thread] [--child <title>]: open a thread with child threads (the tab draws Scope and Child threads only then), read its header coin and click it to read the Usage tab (Scope, headline, tokens, cost by model, cost per turn, Child threads); --this-thread presses the `This thread` radio and reads the tab again as `thisThread` (the headline then notes `With children: <figure>`), --child presses that Child threads item and reads where it lands; `thread-usage show --json` for the thread, and with --this-thread --no-children too",
    valued: ["child"],
    async run({ page, url, capture, cli, args, flags }) {
      const thread = args[0];
      await openThread(page, url, cli, thread, "thread-usage.chip/show");
      const chip = chipOf(page);
      await chip.waitFor({ timeout: 30000 });
      const result = { chip: await readChip(chip) };
      await capture("chip", `open ${thread}`);
      await chip.click();
      // The hover card the coin opens after 250 ms stays shut after a click; moving off it keeps the tab uncovered.
      await page.mouse.move(400, 600);
      await scopeOf(page).waitFor();
      await page.getByRole("heading", { name: "Child threads" }).waitFor();
      result.tab = await readTab(page);
      await capture("tab", "click the coin");
      if (flags["this-thread"]) {
        await scopeOf(page).getByRole("radio", { name: "This thread", exact: true }).click();
        await scopeOf(page).getByRole("radio", { name: "This thread", exact: true, checked: true }).waitFor();
        await page.getByText(/With children: /).first().waitFor();
        result.thisThread = await readTab(page);
        await capture("this-thread", "press This thread");
      }
      if (flags.child) {
        await page.getByRole("treeitem", { name: new RegExp(escape(flags.child)) }).first().click();
        await page.waitForURL((u) => !u.pathname.endsWith(thread));
        await page.waitForLoadState("networkidle");
        result.child = { url: page.url() };
        await capture("child", `press ${flags.child} in Child threads`);
      }
      result.stored = report(cli, "thread-usage.tab/cli", thread);
      if (flags["this-thread"]) result.storedAlone = report(cli, "thread-usage.tab/cli", thread, "--no-children");
      return result;
    },
  },

  palette: {
    usage: "<thread>: open a thread with child threads (the Usage tab is read as `tab` reads it) and press Control+K, which opens bb's Quick palette on `Search threads`; press Escape for `Search commands`, pick `Show usage for this thread` and read the Usage tab it opens; `thread-usage show --json`",
    async run({ page, url, capture, cli, args }) {
      const thread = args[0];
      await openThread(page, url, cli, thread, "thread-usage.palette/show");
      await chipOf(page).waitFor({ timeout: 30000 });
      await capture("before", `open ${thread}`);
      await page.keyboard.press("Control+k");
      const palette = page.getByRole("dialog", { name: "Quick palette" });
      const first = palette.getByRole("combobox", { name: "Search threads" });
      await first.waitFor();
      await capture("quick-palette", "Control+K");
      await page.keyboard.press("Escape");
      const commands = palette.getByRole("combobox", { name: "Search commands" });
      await commands.waitFor();
      const option = page.getByRole("option", { name: /Show usage for this thread/ });
      await option.waitFor();
      const listed = (await page.getByRole("option").allInnerTexts()).filter((o) => /usage/i.test(o));
      await capture("commands", "Escape: Search commands");
      await option.click();
      await scopeOf(page).waitFor();
      await page.getByRole("heading", { name: "Child threads" }).waitFor();
      const tab = await readTab(page);
      await capture("after", "pick Show usage for this thread");
      return { palette: { opened: "Search threads", switched: "Search commands", listed }, tab, stored: report(cli, "thread-usage.palette/cli", thread) };
    },
  },

  page: {
    usage: "[--period <7 days|30 days>] [--project <name>]: open the Thread usage page from the sidebar navigation (the More menu where the navigation folds it) and read its Project and Period filters and the ranked trees; --period presses that radio and --project picks that project, each read as `after`; `thread-usage top --json`",
    valued: ["period", "project"],
    async run({ page, url, capture, cli, flags }) {
      const via = await openPage(page, url);
      const main = page.getByRole("main").last();
      await main.getByRole("listitem").first().waitFor();
      const shown = await readPage(page);
      await capture("page", `open Thread usage from the ${via}`);
      const result = { via, shown };
      if (flags.period || flags.project) {
        if (flags.period) {
          const radio = main.getByRole("radiogroup", { name: "Period" }).getByRole("radio", { name: flags.period, exact: true });
          await radio.click();
          await main.getByRole("radiogroup", { name: "Period" }).getByRole("radio", { name: flags.period, exact: true, checked: true }).waitFor();
        }
        if (flags.project) {
          await main.getByRole("combobox", { name: "Project" }).click();
          await page.getByRole("option", { name: flags.project, exact: true }).click();
        }
        await main.getByRole("listitem").first().waitFor();
        result.after = await readPage(page);
        await capture("after", [flags.period && `Period ${flags.period}`, flags.project && `Project ${flags.project}`].filter((a) => a && a !== true).join(", "));
      }
      const args = flags.period === "30 days" ? ["--since", "30d"] : [];
      const top = JSON.parse(cli("thread-usage.page/cli", "thread-usage", "top", "--json", ...args));
      result.stored = top.trees.map((t) => ({ threadId: t.threadId, title: t.title, usd: t.usd, descendants: t.descendants }));
      return result;
    },
  },

  budget: {
    usage: "<thread> <tint|toast> [--warn <usd>]: open the thread and set `warnAbove` over the CLI. `tint` sets it to --warn (default 0.01, under the tree's billed dollars) and reads the coin turn `text-warning` with no toast; `toast` sets it to the billed dollars plus 0.05 (or --warn), waits for the coin to leave the tint, tells the thread \"hello again\", waits for it idle and stops it, and reads the toast `“<title>” crossed $<amount>`, which shows only while a view of that tree is open; `thread-usage show --json` and `plugin config thread-usage --json` for the stored `warnAbove`",
    valued: ["warn"],
    async run({ page, url, capture, cli, args, flags }) {
      const [thread, mode] = args;
      if (mode !== "tint" && mode !== "toast") throw new Error("name tint or toast after the thread");
      await openThread(page, url, cli, thread, "thread-usage.budget/show");
      const chip = chipOf(page).first();
      await chip.waitFor({ timeout: 30000 });
      const tinted = (want) => page.waitForFunction((want) => {
        const b = [...document.querySelectorAll("button")].find((b) => (b.getAttribute("aria-label") ?? "").startsWith("Usage: "));
        return b !== undefined && (b.className + b.innerHTML).includes("text-warning") === want;
      }, want, { timeout: 20000 });
      const setWarn = (value) => cli("thread-usage.budget/config", "plugin", "config", "thread-usage", "set", "warnAbove", String(value));
      const before = { chip: await readChip(chip), toasts: await toasts(page) };
      await capture("before", `open ${thread}`);
      const billed = report(cli, "thread-usage.budget/cli", thread).billedUsd;
      if (mode === "tint") {
        const warn = flags.warn ?? "0.01";
        setWarn(warn);
        await tinted(true);
        // A toast comes only when a tree crosses the line on a turn, not when the line moves under it: let the page settle on none.
        await page.waitForLoadState("networkidle");
        const after = { chip: await readChip(chip), toasts: await toasts(page) };
        await capture("tinted", `warnAbove ${warn} under the tree's ${billed}`);
        return { warnAbove: warn, billedUsd: billed, before, after, stored: { warnAbove: warnAbove(cli) } };
      }
      const warn = flags.warn ?? (billed + 0.05).toFixed(2);
      setWarn(warn);
      await tinted(false);
      await capture("above", `warnAbove ${warn} over the tree's ${billed}`);
      cli("thread-usage.budget/tell", "thread", "tell", thread, "hello again");
      cli("thread-usage.budget/tell", "thread", "wait", thread, "--status", "idle");
      cli("thread-usage.budget/tell", "thread", "stop", thread);
      const toast = page.locator("[data-sonner-toast]").filter({ hasText: /crossed/ });
      await toast.first().waitFor({ timeout: 30000 });
      await tinted(true);
      const after = { chip: await readChip(chip), toasts: await toasts(page) };
      await capture("toast", `tell ${thread} past warnAbove ${warn}`);
      return { warnAbove: warn, billedBefore: billed, before, after, stored: { ...report(cli, "thread-usage.budget/cli", thread), warnAbove: warnAbove(cli) } };
    },
  },
};
