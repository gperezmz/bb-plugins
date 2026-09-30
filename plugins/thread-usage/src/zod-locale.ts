/**
 * zod/mini carries no messages of its own, where full zod set English as it
 * loaded. The server entry and the host contract import this first, so their
 * refusals read as before; the app never does, so app.js carries no locale.
 * Like full zod, it leaves a locale something else in the process set.
 */
import { en } from "zod/locales";
import { config } from "zod/mini";

if (config().localeError === undefined) config(en());
