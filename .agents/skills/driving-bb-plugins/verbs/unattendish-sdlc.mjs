// Unattendish's feature verbs: each drives one sub-feature of
// features/unattendish-sdlc.md through the Fleets page, a manager thread's
// Fleet chip and Fleet tab, the Connect… popup or the settings section, with
// the roles and names the plugin gives its elements, and returns what the page
// showed before and after and what the plugin stored, read back over its RPC.
//
//   drive-bb-plugins unattendish-sdlc --run <run> <verb> [args] [--label <label>]
//
// A fleet is registered before a verb runs, as the feature file's recipe does
// it; the verbs only read and act on what the dashboard draws.

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const lines = (text) => text.split("\n").map((t) => t.trim()).filter(Boolean);

/** A plugin RPC method's result, through the harness, logged in cli.md. */
function rpc(cli, label, method) {
  const answer = JSON.parse(cli(label, "plugin", "rpc", "call", "unattendish-sdlc", method, "--json"));
  return answer.result ?? answer;
}

/** A string as a regular expression's source, matched literally. */
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Opens the Fleets page from the sidebar navigation and waits for it to leave Loading: the fleet board, "No fleet is registered" or "Couldn't load your fleets". */
export async function openFleets(page, url) {
  await page.goto(url);
  const nav = page.getByRole("button", { name: "Fleets", exact: true }).first();
  await nav.waitFor({ state: "attached" });
  if (page.viewportSize().width >= 768) await nav.click();
  else {
    // On a phone the sidebar is a drawer, off-canvas until opened, whose buttons never settle for Playwright's click.
    await page.getByRole("button", { name: /^Toggle sidebar/ }).click();
    await page.getByRole("dialog", { name: "Sidebar" }).getByRole("button", { name: "Fleets", exact: true }).evaluate((b) => b.click());
  }
  await page
    .getByRole("region", { name: "Fleet board" })
    .or(page.getByText("No fleet is registered"))
    .or(page.getByRole("alert").filter({ hasText: "Couldn't load your fleets" }))
    .first()
    .waitFor();
  await page.waitForLoadState("networkidle");
  // On a phone the drawer can stay open over the page, its backdrop taking every click until it is closed.
  const backdrop = page.locator("[data-sidebar-mobile-backdrop][data-state=open]");
  if (await backdrop.count()) {
    await page.keyboard.press("Escape");
    await backdrop.waitFor({ state: "detached" });
  }
}

/** The queue's rows, one per list item of the open tab; a row's composer is part of its item. */
const queueRows = (page) => page.getByRole("main").last().getByRole("region", { name: "Queue" }).getByRole("tabpanel").getByRole("listitem");

/**
 * What the Fleets page draws: its state, the title bar's count and refresh pill, each fleet board line (name, whether
 * it is the filter, manager, Status slots, fix and the text of every cell), the fold under it, the queue's tabs, filter
 * chip and rows with their buttons.
 */
export async function readFleets(page) {
  await sleep(300);
  const main = page.getByRole("main").last();
  // The Status slots on the board carry the same "N waiting on you" label as the title bar's count: the count is the one outside the board.
  const counts = await page.locator("[aria-label$=' waiting on you']").evaluateAll((es) => es.filter((e) => !e.closest("[aria-label='Fleet board']")).map((e) => e.getAttribute("aria-label")));
  const pill = page.locator("[aria-label^=\"Couldn't refresh:\"]");
  const board = main.getByRole("region", { name: "Fleet board" });
  const queue = main.getByRole("region", { name: "Queue" });
  const cantLoad = main.getByRole("alert").filter({ hasText: "Couldn't load your fleets" });
  const state = (await main.getByRole("status", { name: "Loading your fleets" }).count())
    ? "loading"
    : (await cantLoad.count())
      ? "cant-load"
      : (await main.getByText("No fleet is registered").count())
        ? "no-fleet"
        : "ready";
  const result = {
    url: page.url(),
    state,
    count: counts[0] ?? null,
    refreshPill: (await pill.count()) ? { name: await pill.first().getAttribute("aria-label"), reload: await pill.first().getByRole("button", { name: "Reload now" }).count() } : null,
    notice: state === "cant-load" ? lines(await cantLoad.first().innerText()) : state === "no-fleet" ? lines(await main.innerText()).filter((l) => l.includes("fleet") || l.includes("/run-fleet")) : null,
  };
  if (state !== "ready") return result;
  result.board = {
    lines: await board.getByRole("listitem").evaluateAll((items) =>
      items.map((li) => {
        const label = (e) => e.getAttribute("aria-label");
        const slot = /^\d+ (blocked|in flight|waiting on you|landed in the last 7 days)$/;
        return {
          name: label(li),
          filter: li.querySelector("button[aria-pressed]")?.getAttribute("aria-pressed") ?? null,
          manager: [...li.querySelectorAll("[aria-label]")].map(label).find((n) => /^(Manager|No manager)/.test(n)) ?? null,
          status: [...li.querySelectorAll("[aria-label]")].map(label).filter((n) => slot.test(n)),
          // The fix: a verb button, a phone's icon button, or the ✕ with no verb; its name is the full sentence.
          fix: [...li.querySelectorAll("button:not([aria-pressed]), [tabindex][aria-label], [role=img][aria-label]")]
            .filter((e) => !/^Open the Fleet tab of /.test(label(e) ?? "") && !slot.test(label(e) ?? "") && !/^(Manager|No manager|GitHub|GitLab|Linear|Jira)/.test(label(e) ?? ""))
            .map((e) => ({ name: label(e), text: e.innerText.trim(), button: e.tagName === "BUTTON" })),
          text: li.innerText.split("\n").map((t) => t.trim()).filter(Boolean),
        };
      }),
    ),
    fold: await board.getByRole("button", { name: /^\d+ (quiet fleets?|more fleets?)$/ }).evaluateAll((bs) => bs.map((b) => ({ text: b.innerText.trim(), expanded: b.getAttribute("aria-expanded") }))),
  };
  const chip = queue.getByRole("button", { name: /^Show every fleet, not only / });
  result.queue = {
    tabs: await queue.getByRole("tab").evaluateAll((ts) => ts.map((t) => ({ name: t.innerText.replace(/\s+/g, " ").trim(), selected: t.getAttribute("aria-selected") === "true" }))),
    filter: (await chip.count()) ? await chip.getAttribute("aria-label") : null,
    panel: await queue.getByRole("tabpanel").getAttribute("aria-label"),
    rows: await queueRows(page).evaluateAll((items) =>
      items.map((li) => ({
        lines: li.innerText.split("\n").map((t) => t.trim()).filter(Boolean),
        buttons: [...li.querySelectorAll("button")].map((b) => b.getAttribute("aria-label") ?? b.innerText.trim()),
        alerts: [...li.querySelectorAll("[role=alert]")].map((a) => a.innerText.trim()),
      })),
    ),
    // A panel with no rows draws a line of its own: "Nothing waits on you", or Sent's "Nothing you sent was seen done in the last hour".
    empty: (await queueRows(page).count()) ? null : lines(await queue.getByRole("tabpanel").innerText()),
  };
  return result;
}

/** The sonner toasts on screen: each one's title, description, whole text and buttons. */
export async function toasts(page) {
  return page.locator("[data-sonner-toast]").evaluateAll((ts) =>
    ts.map((t) => ({
      title: t.querySelector("[data-title]")?.innerText.trim() ?? null,
      description: t.querySelector("[data-description]")?.innerText.trim() ?? null,
      text: t.innerText.split("\n").map((s) => s.trim()).filter(Boolean),
      buttons: [...t.querySelectorAll("button")].map((b) => b.innerText.trim()).filter(Boolean),
    })),
  );
}

/** Opens a thread by its id, at the address bb gives it. */
async function openThread(page, url, cli, thread, label) {
  const { thread: t } = JSON.parse(cli(label, "thread", "show", thread, "--json"));
  await page.goto(`${url}projects/${t.projectId}/threads/${t.id}`);
  await page.waitForLoadState("networkidle");
}

/** The Fleet chip in an open thread's header. */
const chipOf = (page) => page.getByRole("button", { name: /^Fleet( idle$|: )/ });

/** What the Fleet tab draws: each section's heading and lines, and the card at its top. */
export async function readTab(page) {
  await sleep(300);
  const tab = page.getByRole("region", { name: "Polling" }).locator("xpath=..");
  const sections = [];
  for (const region of await tab.locator(":scope > [role=region], :scope > section").all()) {
    const text = lines(await region.innerText());
    sections.push({ heading: text[0], lines: text.slice(1) });
  }
  const card = tab.getByRole("article").first();
  return { card: (await card.count()) ? lines(await card.innerText()) : null, sections };
}

export const verbs = {
  "fleets-page": {
    usage: "[--unfold] [--filter <repo>] [--tab <All|Answer|Grant|Build|Other|Unreadable|Sent>] [--open-tab <repo>]: open Fleets from the sidebar navigation and read it, with the dashboard's `fleets` RPC; --unfold presses the board's \"N quiet fleet(s)\" or \"N more fleets\", --filter presses that fleet's name and --tab a queue tab, each read as `after`; --open-tab presses that fleet's \"Open the Fleet tab of <repo>\" and reads the Fleet tab it lands on (not on a phone, whose board has none)",
    valued: ["filter", "tab", "open-tab"],
    async run({ page, url, capture, cli, flags }) {
      await openFleets(page, url);
      const shown = await readFleets(page);
      await capture("fleets", "open Fleets from the sidebar navigation");
      const stored = rpc(cli, "unattendish.page/rpc", "fleets");
      const result = { shown, stored };
      const board = page.getByRole("region", { name: "Fleet board" });
      const queue = page.getByRole("main").last().getByRole("region", { name: "Queue" });
      if (flags.unfold || flags.filter || flags.tab) {
        if (flags.unfold) await board.getByRole("button", { name: /^\d+ (quiet fleets?|more fleets?)$/ }).first().click();
        if (flags.filter) await board.getByRole("button", { name: flags.filter, exact: true }).click();
        if (flags.tab) await queue.getByRole("tab", { name: new RegExp(`^${escape(flags.tab)} \\d+$`) }).click();
        await capture("after", ["unfold", flags.filter && `filter ${flags.filter}`, flags.tab && `tab ${flags.tab}`].filter((a) => a && a !== true).join(", ") || "unfold");
        result.after = await readFleets(page);
      }
      if (!flags["open-tab"]) return result;
      await board.getByRole("listitem", { name: `Fleet ${flags["open-tab"]}` }).getByRole("button", { name: `Open the Fleet tab of ${flags["open-tab"]}` }).click();
      await page.getByRole("region", { name: "Polling" }).waitFor();
      const tab = await readTab(page);
      await capture("tab", `press the Fleet tab icon on ${flags["open-tab"]}'s line`);
      result.opened = { url: page.url(), tab };
      return result;
    },
  },

  act: {
    usage: "<Answer…|Grant…|Build it|Re-grant> <ref> [<text>] [--fleet <repo>] [--esc] [--wait <row text>]: press an Inbox row's action in the Fleets page's queue, write the text (each `\\n` in it a new line, typed with Shift+Enter; Ctrl+Enter sends; --esc cancels with Escape), and read the row until it shows --wait (default `sent ·`; `not sent` for a refusal, `Not sent:` below 768 px, where it is spelled out under the buttons); the row as the `fleets` RPC stores it",
    valued: ["fleet", "wait"],
    async run({ page, url, capture, cli, args, flags }) {
      const [action, ref, text] = args;
      await openFleets(page, url);
      // The row is the queue's list item that starts with its Ref; its composer opens inside the same item.
      let row = queueRows(page).filter({ hasText: new RegExp(`^${escape(ref)}(\\s|$)`) });
      if (flags.fleet) row = row.filter({ hasText: flags.fleet });
      row = row.first();
      const before = lines(await row.innerText());
      await capture("before", `the row ${ref}`);
      await row.getByRole("button", { name: `${action} ${ref}`, exact: true }).click();
      const box = row.getByRole("textbox", { name: /^Your (answer|grant) for / });
      let composer = null;
      if (action !== "Build it" && action !== "Re-grant") {
        await box.waitFor();
        composer = { box: await box.getAttribute("aria-label"), open: await page.getByRole("textbox", { name: /^Your (answer|grant) for / }).count(), header: lines(await row.innerText()).find((l) => l.startsWith("Your ")) ?? null, sendEnabledEmpty: await row.getByRole("button", { name: "Send", exact: true }).isEnabled() };
        for (const [i, part] of (text ?? "").split("\\n").entries()) {
          if (i > 0) await box.press("Shift+Enter");
          await box.pressSequentially(part);
        }
        await capture("composer", `press ${action} ${ref} and write`);
        if (flags.esc) {
          await box.press("Escape");
          await box.waitFor({ state: "detached" });
          await capture("cancelled", "Escape");
          return { before, composer, after: lines(await row.innerText()), stored: rpc(cli, "unattendish.actions/rpc", "fleets") };
        }
        await box.press("Control+Enter");
      }
      const want = flags.wait ?? "sent ·";
      // A refusal of words stays in the composer as an alert; one of Build it or Re-grant is the "not sent" beside the title.
      for (let i = 0; i < 40 && !(await row.innerText()).includes(want); i++) await sleep(500);
      const after = lines(await row.innerText());
      await capture("after", `send; the row reads ${want}`);
      const refusal = { composer: await row.getByRole("alert").allInnerTexts(), title: await row.locator("[aria-label^='not sent: ']").evaluateAll((es) => es.map((e) => e.getAttribute("aria-label"))) };
      return { before, composer, after, action: after.find((l) => l.includes(want)) ?? null, refusal, stored: rpc(cli, "unattendish.actions/rpc", "fleets") };
    },
  },

  chip: {
    usage: "<thread> [--hover] [--open] [--mobile]: open a manager thread and read its header's Fleet chip; --hover reads the card it opens, --open clicks it and reads the Fleet tab; the `threadFleet` RPC",
    async run({ page, url, capture, cli, args, flags }) {
      await openThread(page, url, cli, args[0], "unattendish.chip/show");
      const chip = chipOf(page);
      await chip.waitFor();
      const result = { name: await chip.getAttribute("aria-label"), text: (await chip.innerText()).trim() };
      await capture("chip", `open ${args[0]}`);
      if (flags.hover) {
        await chip.hover();
        const card = page.getByRole("article").filter({ hasText: "forge" }).last();
        await card.waitFor({ timeout: 3000 }).catch(() => {});
        result.hover = (await card.count()) ? lines(await card.innerText()) : null;
        await capture("hover", "hover the chip");
      }
      if (flags.open) {
        await chip.click();
        await page.getByRole("region", { name: "Polling" }).waitFor();
        result.tab = await readTab(page);
        await capture("tab", "click the chip");
      }
      const answer = JSON.parse(cli("unattendish.chip/rpc", "plugin", "rpc", "call", "unattendish-sdlc", "threadFleet", "--input-file", writeInput({ threadId: args[0] }), "--json"));
      result.stored = answer.result ?? answer;
      return result;
    },
  },

  ledger: {
    usage: "<thread> [--filter <All|Woke|Dropped|Held|Failed reads|Wakes>] [--item <ref>]: open a manager's Fleet tab, open Ledger ▸, press a filter and type an item; what the ledger lists",
    valued: ["filter", "item"],
    async run({ page, url, capture, cli, args, flags }) {
      await openThread(page, url, cli, args[0], "unattendish.tab/show");
      await chipOf(page).click();
      const open = page.getByRole("button", { name: /^Ledger/ });
      await open.click();
      const group = page.getByRole("group", { name: "What was done" });
      await group.waitFor();
      const ledger = () => open.locator("xpath=ancestor::*[@role='region' or self::section][1]");
      const before = lines(await ledger().innerText());
      await capture("ledger", "open Ledger ▸");
      if (flags.filter) {
        await group.getByRole("button", { name: flags.filter, exact: true }).click();
        await group.getByRole("button", { name: flags.filter, exact: true, pressed: true }).waitFor();
      }
      if (flags.item) await page.getByRole("textbox", { name: "Filter by item" }).fill(flags.item);
      await sleep(800);
      const after = lines(await ledger().innerText());
      await capture("filtered", `filter ${flags.filter ?? "All"}${flags.item ? `, item ${flags.item}` : ""}`);
      return { expanded: await open.getAttribute("aria-expanded"), filters: await group.getByRole("button").allInnerTexts(), before, after };
    },
  },

  toast: {
    usage: "<trigger.sh> [--click <button>]: hold the Fleets page open, run the shell script (it gets DBP_HARNESS and DBP_RUN, and makes the change that should toast), and read the toasts that appear; --click presses that toast button and reports where it led",
    valued: ["click"],
    async run({ page, url, capture, args, flags }) {
      await openFleets(page, url);
      await capture("before", "Fleets open, before the trigger");
      execFileSync("bash", [args[0]], { stdio: ["ignore", "inherit", "inherit"] });
      await page.locator("[data-sonner-toast]").first().waitFor({ timeout: 90000 });
      await sleep(500);
      const shown = await toasts(page);
      await capture("toast", `run ${args[0]}`);
      if (!flags.click) return { shown };
      await page.locator("[data-sonner-toast]").getByRole("button", { name: flags.click, exact: true }).first().click();
      await sleep(800);
      const dialog = page.getByRole("dialog");
      const result = { shown, url: page.url(), dialog: (await dialog.count()) ? lines(await dialog.innerText()) : null };
      await capture("clicked", `click ${flags.click}`);
      return result;
    },
  },

  connect: {
    usage: "<button name> [--fleet <repo>] [--service <GitHub|GitLab|Linear|Jira>] [--host <host>] [--owner <owner>] [--account <label>] [--token <token>] [--email <email>] [--from page|settings] [--stop-at account|token]: press a Connect…-type button on the Fleets page (or the settings page): by its accessible name, which on the board is the fleet's full sentence (`other-org/x needs a GitHub account that can read other-org`), or with --fleet by the text on that fleet's board line (`Connect…`, `Renew…`), walk the popup (Add account's service and host, an owner, choose the account radio, Continue, record the page Create token opens, paste the token, Verify and save) and read each step; `fleet status --json` and `settings` after",
    valued: ["fleet", "service", "host", "owner", "account", "token", "email", "from", "stop-at"],
    async run({ page, url, capture, cli, args, flags }) {
      if (flags.from === "settings") {
        await page.goto(url + "settings/plugins/unattendish-sdlc");
        await page.getByRole("region", { name: "Accounts" }).waitFor();
      } else await openFleets(page, url);
      const pressed = flags.fleet
        ? page.getByRole("region", { name: "Fleet board" }).getByRole("listitem", { name: `Fleet ${flags.fleet}` }).getByRole("button").filter({ hasText: args[0] })
        : page.getByRole("button", { name: args[0], exact: true });
      await pressed.first().click();
      const dialog = page.getByRole("dialog");
      await dialog.waitFor();
      const steps = [];
      const step = async (name, action) => {
        await sleep(400);
        steps.push({ step: name, lines: lines(await dialog.innerText()), buttons: await dialog.getByRole("button").allInnerTexts(), radios: await dialog.getByRole("radio").evaluateAll((rs) => rs.map((r) => `${r.getAttribute("aria-label") ?? r.closest("label")?.innerText?.trim() ?? ""}${r.checked || r.getAttribute("aria-checked") === "true" ? " [checked]" : ""}${r.disabled ? " [disabled]" : ""}`)) });
        await capture(name, action);
      };
      await step("opened", `press ${args[0]}`);
      const result = { title: await dialog.getByRole("heading").first().innerText(), steps };
      const done = () => ({ ...result, status: JSON.parse(cli("unattendish.connect/status", "unattendish", "fleet", "status", "--json")), settings: rpc(cli, "unattendish.connect/rpc", "settings") });
      if (flags.service || flags.owner) {
        if (flags.service) await dialog.getByRole("radio", { name: flags.service, exact: true }).check();
        if (flags.host) await dialog.getByRole("textbox", { name: /^(Host|Jira site)$/ }).fill(flags.host);
        if (flags.owner) await dialog.getByLabel("Owner", { exact: true }).fill(flags.owner);
        await dialog.getByRole("button", { name: "Continue" }).click();
        await step("setup", `${flags.service ?? ""} ${flags.host ?? ""} ${flags.owner ?? ""}, Continue`.trim());
      }
      if (flags.account) {
        await dialog.getByRole("radio", { name: new RegExp(`^${escape(flags.account)}`) }).check();
        await dialog.getByRole("button", { name: "Continue" }).click();
        await sleep(400);
        await step("token-step", `choose ${flags.account}, Continue`);
      }
      if (flags["stop-at"] === "account" || flags["stop-at"] === "token") return done();
      const create = dialog.getByRole("button", { name: "Create token" });
      if (await create.count()) {
        // The page it opens is on the service, which a run never reaches: record the address it asked for.
        const asked = page.context().waitForEvent("request", { predicate: (r) => !r.url().startsWith(url), timeout: 5000 }).catch(() => null);
        const [opened] = await Promise.all([page.context().waitForEvent("page", { timeout: 5000 }).catch(() => null), create.click()]);
        result.createTokenUrl = (await asked)?.url() ?? null;
        if (opened) await opened.close();
      }
      const paste = dialog.getByRole("radio", { name: /^Paste/ });
      if (await paste.count()) await paste.check();
      if (flags.email) await dialog.getByLabel("Email", { exact: true }).fill(flags.email);
      await dialog.getByLabel(/^(Token|API key|API token)$/).fill(flags.token ?? "");
      await dialog.getByRole("button", { name: "Verify and save" }).click();
      await dialog.getByRole("button", { name: /^(Done|Close|Check again|Try again|Use another credential|Add as .*)$/ }).first().waitFor({ timeout: 20000 });
      await step("result", "Verify and save");
      const finish = dialog.getByRole("button", { name: /^(Done|Close)$/ });
      if (await finish.count()) await finish.first().click();
      return done();
    },
  },

  settings: {
    usage: "[--interval <repo> <seconds|default>] [--remove <button name>] [--keep] [--default <account label>]: open Settings → Unattendish and read Accounts and Poll interval; --interval sets one fleet's interval (default: the Default button), --remove presses a Remove button and confirms it (--keep keeps it), --default presses Make <label> the default; the `settings` RPC and `fleet status --json` after",
    valued: ["interval", "remove", "default"],
    async run({ page, url, capture, cli, args, flags }) {
      await page.goto(url + "settings/plugins/unattendish-sdlc");
      const accounts = page.getByRole("region", { name: "Accounts" });
      await accounts.waitFor();
      await sleep(500);
      const read = async () => ({
        accounts: await accounts.getByRole("listitem").filter({ has: page.getByRole("list", { name: /^Credentials of / }) }).evaluateAll((ls) => ls.map((l) => ({ name: l.getAttribute("aria-label"), lines: l.innerText.split("\n").map((s) => s.trim()).filter(Boolean) }))),
        intervals: await page.getByRole("region", { name: "Poll interval" }).getByRole("textbox").evaluateAll((ts) => ts.map((t) => `${t.getAttribute("aria-label")}: ${t.value}`)),
        alerts: await page.getByRole("alert").allInnerTexts(),
        statuses: await page.getByRole("region", { name: "Accounts" }).getByRole("status").allInnerTexts(),
      });
      const before = await read();
      await capture("settings", "open Settings → Unattendish");
      let did = null;
      if (flags.interval) {
        const repo = flags.interval;
        const value = args[0];
        if (value === "default") await page.getByRole("button", { name: `Reset the poll interval of ${repo} to the default`, exact: true }).click();
        else {
          await page.getByRole("textbox", { name: `Poll interval of ${repo}, in seconds` }).fill(value);
          const set = page.getByRole("button", { name: `Set the poll interval of ${repo}`, exact: true });
          did = { setEnabled: await set.isEnabled() };
          if (did.setEnabled) await set.click();
        }
        did = { ...did, action: `interval ${repo} ${value}` };
      }
      if (flags.default) {
        await page.getByRole("button", { name: `Make ${flags.default} the default`, exact: true }).click();
        did = { action: `make ${flags.default} the default` };
      }
      if (flags.remove) {
        await page.getByRole("button", { name: flags.remove, exact: true }).click();
        await sleep(300);
        const confirm = page.getByRole("button", { name: /^Confirm removing / });
        did = { action: flags.remove, confirmAsked: (await confirm.count()) ? await confirm.first().getAttribute("aria-label") ?? await confirm.first().innerText() : null };
        await capture("confirm", `press ${flags.remove}`);
        if (flags.keep) await page.getByRole("button", { name: "Keep", exact: true }).first().click();
        else if (await confirm.count()) await confirm.first().click();
      }
      if (!did) return { shown: before, stored: rpc(cli, "unattendish.settings/rpc", "settings") };
      await sleep(1200);
      const after = await read();
      await capture("after", did.action);
      return { before, did, after, stored: rpc(cli, "unattendish.settings/rpc", "settings"), status: JSON.parse(cli("unattendish.settings/status", "unattendish", "fleet", "status", "--json")) };
    },
  },
};

/** Writes an RPC input to a file beside the run's UI evidence and returns its path. */
function writeInput(value) {
  const file = `${process.env.DBP_UI}/input-${process.pid}-${Date.now()}.json`;
  writeFileSync(file, JSON.stringify(value));
  return file;
}
