// Team Onboarding: a live setup checklist driven by a team manifest.
//
// This file only wires registrations. The engine (src/server/engine.ts) owns
// the manifest, checks, fixes and live updates; the pure rules live in
// src/core.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { cliCommand, defineCli, PluginCliError } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { parseManifest, formatIssue } from "./src/core/manifest.js";
import { redactSecrets } from "./src/core/redact.js";
import { manifestPathProblem } from "./src/server/manifest-file.js";
import { GROUP_TITLES, GROUPS, type FixKind } from "./src/core/model.js";
import { ACTIONS_PATH, actionInput, rpcContract, type ActionResult } from "./src/contract/rpc.js";
import { Engine, FixError } from "./src/server/engine.js";
import { asEngineer } from "./src/server/interaction.js";
import { bbRefusal } from "./src/server/bb-errors.js";
import { ReconnectRechecks } from "./src/server/reconnect.js";

export { bbRefusal } from "./src/server/bb-errors.js";

export { rpcContract } from "./src/contract/rpc.js";

export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    manifestFile: {
      type: "string",
      label: "Manifest file",
      description:
        "Where the team's onboarding.yaml is on the bb server, for provisioning that keeps it somewhere else. Empty uses <bb data dir>/team-onboarding/onboarding.yaml. The plugin never fetches a manifest.",
      default: "",
      // Settable from the CLI too, so it is checked here, not only in the page.
      experimental_schema: z.string().refine((value) => manifestPathProblem(value) === null, {
        error: (issue) => manifestPathProblem(String(issue.input)) ?? "Use an absolute path to onboarding.yaml.",
      }),
    },
    checkIntervalMinutes: {
      type: "number",
      label: "Check every (minutes)",
      default: 30,
      experimental_schema: z.number().int().min(5).max(1440),
    },
  });

  const readSettings = async () => {
    const value = await settings.get();
    return { manifestFile: value.manifestFile, checkIntervalMinutes: value.checkIntervalMinutes };
  };

  const engine = new Engine(bb, readSettings);
  await engine.init();

  settings.onChange((next, prev) => {
    if (next.manifestFile !== prev.manifestFile) {
      void engine
        .watchManifest()
        .then(() => engine.run({}))
        .catch((error) => {
          if (!engine.isDisposed && !(error instanceof Error && error.name === "PluginContextStaleError")) {
            bb.log.warn(`run after settings change failed: ${redactSecrets(String(error))}`);
          }
        });
    }
  });

  bb.rpc.register(rpcContract, {
    state: () => engine.state(),
    summary: () => engine.summary(),
    recheck: async ({ itemId, hostId }) => {
      // RPC is reachable by agents (`bb plugin rpc call`), so this never lets
      // git ask credential helpers; the page's Recheck goes through the
      // actions route for that.
      void engine.run({ itemId, hostId }).catch((error) => bb.log.warn(`recheck failed: ${redactSecrets(String(error))}`));
      return { ok: true, message: null };
    },
    // A refusal is an answer, not a server error.
    runFix: async (input) => {
      try {
        return await engine.runFix({ ...input, safeOnly: true });
      } catch (error) {
        if (error instanceof FixError) return { ok: false, message: error.message, terminal: null, loginId: null };
        bb.log.warn(`runFix failed: ${error instanceof Error ? error.name : "error"}`);
        return { ok: false, message: "The fix failed. Open Show details on the item.", terminal: null, loginId: null };
      }
    },
    fixAllSafe: (input) => engine.fixAllSafe(input),
    cancelDeviceLogin: async ({ loginId }) => ({ ok: engine.cancelDeviceLogin(loginId), message: null }),
    details: async ({ itemId, hostId }) => engine.details(itemId, hostId),
    skillsDiff: async ({ itemId }) => {
      const manifest = engine.currentManifest;
      const entry = manifest?.skills.find((skill) => `skill:${skill.id}` === itemId);
      if (manifest === null || entry === undefined) return { added: [], changed: [], removed: [], diffs: [] };
      return engine.skills.diff(entry, manifest);
    },
    manifestView: async () => {
      const text = await engine.cachedManifestText();
      const view = engine.manifestView();
      const parsed = text === null ? null : parseManifest(text);
      const state = await engine.state();
      return {
        text,
        version: view.version,
        path: state.manifest.path,
        sections: view.sections,
        commands: view.commands,
        issues: parsed !== null && !parsed.ok ? parsed.issues : [],
      };
    },
    watch: async ({ itemId, hostId }) => {
      engine.watch(itemId, hostId);
      return { ok: true, message: null };
    },
    manifestFile: () => engine.manifestFileInfo(),
  });

  // Everything that needs the engineer runs here, and only here: approvals,
  // fixes outside the safe list, logins, machine variables and terminals.
  // Not RPC, which `bb plugin rpc call` reaches; not the CLI; not an agent
  // tool. The route takes same-origin browser fetches only: browsers set the
  // Sec-Fetch-* headers themselves and page scripts can't change them.
  bb.http.route(
    "POST",
    ACTIONS_PATH,
    async (context) => {
      const request = context.req.raw;
      const json = (status: number, body: ActionResult) =>
        new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
      if (!isBrowserFetch(request.headers)) {
        return json(403, { ok: false, message: "Do this in the Onboarding page." });
      }
      const parsed = actionInput.safeParse(await request.json().catch(() => null));
      if (!parsed.success) return json(400, { ok: false, message: "Invalid request." });
      try {
        return json(200, await runAction(bb, engine, parsed.data));
      } catch (error) {
        if (error instanceof FixError) return json(400, { ok: false, message: error.message });
        const refused = bbRefusal(error);
        bb.log.warn(`action ${parsed.data.action} failed: ${error instanceof Error ? error.name : "error"}${refused === null ? "" : ` ${refused.status} ${refused.code ?? ""}`.trimEnd()}`);
        // bb's own refusals say what was wrong; they carry no child-process
        // output, and are masked and cut short all the same.
        if (refused !== null) {
          return json(502, { ok: false, message: `bb refused the action: ${refused.text}` });
        }
        // Other unexpected errors can carry child-process output; the page
        // gets a plain message and the log only the error's name.
        return json(500, { ok: false, message: "The action failed. Recheck, or open Show details on the item." });
      }
    },
    { auth: "local" },
  );

  registerCli(bb, engine);
  configureAgents(bb);

  // The schedule fires every 5 minutes and runs what the interval makes due,
  // so a changed interval takes effect without a reload.
  bb.background.schedule("checks", "*/5 * * * *", () => engine.tick());

  // First run after load, and rechecks when a machine reconnects.
  bb.background.service("live", {
    async start(signal) {
      void engine.run({ signal }).catch((error) => {
        if (!signal.aborted) bb.log.warn(`first run failed: ${redactSecrets(String(error))}`);
      });
      const reconnects = new ReconnectRechecks((hostId) => {
        void engine.run({ hostId, reloadManifest: false, signal }).catch(() => {});
      });
      const unsubscribe = bb.sdk.subscribe({
        event: "host:changed",
        callback: (event) => {
          if (event.id === undefined) return;
          const hostId = event.id;
          if (event.changes.includes("host-connected")) {
            reconnects.connected(hostId);
          } else if (event.changes.includes("host-disconnected")) {
            reconnects.disconnected(hostId);
            engine.publish(["*"]);
          }
        },
      });
      await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
      unsubscribe();
      reconnects.dispose();
    },
  });
}

/** A fetch from the bb page itself, as browsers mark it. */
export function isBrowserFetch(headers: Headers): boolean {
  return (
    headers.get("sec-fetch-site") === "same-origin" &&
    headers.get("sec-fetch-mode") === "cors" &&
    headers.get("sec-fetch-dest") === "empty"
  );
}

async function runAction(bb: BbPluginApi, engine: Engine, action: z.output<typeof actionInput>): Promise<ActionResult> {
  switch (action.action) {
    case "approve": {
      if (!engine.approve(action.hash)) throw new FixError("That command is no longer in the manifest.");
      return { ok: true, message: null };
    }
    case "revoke":
      await engine.revoke(action.hash);
      return { ok: true, message: null };
    case "runFix": {
      // A fix from the page is the engineer's: git may use their helpers.
      const { action: _action, ...input } = action;
      return asEngineer(() => engine.runFix(input));
    }
    case "setEnv":
      await engine.setEnv(action.name, action.value);
      return { ok: true, message: `${action.name} is set for every machine.` };
    case "closeTerminal":
      await engine.closeTerminal(action.terminalId);
      return { ok: true, message: null };
    case "forgetMachine":
      await engine.forgetMachine(action.hostId);
      return { ok: true, message: null };
    case "recheck": {
      // The engineer's click on Recheck: git may ask its credential helpers.
      void engine.run({ itemId: action.itemId, hostId: action.hostId, interactive: true }).catch(() => {});
      return { ok: true, message: null };
    }
  }
}

function formatStatus(state: Awaited<ReturnType<Engine["state"]>>): string {
  const machineName = (id: string) => state.machines.find((machine) => machine.id === id)?.name ?? id;
  const icon: Record<string, string> = {
    ok: "✓",
    todo: "○",
    broken: "✗",
    update: "↑",
    "needs-approval": "!",
    unknown: "?",
    skipped: "-",
  };
  const lines: string[] = [];
  const unusable = state.manifest.status === "error";
  const manifestLabel =
    state.manifest.teamName === null
      ? unusable
        ? "Manifest file can't be used"
        : "No manifest"
      : unusable
        ? `${state.manifest.teamName} (manifest file can't be used; showing the last good one)`
        : state.manifest.teamName;
  lines.push(`${manifestLabel} · ${state.progress.done} of ${state.progress.total} required items done · ${state.homeLine}`);
  // Same order as the page: required items by group, then Nice to have.
  const ordered = [
    ...GROUPS.flatMap((g) => state.items.filter((item) => item.required && item.group === g)),
    ...state.items.filter((item) => !item.required),
  ];
  let group = "";
  for (const item of ordered) {
    const title = item.required ? GROUP_TITLES[item.group] : GROUP_TITLES.nice;
    if (title !== group) {
      group = title;
      lines.push("", title);
    }
    const chips = item.results
      .filter((result) => result.status !== "skipped")
      .map((result) => `${machineName(result.hostId)}:${result.status}`)
      .join(" ");
    lines.push(`  ${icon[item.status] ?? " "} ${item.id}  ${item.title}  [${chips}]`);
    for (const result of item.results) {
      if (result.status !== "ok" && result.status !== "skipped") {
        lines.push(`      ${machineName(result.hostId)}: ${result.detail}`);
      }
    }
  }
  return lines.join("\n");
}

async function invokingHost(bb: BbPluginApi, machine: string | undefined, threadId: string | undefined, engine: Engine) {
  const machines = engine.currentMachines.length > 0 ? engine.currentMachines : await engine.refreshMachines();
  if (machine !== undefined) {
    const found = machines.find((candidate) => candidate.name === machine || candidate.id === machine);
    if (found === undefined) {
      throw new PluginCliError(`No machine named ${machine}.`, { code: "unknown_machine", hint: `Machines: ${machines.map((m) => m.name).join(", ")}` });
    }
    return found;
  }
  if (threadId !== undefined) {
    const thread = (await bb.sdk.threads.get({ threadId })) as { environmentId?: string | null };
    if (thread.environmentId) {
      const environment = (await bb.sdk.environments.get({ environmentId: thread.environmentId } as never)) as { hostId?: string };
      const found = machines.find((candidate) => candidate.id === environment.hostId);
      if (found !== undefined) return found;
    }
  }
  const server = machines.find((candidate) => candidate.isServer);
  if (server === undefined) throw new PluginCliError("No server machine found.", { code: "no_machine", hint: "Pass --machine <name>." });
  return server;
}

function registerCli(bb: BbPluginApi, engine: Engine) {
  bb.cli.register(
    defineCli({
      name: "team-onboarding",
      summary: "Team setup checklist: status, checks and safe fixes",
      description:
        "Reads your team's onboarding manifest and checks GitHub, SSH, agents, skills, plugins, tools and team checks on every machine. Approvals of team commands happen in the Onboarding page only.",
      commands: {
        status: cliCommand({
          summary: "Show the checklist, per machine",
          options: { json: { type: "boolean", description: "Print JSON" } },
          async run(input) {
            const state = await engine.state();
            if (input.options.json === true) {
              return {
                exitCode: 0,
                stdout: JSON.stringify({
                  manifest: state.manifest,
                  progress: state.progress,
                  badge: state.badge,
                  items: state.items.map((item) => ({
                    id: item.id,
                    title: item.title,
                    required: item.required,
                    status: item.status,
                    results: item.results.map((r) => ({ machine: r.hostId, status: r.status, category: r.category, detail: r.detail })),
                    safeFixes: item.fixes.flatMap((f) => f.fixes.filter((fix) => fix.safe).map((fix) => ({ machine: f.hostId, kind: fix.kind, label: fix.label }))),
                  })),
                }),
              };
            }
            return { exitCode: 0, stdout: formatStatus(state) };
          },
        }),
        check: cliCommand({
          summary: "Run the checks again (all, or one item)",
          positionals: [{ name: "itemId", description: "An item id such as github.login or skill:team" }],
          async run(input, ctx) {
            await engine.run({ itemId: input.positionals.itemId, signal: ctx.signal });
            return { exitCode: 0, stdout: formatStatus(await engine.state()) };
          },
        }),
        fix: cliCommand({
          summary: "Run an item's safe fixes; prints the manual steps for anything else",
          positionals: [{ name: "itemId", description: "An item id such as ssh.key", required: true }],
          options: { machine: { type: "string", description: "Machine name (defaults to the invoking thread's)" } },
          async run(input, ctx) {
            const machine = await invokingHost(bb, input.options.machine, ctx.threadId, engine);
            const state = await engine.state();
            const item = state.items.find((candidate) => candidate.id === input.positionals.itemId);
            if (item === undefined) {
              throw new PluginCliError(`No item ${input.positionals.itemId}.`, { code: "unknown_item", hint: "Run `bb team-onboarding status` for ids." });
            }
            const fixes = item.fixes.find((entry) => entry.hostId === machine.id)?.fixes ?? [];
            const lines: string[] = [];
            for (const fix of fixes) {
              if (!fix.safe) {
                // Commands are shown verbatim for review in the page only.
                lines.push(`manual: ${fix.label}${fix.command === null ? "" : ` — ${redactSecrets(fix.command)}`} (open Onboarding in bb)`);
                continue;
              }
              try {
                const out = await engine.runFix({ itemId: item.id, hostId: machine.id, kind: fix.kind as FixKind, safeOnly: true });
                lines.push(`done: ${fix.label}${out.message === null ? "" : ` — ${out.message}`}`);
              } catch (error) {
                lines.push(`failed: ${fix.label} — ${redactSecrets(error instanceof Error ? error.message : String(error))}`);
              }
            }
            if (lines.length === 0) lines.push(item.status === "ok" ? "Nothing to fix." : "No fix is offered here. Open Onboarding in bb.");
            return { exitCode: 0, stdout: lines.join("\n") };
          },
        }),
        apply: cliCommand({
          summary: "Run every safe fix on one machine and list what's left to do by hand",
          description:
            "For provisioning scripts and machine bootstraps. Safe fixes: SSH key (only when none exists), pinned GitHub host keys, the plugin's SSH config, gh auth setup-git, installing team skills not yet installed, and approved plugins and marketplaces.",
          options: {
            safe: { type: "boolean", description: "Required: only safe fixes run" },
            machine: { type: "string", description: "Machine name (defaults to the invoking thread's)" },
            json: { type: "boolean", description: "Print JSON" },
          },
          async run(input, ctx) {
            if (input.options.safe !== true) {
              throw new PluginCliError("apply only runs safe fixes.", { code: "safe_required", hint: "Add --safe." });
            }
            const machine = await invokingHost(bb, input.options.machine, ctx.threadId, engine);
            await engine.run({ hostId: machine.id, signal: ctx.signal });
            const outcome = await engine.fixAllSafe({ hostId: machine.id, dryRun: false });
            await engine.run({ hostId: machine.id, signal: ctx.signal });
            const state = await engine.state();
            const manual = state.items
              .filter((item) => item.required)
              .flatMap((item) =>
                item.results
                  .filter((result) => result.hostId === machine.id && ["todo", "broken", "needs-approval"].includes(result.status))
                  .map(() => {
                    const fix = item.fixes.find((entry) => entry.hostId === machine.id)?.fixes[0];
                    return { id: item.id, title: item.title, status: item.results.find((r) => r.hostId === machine.id)!.status, next: fix?.label ?? "Open Onboarding in bb" };
                  }),
              );
            if (input.options.json === true) {
              return { exitCode: 0, stdout: JSON.stringify({ machine: machine.name, ran: outcome.results, manual }) };
            }
            const lines = [`Machine ${machine.name}`];
            for (const result of outcome.results) {
              lines.push(`  ${result.ok ? "✓" : "✗"} ${result.itemId}${result.message === null ? "" : ` — ${result.message}`}`);
            }
            if (outcome.results.length === 0) lines.push("  No safe fixes were needed.");
            lines.push("", manual.length === 0 ? "Nothing left to do by hand." : "Left to do by hand (open Onboarding in bb):");
            for (const entry of manual) lines.push(`  ${entry.id}  ${entry.title}  [${entry.status}] → ${entry.next}`);
            return { exitCode: 0, stdout: lines.join("\n") };
          },
        }),
        "manifest path": cliCommand({
          summary: "Print where the plugin reads the team manifest on the bb server",
          async run() {
            const info = await engine.manifestFileInfo();
            return { exitCode: 0, stdout: `${info.path}${info.exists ? "" : " (not there yet)"}` };
          },
        }),
        "manifest install": cliCommand({
          summary: "Validate an onboarding.yaml and install it where the plugin reads it (atomic, mode 0644)",
          positionals: [{ name: "file", description: "Path to the manifest (relative to the current directory)", required: true }],
          options: { machine: { type: "string", description: "Machine the file is on (defaults to the invoking thread's)" } },
          async run(input, ctx) {
            const machine = await invokingHost(bb, input.options.machine, ctx.threadId, engine);
            const file = input.positionals.file;
            const path = file.startsWith("/") || ctx.cwd === undefined ? file : `${ctx.cwd.replace(/\/+$/, "")}/${file}`;
            try {
              const out = await engine.installManifest(await readInvokingFile(bb, machine.id, path));
              return { exitCode: 0, stdout: `Installed ${out.teamName} (${out.itemCount} items) at ${out.path}\nsha256 ${out.sha}` };
            } catch (error) {
              return { exitCode: 1, stderr: error instanceof Error ? error.message : String(error) };
            }
          },
        }),
        "manifest validate": cliCommand({
          summary: "Validate an onboarding.yaml on the invoking machine",
          positionals: [{ name: "file", description: "Path to the manifest (relative to the current directory)", required: true }],
          options: { machine: { type: "string", description: "Machine the file is on (defaults to the invoking thread's)" } },
          async run(input, ctx) {
            const machine = await invokingHost(bb, input.options.machine, ctx.threadId, engine);
            const file = input.positionals.file;
            const path = file.startsWith("/") || ctx.cwd === undefined ? file : `${ctx.cwd.replace(/\/+$/, "")}/${file}`;
            const text = await readInvokingFile(bb, machine.id, path);
            const result = parseManifest(text);
            if (result.ok) {
              return { exitCode: 0, stdout: `Valid: ${result.manifest.team.name}.` };
            }
            return { exitCode: 1, stderr: result.issues.map(formatIssue).join("\n") };
          },
        }),
      },
    }),
  );
}

/** A text file on the machine that ran the CLI; the daemon may send it base64-encoded. */
async function readInvokingFile(bb: BbPluginApi, hostId: string, path: string): Promise<string> {
  const read = (await bb.sdk.files.read({ hostId, path })) as { content?: string; contentEncoding?: string };
  const content = read.content ?? "";
  return read.contentEncoding === "base64" ? Buffer.from(content, "base64").toString("utf8") : content;
}

/** Every thread gets the skill that documents the CLI; the plugin adds no agent tools. */
function configureAgents(bb: BbPluginApi) {
  bb.agents.configure(() => ({ tools: [], skills: ["team-onboarding"] }));
}
