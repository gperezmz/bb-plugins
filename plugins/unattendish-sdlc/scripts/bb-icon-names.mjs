// Prints every built-in icon name a bb release's web bundle resolves, one per line, sorted, to refresh
// testing/bb-icons.ts when the plugin's oldest supported bb changes. Reads the bundle's main chunk, the
// app/dist/assets/index-*.js of an installed bb-app, given as the one argument:
//
//   node scripts/bb-icon-names.mjs "$(dirname "$(readlink -f "$(command -v bb)")")"/../../app/dist/assets/index-*.js
//
// bb's names list is spelled `NAMES=[...Object.keys(EAGER_MAP),...LAZY_LIST]`: the keys of an icon map the main
// chunk holds, and a dot-separated list a lazily loaded chunk registers. The minified names change per release, so
// both are found through that spelling.
import { readFileSync } from "node:fs";

const bundle = readFileSync(process.argv[2], "utf8");
const found = /([\w$]+)=\[\.\.\.Object\.keys\(([\w$]+)\),\.\.\.([\w$]+)\]/.exec(bundle);
if (found === null) throw new Error("no `[...Object.keys(map),...list]` names list in this bundle");
const [, , mapName, listName] = found;

/** The top-level keys of the object literal that starts at `start`, skipping nested literals and strings. */
function topLevelKeys(start) {
  const members = [];
  let depth = 0;
  let quote = null;
  let from = start + 1;
  for (let at = start; at < bundle.length; at += 1) {
    const c = bundle[at];
    if (quote !== null) {
      if (c === "\\") at += 1;
      else if (c === quote) quote = null;
    } else if (c === '"' || c === "'" || c === "`") quote = c;
    else if ("{[(".includes(c)) depth += 1;
    else if ("}])".includes(c)) {
      depth -= 1;
      if (depth === 0) {
        members.push(bundle.slice(from, at));
        break;
      }
    } else if (c === "," && depth === 1) {
      members.push(bundle.slice(from, at));
      from = at + 1;
    }
  }
  return members.filter((member) => member.trim() !== "").map((member) => /^\s*([A-Za-z_$][\w$]*)\s*:/.exec(member)[1]);
}

const eager = topLevelKeys(bundle.indexOf(`${mapName}={`) + mapName.length + 1);
const lazy = new RegExp(`${listName.replace(/\$/g, "\\$")}=\`([^\`]*)\`\\.split\\(\`\\.\`\\)`).exec(bundle)[1].split(".");
console.log([...new Set([...eager, ...lazy])].sort().join("\n"));
