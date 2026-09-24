// `bb thread-glance prefs …`, the same commands and errors as bb's
// `bb thread-list prefs …`. Writes go through the store, so they publish.
import { PluginCliError, cliCommand, defineCli, type PluginCliRegistration } from "@get-bb/plugin-sdk";
import {
  PREFERENCE_KEYS,
  describePreference,
  isPreferenceKey,
  type PreferenceKey,
} from "../shared/preferences";
import { PreferenceValidationError, type PreferenceStore } from "./preference-store";

/** Parses a CLI value as JSON; a bare word such as `tree` is read as a string. */
export function parseCliValue(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

function requirePreferenceKey(key: string): PreferenceKey {
  if (isPreferenceKey(key)) return key;
  throw new PluginCliError(`Unknown preference: ${key}`, {
    code: "unknown_preference",
    hint: `Known preferences: ${PREFERENCE_KEYS.join(", ")}.`,
  });
}

const jsonOption = { type: "boolean", description: "Emit machine-readable JSON" } as const;
const keyPositional = { name: "key", description: "Preference name", required: true } as const;

export function createCli(store: PreferenceStore): PluginCliRegistration {
  function keyValueOutput(key: PreferenceKey, value: unknown, json: boolean): string {
    return json ? JSON.stringify({ key, value }) : `${key} = ${JSON.stringify(value)}`;
  }

  return defineCli({
    name: "thread-glance",
    summary: "Inspect and change the Thread Glance sidebar's layout preferences",
    description:
      "Organization, sort, group order, hidden and collapsed groups, child nesting and folding for the Thread Glance sidebar. Values are JSON; a bare word is read as a string.",
    commands: {
      "prefs list": cliCommand({
        summary: "List every preference and its current value",
        options: { json: jsonOption },
        async run(input) {
          const preferences = await store.readAll();
          if (input.options.json) return { exitCode: 0, stdout: JSON.stringify(preferences) };
          const lines = PREFERENCE_KEYS.map(
            (key) => `${key}\t${JSON.stringify(preferences[key])}\t${describePreference(key)}`,
          );
          return { exitCode: 0, stdout: lines.join("\n") };
        },
      }),
      "prefs get": cliCommand({
        summary: "Print one preference",
        positionals: [keyPositional],
        options: { json: jsonOption },
        async run(input) {
          const key = requirePreferenceKey(input.positionals.key);
          const value = await store.read(key);
          return {
            exitCode: 0,
            stdout: input.options.json ? JSON.stringify({ key, value }) : JSON.stringify(value),
          };
        },
      }),
      "prefs set": cliCommand({
        summary: "Set one preference",
        positionals: [
          keyPositional,
          {
            name: "value",
            description: `JSON value, e.g. '"machine"' or '["pinned","threads"]'`,
            required: true,
          },
        ] as const,
        options: { json: jsonOption },
        async run(input) {
          const key = requirePreferenceKey(input.positionals.key);
          try {
            const value = await store.write(key, parseCliValue(input.positionals.value));
            return { exitCode: 0, stdout: keyValueOutput(key, value, input.options.json === true) };
          } catch (error) {
            if (error instanceof PreferenceValidationError) {
              throw new PluginCliError(error.message, {
                code: "invalid_preference_value",
                hint: describePreference(key),
              });
            }
            throw error;
          }
        },
      }),
      "prefs reset": cliCommand({
        summary: "Restore one preference to its default",
        positionals: [keyPositional],
        options: { json: jsonOption },
        async run(input) {
          const key = requirePreferenceKey(input.positionals.key);
          const value = await store.reset(key);
          return { exitCode: 0, stdout: keyValueOutput(key, value, input.options.json === true) };
        },
      }),
    },
  });
}
