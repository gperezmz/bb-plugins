// Resolve hook: an import of `./x.js` loads `./x.ts` when only the .ts file
// exists, so plain `node` can run the TypeScript sources (it strips types).
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

export async function resolve(specifier, context, next) {
  if (specifier.startsWith(".") && specifier.endsWith(".js") && context.parentURL?.startsWith("file:")) {
    const asJs = new URL(specifier, context.parentURL);
    const asTs = new URL(specifier.replace(/\.js$/, ".ts"), context.parentURL);
    if (!existsSync(fileURLToPath(asJs)) && existsSync(fileURLToPath(asTs))) return next(asTs.href, context);
  }
  return next(specifier, context);
}
