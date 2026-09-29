// Runs one drive's steps against the throwaway bb's web UI in headless
// Chromium. drive-bb-plugins ui calls it; it reads DBP_URL, DBP_OUT,
// DBP_PLAYWRIGHT, DBP_MOBILE and CHROMIUM_PATH, and the steps module given as
// its argument, whose default export gets { page, url, capture }.
// capture(name, action) writes <n>-<name>.aria.yml (the page's ARIA snapshot)
// and <n>-<name>.png into DBP_OUT, and appends the action it follows to
// actions.md there. Page errors and console errors land in console.log.
import { appendFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const { DBP_URL: url, DBP_OUT: out, DBP_PLAYWRIGHT, DBP_MOBILE, CHROMIUM_PATH } = process.env;
const { chromium } = createRequire(import.meta.url)(DBP_PLAYWRIGHT);
const steps = (await import(pathToFileURL(process.argv[2]).href)).default;

const browser = await chromium.launch({ executablePath: CHROMIUM_PATH || undefined });
const context = await browser.newContext(
  DBP_MOBILE
    ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }
    : { viewport: { width: 1440, height: 900 } },
);
const page = await context.newPage();
page.on("pageerror", (e) => appendFileSync(join(out, "console.log"), `pageerror ${e.message}\n`));
page.on("console", (m) => m.type() === "error" && appendFileSync(join(out, "console.log"), `console ${m.text()}\n`));

let n = 0;
async function capture(name, action = "") {
  const base = `${String(++n).padStart(2, "0")}-${name}`;
  writeFileSync(join(out, `${base}.aria.yml`), await page.locator("body").ariaSnapshot());
  await page.screenshot({ path: join(out, `${base}.png`) });
  appendFileSync(join(out, "actions.md"), `- ${base}: ${action || "(state)"} — ${page.url()}\n`);
  console.log(`captured ${base}`);
}

let code = 0;
try {
  await page.goto(url);
  await steps({ page, url, capture });
} catch (e) {
  code = 1;
  console.error(e);
  await capture("failure", String(e.message).split("\n")[0]).catch(() => {});
} finally {
  await browser.close();
}
process.exit(code);
