// `node --import ./scripts/ts-resolve.mjs <script.ts>`: see ts-resolve-hooks.mjs.
import { register } from "node:module";

register("./ts-resolve-hooks.mjs", import.meta.url);
