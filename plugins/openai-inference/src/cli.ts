/**
 * `bb openai-inference`: lists, sets and removes Endpoints from the command
 * line. It never takes a literal key, which goes on the plugin's page, and
 * never changes or clears a saved literal key.
 */
import { cliCommand, defineCli, PluginCliError, type PluginCliRegistration } from "@get-bb/plugin-sdk";
import { PAGE, type Endpoint } from "./endpoints.js";
import { NO_ENDPOINTS } from "./rules.js";
import type { EndpointManager, SaveResult } from "./manage.js";

/** How `list` says what an Endpoint's key is, never its value. */
export function keyText(endpoint: Endpoint): string {
  const { key } = endpoint;
  if (key.kind === "variable") return `variable ${key.reference.slice(2, -1)}`;
  if (key.kind === "literal") return key.set ? "literal (set)" : "literal (not set)";
  return "none";
}

const lines = (endpoints: readonly Endpoint[]): string =>
  endpoints.length === 0
    ? NO_ENDPOINTS
    : endpoints.map((e) => `${e.id}  ${e.url}  model ${e.model ?? "(none)"}  key ${keyText(e)}`).join("\n");

/** Throws the refusal in a result, or returns the Endpoints now saved. */
function saved(result: SaveResult): readonly Endpoint[] {
  if (result.ok) return result.endpoints;
  if ("problem" in result) throw new PluginCliError(result.problem, { code: "refused", hint: `A literal key is typed in ${PAGE}.` });
  const [field, why] = Object.entries(result.fields)[0] ?? ["", "refused"];
  throw new PluginCliError(`${field}: ${why}`, {
    code: "invalid_value",
    hint: field === "key" ? `A key here is a \${NAME} reference; a literal key is typed in ${PAGE}.` : undefined,
  });
}

export function createCli(manager: EndpointManager): PluginCliRegistration {
  return defineCli({
    name: "openai-inference",
    summary: "OpenAI-compatible inference: the Endpoints bb offers as AI services",
    commands: {
      list: cliCommand({
        summary: "List the Endpoints: id, URL, model and what kind of key each has (never a literal key)",
        options: { json: { type: "boolean", description: "Emit machine-readable JSON" } },
        async run(input) {
          const endpoints = await manager.list();
          return { exitCode: 0, stdout: input.options.json ? JSON.stringify(endpoints, null, 2) : lines(endpoints) };
        },
      }),
      set: cliCommand({
        summary: "Add an Endpoint, or replace the URL and model of the one with this id",
        positionals: [{ name: "id", description: "Lowercase letters, digits and dashes; fixed once saved", required: true }],
        options: {
          url: { type: "string", required: true, description: "An http:// or https:// URL ending where /chat/completions starts, or one with ${NAME} references" },
          model: { type: "string", required: true, description: "The model name the server serves" },
          key: {
            type: "string",
            placeholder: "${NAME}",
            description: "A ${NAME} reference to a variable in bb's environment, in single quotes; never a literal key. Leave it out to keep the saved key",
          },
          json: { type: "boolean", description: "Emit machine-readable JSON" },
        },
        async run(input) {
          const { id } = input.positionals;
          const result = await manager.set({ id, url: input.options.url, model: input.options.model, key: input.options.key ?? null });
          const endpoints = saved(result);
          const endpoint = endpoints.find((e) => e.id === id)!;
          return { exitCode: 0, stdout: input.options.json ? JSON.stringify(endpoint, null, 2) : lines([endpoint]) };
        },
      }),
      remove: cliCommand({
        summary: "Remove an Endpoint; a task selecting it stops until another service is selected",
        positionals: [{ name: "id", description: "The Endpoint's id", required: true }],
        async run(input) {
          saved(await manager.remove(input.positionals.id));
          return { exitCode: 0, stdout: `Removed ${input.positionals.id}.` };
        },
      }),
    },
  });
}
