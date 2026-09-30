// Runs a drive against the throwaway bb's web UI in headless Chromium.
// drive-bb-plugins calls it in one of two modes:
//
//   browser.mjs steps <steps.mjs>                  (drive-bb-plugins ui)
//   browser.mjs verb <verbs.mjs> <verb> [args]     (drive-bb-plugins <plugin> <verb>)
//
// It reads DBP_URL, DBP_PLAYWRIGHT, CHROMIUM_PATH, DBP_HARNESS and DBP_RUN,
// and DBP_OUT and DBP_MOBILE for steps, DBP_UI for a verb. A steps module's
// default export gets { page, url, capture } after the page has loaded url.
// A verbs module exports `verbs`, each { usage, valued?, run(ctx) }: valued
// names the --flags that take a value; run gets
// { page, url, capture, newPage, cli, args, flags } on a page that has loaded
// nothing, and returns what it saw, which is printed as JSON.
// capture(name, action) writes <n>-<name>.aria.yml (the page's ARIA snapshot)
// and <n>-<name>.png into the evidence directory, and appends the action it
// follows to actions.md there. Page errors and console errors land in
// console.log.
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const { DBP_URL: url, DBP_PLAYWRIGHT, CHROMIUM_PATH, DBP_HARNESS, DBP_RUN } = process.env;
const { chromium } = createRequire(import.meta.url)(DBP_PLAYWRIGHT);
const [mode, modulePath, ...rest] = process.argv.slice(2);
const log = mode === "verb" ? (line) => console.error(line) : (line) => console.log(line);

/** Splits a verb's arguments into positionals and --flags; a flag in `valued` takes the next argument. */
function parseArgs(argv, valued) {
  const args = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) args.push(a);
    else if (valued.includes(a.slice(2))) flags[a.slice(2)] = argv[++i];
    else flags[a.slice(2)] = true;
  }
  return { args, flags };
}

let out;
let mobile;
let verb;
let parsed = { args: [], flags: {} };
if (mode === "steps") {
  out = process.env.DBP_OUT;
  mobile = Boolean(process.env.DBP_MOBILE);
} else if (mode === "verb") {
  const { verbs } = await import(pathToFileURL(modulePath).href);
  const name = rest[0];
  verb = verbs[name];
  if (verb === undefined) {
    console.error(`usage: drive-bb-plugins <plugin> --run <run> <verb> [args] [--second-window] [--reload] [--mobile] [--label <label>]\n`);
    for (const [n, v] of Object.entries(verbs)) console.error(`  ${n} ${v.usage}`);
    process.exit(name === undefined ? 0 : 2);
  }
  parsed = parseArgs(rest.slice(1), ["label", ...(verb.valued ?? [])]);
  mobile = Boolean(parsed.flags.mobile);
  const base = parsed.flags.label ?? `${modulePath.split("/").pop().replace(/\.mjs$/, "")}.${name}`;
  let label = base;
  for (let n = 2; existsSync(join(process.env.DBP_UI, label)); n++) label = `${base}-${n}`;
  out = join(process.env.DBP_UI, label);
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "verb.txt"), `${[name, ...rest.slice(1)].join(" ")}\n`);
  log(`evidence ${out}`);
} else {
  console.error("usage: browser.mjs steps <steps.mjs> | verb <verbs.mjs> <verb> [args]");
  process.exit(2);
}

const browser = await chromium.launch({ executablePath: CHROMIUM_PATH || undefined });
const context = await browser.newContext(
  mobile
    ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }
    : { viewport: { width: 1440, height: 900 } },
);

let pages = 0;
/** A new page (a window of its own on the same browser profile), its errors logged. */
async function newPage() {
  const page = await context.newPage();
  const tag = pages++ === 0 ? "" : ` [window ${pages}]`;
  page.on("pageerror", (e) => appendFileSync(join(out, "console.log"), `pageerror${tag} ${e.message}\n`));
  page.on("console", (m) => m.type() === "error" && appendFileSync(join(out, "console.log"), `console${tag} ${m.text()}\n`));
  return page;
}
const page = await newPage();

let n = 0;
async function capture(name, action = "", on = page) {
  const base = `${String(++n).padStart(2, "0")}-${name}`;
  writeFileSync(join(out, `${base}.aria.yml`), await on.locator("body").ariaSnapshot());
  await on.screenshot({ path: join(out, `${base}.png`) });
  appendFileSync(join(out, "actions.md"), `- ${base}: ${action || "(state)"} — ${on.url()}\n`);
  log(`captured ${base}`);
}

/**
 * Runs `bb <args>` against the run through the harness, logged in cli.md; its
 * stdout, however long: execFileSync's default buffer of 1 MiB fails a
 * `thread list --json` of several hundred threads.
 */
function cli(label, ...args) {
  return execFileSync(DBP_HARNESS, ["bb", "--run", DBP_RUN, label, "--", ...args], { encoding: "utf8", maxBuffer: Infinity, stdio: ["ignore", "pipe", "pipe"] }).trim();
}

let code = 0;
try {
  if (mode === "steps") {
    const steps = (await import(pathToFileURL(modulePath).href)).default;
    await page.goto(url);
    await steps({ page, url, capture });
  } else {
    const result = await verb.run({ page, url, capture, newPage, cli, ...parsed });
    writeFileSync(join(out, "result.json"), `${JSON.stringify(result, null, 2)}\n`);
    console.log(JSON.stringify(result, null, 2));
  }
} catch (e) {
  code = 1;
  console.error(e);
  await capture("failure", String(e.message).split("\n")[0]).catch(() => {});
} finally {
  await browser.close();
}
process.exit(code);
