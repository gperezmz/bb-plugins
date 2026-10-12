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

/** Opens the Fleets page from the sidebar navigation and waits for its first section. */
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
  await page.getByRole("heading", { name: /^Waits on you/, level: 2 }).waitFor();
  await page.waitForLoadState("networkidle");
}

/** What the Fleets page draws: the header count, each section, every Inbox row's cells, each card and Recently landed. */
export async function readFleets(page) {
  await sleep(300);
  const main = page.getByRole("main").last();
  const count = main.locator("[aria-label$=' waiting on you']");
  // A table on a desktop, its rows as cells; a stacked list on a phone, its items as lines.
  const inbox = main.getByRole("region", { name: /^Waits on you/ });
  const rows = (await inbox.getByRole("table").count())
    ? await inbox.getByRole("row").evaluateAll((rs) => rs.slice(1).map((r) => [...r.querySelectorAll("td,[role=cell]")].map((c) => c.innerText.trim())))
    : await inbox.getByRole("listitem").evaluateAll((ls) => ls.map((l) => l.innerText.split("\n").map((t) => t.trim()).filter(Boolean)));
  const cards = [];
  for (const card of await main.getByRole("article").all()) {
    cards.push({ name: await card.getAttribute("aria-label"), lines: lines(await card.innerText()), buttons: await card.getByRole("button").evaluateAll((bs) => bs.map((b) => b.getAttribute("aria-label") ?? b.innerText.trim())) });
  }
  const list = async (name) => ((await main.getByRole("list", { name }).count()) ? lines(await main.getByRole("list", { name }).innerText()) : null);
  return {
    url: page.url(),
    count: (await count.count()) ? await count.first().getAttribute("aria-label") : null,
    sections: await main.getByRole("heading", { level: 2 }).allInnerTexts(),
    needsAnAccount: await list("Needs an account"),
    recentlySent: await list("Recently sent"),
    rows,
    cards,
    landed: (await main.getByRole("region", { name: /^Recently landed/ }).count()) ? lines(await main.getByRole("region", { name: /^Recently landed/ }).innerText()).slice(1) : null,
  };
}

/** The sonner toasts on screen: each one's text and buttons. */
export async function toasts(page) {
  return page.locator("[data-sonner-toast]").evaluateAll((ts) =>
    ts.map((t) => ({ text: t.innerText.split("\n").map((s) => s.trim()).filter(Boolean), buttons: [...t.querySelectorAll("button")].map((b) => b.innerText.trim()).filter(Boolean) })),
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
    usage: "[--open-tab <repo>]: open Fleets from the sidebar navigation and read it, with the dashboard's `fleets` RPC; --open-tab clicks that card's `manager ↗` and reads the Fleet tab it lands on",
    valued: ["open-tab"],
    async run({ page, url, capture, cli, flags }) {
      await openFleets(page, url);
      const shown = await readFleets(page);
      await capture("fleets", "open Fleets from the sidebar navigation");
      const stored = rpc(cli, "unattendish.page/rpc", "fleets");
      if (!flags["open-tab"]) return { shown, stored };
      await page.getByRole("article", { name: `Fleet ${flags["open-tab"]}` }).getByRole("button", { name: `Open the Fleet tab of ${flags["open-tab"]}` }).click();
      await page.getByRole("region", { name: "Polling" }).waitFor();
      const tab = await readTab(page);
      await capture("tab", `click manager ↗ on ${flags["open-tab"]}'s card`);
      return { shown, stored, opened: { url: page.url(), tab } };
    },
  },

  act: {
    usage: "<Answer…|Grant…|Build it|Re-grant> <ref> [<text>] [--fleet <repo>] [--esc] [--wait <cell text>]: press an Inbox row's action on the Fleets page, write the text (each `\\n` in it a new line, typed with Shift+Enter; Ctrl+Enter sends; --esc cancels with Escape), and read the row's Action cell until it reads --wait (default `sent`); the row as the `fleets` RPC stores it",
    valued: ["fleet", "wait"],
    async run({ page, url, capture, cli, args, flags }) {
      const [action, ref, text] = args;
      await openFleets(page, url);
      // The row is found by its Ref cell, which stays when the action button turns into its state; the composer's row is left out.
      let row = page.getByRole("main").last().getByRole("row").filter({ has: page.getByRole("cell", { name: new RegExp(`^${ref.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} `) }) }).filter({ hasNotText: "Ctrl+Enter" });
      if (flags.fleet) row = row.filter({ hasText: flags.fleet });
      row = row.first();
      const before = lines(await row.innerText());
      await capture("before", `the row ${ref}`);
      await row.getByRole("button", { name: `${action} ${ref}`, exact: true }).click();
      // The composer opens in a row of its own, straight after the row it answers.
      const box = row.locator("xpath=following-sibling::*[1]").getByRole("textbox", { name: /^Your (answer|grant) for / });
      let composer = null;
      if (action !== "Build it") {
        await box.waitFor();
        composer = { box: await box.getAttribute("aria-label"), open: await page.getByRole("textbox", { name: /^Your (answer|grant) for / }).count(), sendEnabledEmpty: await row.locator("xpath=following-sibling::*[1]").getByRole("button", { name: "Send" }).isEnabled() };
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
      const want = flags.wait ?? "sent";
      const cell = row.getByRole("cell").last();
      for (let i = 0; i < 40 && !(await row.innerText()).includes(want); i++) await sleep(500);
      const after = lines(await row.innerText());
      await capture("after", `send; the Action cell reads ${want}`);
      return { before, composer, after, actionCell: await cell.innerText(), stored: rpc(cli, "unattendish.actions/rpc", "fleets") };
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
    usage: "<button name> [--service <GitHub|GitLab|Linear|Jira>] [--host <host>] [--owner <owner>] [--account <label>] [--token <token>] [--email <email>] [--from page|settings] [--stop-at account|token]: press a Connect…-type button on the Fleets page (or the settings page), walk the popup (Add account's service and host, an owner, choose the account radio, Continue, record the page Create token opens, paste the token, Verify and save) and read each step; `fleet status --json` and `settings` after",
    valued: ["service", "host", "owner", "account", "token", "email", "from", "stop-at"],
    async run({ page, url, capture, cli, args, flags }) {
      if (flags.from === "settings") {
        await page.goto(url + "settings/plugins/unattendish-sdlc");
        await page.getByRole("region", { name: "Accounts" }).waitFor();
      } else await openFleets(page, url);
      await page.getByRole("button", { name: args[0], exact: true }).first().click();
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
        await dialog.getByRole("radio", { name: new RegExp(`^${flags.account.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`) }).check();
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
