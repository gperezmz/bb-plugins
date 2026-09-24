// The checklist: groups, rows and each row's expanded details.
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { GROUP_TITLES, GROUPS, type Fix, type Group } from "../core/vocab.js";
import type { ItemState, OnboardingState } from "../contract/rpc.js";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useActions } from "./actions.js";
import { copyText, errorText, postAction, timeAgo, useNow, useOnboardingRpc } from "./hooks.js";
import { MachineChip, STATUS_LABEL, StatusIcon, statusText } from "./status.js";
import { InlineTerminal } from "./terminal-view.js";

type Machines = OnboardingState["machines"];

const SERVER_TOOLTIP = "Runs bb itself; agents here use your GitHub login directly";

/**
 * Terminals no item on the page owns: a shell from before terminals moved
 * under their items, or one for an item the manifest dropped. Listed so they
 * can still be watched and closed.
 */
export function OtherTerminals({ state }: { state: OnboardingState }) {
  const actions = useActions();
  const ids = new Set(state.items.map((item) => item.id));
  const others = state.terminals.filter((terminal) => terminal.status !== "gone" && (terminal.itemId === null || !ids.has(terminal.itemId)));
  if (others.length === 0) return null;
  return (
    <section aria-label="Other setup terminals" className="rounded-lg border border-border bg-card px-4 py-2.5">
      <h2 className="text-sm font-medium">Other setup terminals</h2>
      <p className="text-xs text-muted-foreground">Opened earlier, or for an item your team's manifest no longer lists.</p>
      {others.map((terminal) => (
        <InlineTerminal key={terminal.terminalId} terminal={terminal} machineName={machineName(state.machines, terminal.hostId)} onClosed={actions.refresh} />
      ))}
    </section>
  );
}

export function Checklist({ state }: { state: OnboardingState }) {
  const sections: { key: Group | "nice"; items: ItemState[] }[] = [
    ...GROUPS.map((group) => ({ key: group, items: state.items.filter((item) => item.required && item.group === group) })),
    { key: "nice" as const, items: state.items.filter((item) => !item.required) },
  ];
  return (
    <div className="space-y-3">
      {sections
        .filter((section) => section.items.length > 0)
        .map((section) => (
          <GroupSection key={section.key} group={section.key} items={section.items} state={state} />
        ))}
    </div>
  );
}

function GroupSection({ group, items, state }: { group: Group | "nice"; items: ItemState[]; state: OnboardingState }) {
  const allOk = items.every((item) => item.status === "ok" || item.status === "skipped");
  const [open, setOpen] = useState<boolean | null>(null);
  // A group with a live terminal stays open, even when all is done.
  const hasTerminal = state.terminals.some((terminal) => terminal.status !== "gone" && items.some((item) => item.id === terminal.itemId));
  const expanded = open ?? (!allOk || hasTerminal);
  const done = items.filter((item) => item.status === "ok").length;
  const sshNote =
    group === "ssh" && state.manifest.githubMode === "builtin" && state.machines.length > 1
      ? "SSH isn't needed on your other machines. bb uses your GitHub login there."
      : null;
  return (
    <section aria-label={GROUP_TITLES[group]} className="overflow-hidden rounded-lg border border-border bg-card">
      <button
        type="button"
        onClick={() => setOpen(!expanded)}
        aria-expanded={expanded}
        className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm hover:bg-state-hover"
      >
        <Icon name={expanded ? "ChevronDown" : "ChevronRight"} className="size-4 text-muted-foreground" />
        <span className="font-medium">{GROUP_TITLES[group]}</span>
        <span className="ml-auto text-xs text-muted-foreground">
          {allOk ? (
            <span className="inline-flex items-center gap-1 text-success">
              <Icon name="Check" className="size-3.5" /> All done
            </span>
          ) : (
            `${done} of ${items.length}`
          )}
        </span>
      </button>
      {expanded ? (
        <div className="divide-y divide-border border-t border-border">
          {group === "github" ? (
            <p className="flex items-start gap-2 px-4 py-2 text-xs text-muted-foreground">
              <Icon name="Info" className="mt-0.5 size-3.5 shrink-0" />
              <span>
                This is the same <code>gh auth login</code> you'd run in a terminal, on{" "}
                {state.manifest.githubMode === "per-machine" ? "each machine" : (state.machines.find((machine) => machine.isServer)?.name ?? "the server machine")} where
                agents run — not your laptop.
              </span>
            </p>
          ) : null}
          {sshNote !== null ? (
            <p className="flex items-center gap-2 px-4 py-2 text-xs text-muted-foreground">
              <Icon name="Info" className="size-3.5" />
              {sshNote}
              <span title="bb's built-in git shares the server's GitHub login with every other machine and rewrites git@github.com URLs to HTTPS there. SSH to github.com only matters on the server machine, for signing, or for other hosts." className="underline decoration-dotted">
                Why
              </span>
            </p>
          ) : null}
          {items.map((item) => (
            <ItemRow key={item.id} item={item} state={state} />
          ))}
          {group === "github" ? (
            <p className="px-4 py-2 text-xs text-muted-foreground">
              Where secrets live: the server's GitHub login can be read by agents on the server
              {state.manifest.githubMode === "builtin" && items.find((item) => item.id === "github.builtin-git")?.results.every((result) => result.facts.builtInGit === "logged in")
                ? ", and bb's built-in git sends it to every other machine"
                : ""}
              .
              Machine variables can be read by every agent on every machine.
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function machineName(machines: Machines, hostId: string): string {
  return machines.find((machine) => machine.id === hostId)?.name ?? hostId;
}

/** The line under the title: the worst machine's detail, or why it matters. */
function rowLine(item: ItemState, machines: Machines, now: number): string {
  const inScope = item.results.filter((result) => result.status !== "skipped");
  const worst = inScope.find((result) => result.status === item.status) ?? inScope[0];
  if (worst === undefined) return item.why;
  if (worst.category === "not-checked") return item.why;
  if (worst.status === "unknown" && worst.category === "offline") {
    const machine = machines.find((candidate) => candidate.id === worst.hostId);
    return `Can't check, ${machine?.name ?? "machine"} offline · last seen ${timeAgo(machine?.lastSeenAt ?? null, now)}`;
  }
  return worst.detail;
}

function ItemRow({ item, state }: { item: ItemState; state: OnboardingState }) {
  const actions = useActions();
  const now = useNow(30_000);
  const [expanded, setExpanded] = useState(false);
  const inScope = item.results.filter((result) => result.status !== "skipped");
  const primaryEntry = item.fixes.find((entry) => entry.fixes.some((fix) => fix.kind !== "approve"));
  const primary = primaryEntry?.fixes.find((fix) => fix.kind !== "approve") ?? null;
  const pendingCommands = item.commands.filter((command) => !command.approved);
  const busyKey = primary === null || primaryEntry === undefined ? "" : `${item.id}@${primaryEntry.hostId}:${primary.kind}`;
  const showChips = inScope.length > 1 || (inScope.length === 1 && state.machines.length > 1 && !inScope.some((r) => state.machines.find((m) => m.id === r.hostId)?.isServer));

  return (
    <div className={cn("px-4 py-2.5", item.status === "unknown" && "opacity-70")} data-item={item.id}>
      <div className="flex items-start gap-3">
        <button
          type="button"
          className="mt-0.5"
          aria-label={expanded ? "Collapse" : "Expand"}
          onClick={() => setExpanded(!expanded)}
        >
          <StatusIcon status={item.status} />
        </button>
        <div className="min-w-0 flex-1">
          <button type="button" onClick={() => setExpanded(!expanded)} className="block w-full text-left">
            <span className="text-sm font-medium">{item.title}</span>
            <span className={cn("ml-2 text-xs", statusText(item.status))}>{STATUS_LABEL[item.status]}</span>
            <span className="mt-0.5 block text-sm text-muted-foreground">{rowLine(item, state.machines, now)}</span>
          </button>
          {showChips ? (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {item.results.map((result) => {
                const machine = state.machines.find((candidate) => candidate.id === result.hostId);
                if (machine === undefined) return null;
                return (
                  <MachineChip
                    key={result.hostId}
                    name={machine.name}
                    status={result.status}
                    isServer={machine.isServer}
                    title={`${machine.name}: ${STATUS_LABEL[result.status]}. ${result.detail}${machine.isServer ? `\n${SERVER_TOOLTIP}` : ""}`}
                  />
                );
              })}
            </div>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {state.deviceLogin?.itemId === item.id && (state.deviceLogin.state === "starting" || state.deviceLogin.state === "code") ? (
            <Button size="sm" variant="outline" disabled>
              <Icon name="Loading" className="animate-spin" />
              Waiting for GitHub
            </Button>
          ) : primary !== null && primaryEntry !== undefined ? (
            <Button
              size="sm"
              variant={item.status === "update" || item.status === "ok" ? "outline" : "default"}
              onClick={() => actions.run(item.id, primaryEntry.hostId, primary, item.title)}
              disabled={actions.busy === busyKey}
            >
              {actions.busy === busyKey ? <Icon name="Loading" className="animate-spin" /> : null}
              {primary.label}
              {showChips && item.fixes.length === 1 ? (
                <span className="text-xs opacity-70">· {machineName(state.machines, primaryEntry.hostId)}</span>
              ) : null}
            </Button>
          ) : pendingCommands.length > 0 ? (
            <Button size="sm" variant="outline" onClick={() => setExpanded(true)}>
              Review
            </Button>
          ) : null}
        </div>
      </div>
      {expanded || (pendingCommands.length > 0 && item.status === "needs-approval") ? (
        <ItemDetails item={item} state={state} />
      ) : null}
      {actions.envTarget?.itemId === item.id ? <EnvForm name={actions.envTarget.name} onDone={actions.closeEnv} /> : null}
      {/* Terminals this item opened, each with its own machine; they come back after a reload. */}
      {state.terminals
        .filter((terminal) => terminal.itemId === item.id && terminal.status !== "gone")
        .map((terminal) => (
          <InlineTerminal
            key={terminal.terminalId}
            terminal={terminal}
            machineName={machineName(state.machines, terminal.hostId)}
            onClosed={actions.refresh}
          />
        ))}
    </div>
  );
}

function ItemDetails({ item, state }: { item: ItemState; state: OnboardingState }) {
  const actions = useActions();
  const rpc = useOnboardingRpc();
  const now = useNow(30_000);
  const [details, setDetails] = useState<{ hostId: string; text: string | null; links: { label: string; url: string }[] } | null>(null);
  const [diff, setDiff] = useState<{ added: string[]; changed: string[]; removed: string[]; diffs: { folder: string; diff: string }[] } | null>(null);
  const inScope = item.results.filter((result) => result.status !== "skipped");
  const commandToCopy = item.fixes.flatMap((entry) => entry.fixes).find((fix) => fix.command !== null && fix.kind !== "copy-text")?.command ?? null;
  const showDetails = async (hostId: string) => {
    try {
      setDetails({ hostId, ...(await rpc.call("details", { itemId: item.id, hostId })) });
    } catch (cause) {
      toast.error(errorText(cause));
    }
  };
  const showDiff = async () => {
    try {
      setDiff(await rpc.call("skillsDiff", { itemId: item.id }));
    } catch (cause) {
      toast.error(errorText(cause));
    }
  };

  return (
    <div className="mt-2 space-y-2 pl-7 text-sm">
      {item.commands.length > 0 ? <Approvals item={item} /> : null}
      <ul className="space-y-1.5">
        {inScope.map((result) => {
          const machine = state.machines.find((candidate) => candidate.id === result.hostId);
          const fixes = item.fixes.find((entry) => entry.hostId === result.hostId)?.fixes.filter((fix) => fix.kind !== "approve") ?? [];
          return (
            <li key={result.hostId} className="rounded-md bg-surface-recessed px-3 py-2">
              <div className="flex flex-wrap items-center gap-2">
                <StatusIcon status={result.status} className="size-3.5" />
                <span className="font-medium">{machine?.name ?? result.hostId}</span>
                {machine?.isServer ? (
                  <span className="text-xs text-muted-foreground" title={SERVER_TOOLTIP}>
                    server
                  </span>
                ) : null}
                <span className="text-xs text-muted-foreground">· checked {timeAgo(result.checkedAt, now)}</span>
              </div>
              <p className="mt-1 text-muted-foreground">{result.detail}</p>
              {result.category === "read-only" && typeof result.facts.addThere === "string" ? (
                <pre className="mt-1 overflow-x-auto rounded bg-card px-2 py-1 font-mono text-xs">{result.facts.addThere}</pre>
              ) : null}
              {typeof result.facts.publicKey === "string" && item.id === "ssh.uploaded" && result.status !== "ok" ? (
                <code className="mt-1 block truncate rounded bg-card px-2 py-1 font-mono text-xs">{result.facts.publicKey}</code>
              ) : null}
              <div className="mt-2 flex flex-wrap gap-1.5">
                {fixes.map((fix) => (
                  <FixButton key={fix.kind} fix={fix} itemId={item.id} hostId={result.hostId} title={item.title} />
                ))}
                <Button size="sm" variant="ghost" onClick={() => actions.recheck(item.id, result.hostId)}>
                  Recheck
                </Button>
                <Button size="sm" variant="ghost" onClick={() => void showDetails(result.hostId)}>
                  Show details
                </Button>
                {machine?.longOffline ? (
                  <Button size="sm" variant="ghost" onClick={() => void postAction({ action: "forgetMachine", hostId: result.hostId }).catch((c) => toast.error(errorText(c)))}>
                    Forget this machine
                  </Button>
                ) : null}
              </div>
              {details?.hostId === result.hostId ? (
                <div className="mt-2 space-y-1">
                  {details.links.filter((link) => link.url.startsWith("https://")).map((link) => (
                    <a key={link.url} href={link.url} target="_blank" rel="noreferrer" className="block text-xs text-primary underline">
                      {link.label}
                    </a>
                  ))}
                  <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-card p-2 font-mono text-xs text-muted-foreground">
                    {details.text ?? "No output was captured for this check."}
                  </pre>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      {item.group === "skills" && (item.status === "update" || item.results.some((r) => r.category === "update")) ? (
        <div>
          <Button size="sm" variant="ghost" onClick={() => void showDiff()}>
            What changed?
          </Button>
          {diff !== null ? <SkillsDiff diff={diff} /> : null}
        </div>
      ) : null}
      <div className="flex flex-wrap gap-1.5">
        {commandToCopy !== null ? (
          <Button size="sm" variant="ghost" onClick={() => void copyText(commandToCopy).then((ok) => (ok ? toast.success("Command copied") : null))}>
            <Icon name="Copy" /> Copy command
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function FixButton({ fix, itemId, hostId, title }: { fix: Fix; itemId: string; hostId: string; title: string }) {
  const actions = useActions();
  const key = `${itemId}@${hostId}:${fix.kind}`;
  return (
    <Button size="sm" variant="outline" onClick={() => actions.run(itemId, hostId, fix, title)} disabled={actions.busy === key}>
      {actions.busy === key ? <Icon name="Loading" className="animate-spin" /> : null}
      {fix.label}
      {fix.safe ? <span className="text-[10px] text-muted-foreground">safe</span> : null}
    </Button>
  );
}

/** "Commands from your team": each shown verbatim, approved in the UI only. */
function Approvals({ item }: { item: ItemState }) {
  const actions = useActions();
  const roleLabel = { run: "Check", fix: "Fix", install: "Install", source: "Source" } as const;
  return (
    <div className="rounded-md border border-attention/40 bg-surface-attention px-3 py-2">
      <p className="text-xs font-medium">Commands from your team</p>
      <p className="text-xs text-muted-foreground">
        {item.group === "plugins" || item.commands.some((c) => c.role === "source")
          ? "Plugins run with full trust inside bb. Approve the source only if you trust it."
          : "These run on your machines exactly as shown. Approve them only if you trust them."}
      </p>
      <ul className="mt-2 space-y-1.5">
        {item.commands.map((command) => (
          <li key={command.hash} className="flex items-start gap-2">
            <span className="mt-1 w-12 shrink-0 text-[11px] text-muted-foreground">{roleLabel[command.role]}</span>
            <code className="min-w-0 flex-1 whitespace-pre-wrap break-all rounded bg-card px-2 py-1 font-mono text-xs">{command.text}</code>
            {command.approved ? (
              <Button size="sm" variant="ghost" onClick={() => void actions.revoke(command.hash)}>
                Revoke
              </Button>
            ) : (
              <Button size="sm" onClick={() => void actions.approve(command.hash)}>
                Approve
              </Button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function SkillsDiff({ diff }: { diff: { added: string[]; changed: string[]; removed: string[]; diffs: { folder: string; diff: string }[] } }) {
  return (
    <div className="mt-1 space-y-1 text-xs">
      {diff.added.length > 0 ? <p><span className="text-diff-added">Added:</span> {diff.added.join(", ")}</p> : null}
      {diff.changed.length > 0 ? <p><span className="text-attention">Changed:</span> {diff.changed.join(", ")}</p> : null}
      {diff.removed.length > 0 ? <p><span className="text-diff-removed">Removed:</span> {diff.removed.join(", ")}</p> : null}
      {diff.diffs.map((entry) => (
        <details key={entry.folder} className="rounded bg-card">
          <summary className="cursor-pointer px-2 py-1 font-mono">{entry.folder}/SKILL.md</summary>
          <pre className="max-h-64 overflow-auto px-2 pb-2 font-mono">
            {entry.diff.split("\n").map((line, index) => (
              <span
                key={index}
                className={cn("block", line.startsWith("+ ") && "text-diff-added", line.startsWith("- ") && "text-diff-removed")}
              >
                {line}
              </span>
            ))}
          </pre>
        </details>
      ))}
      {diff.added.length + diff.changed.length + diff.removed.length === 0 ? <p className="text-muted-foreground">No skill changes.</p> : null}
    </div>
  );
}

/** Masked value form for a machine variable. The value never comes back. */
function EnvForm({ name, onDone }: { name: string; onDone: () => void }) {
  const rpc = useOnboardingRpc();
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (value === "") return;
    setSaving(true);
    try {
      const out = await postAction({ action: "setEnv", name, value });
      setValue("");
      toast.success(out.message ?? `${name} is set.`);
      onDone();
    } catch (cause) {
      toast.error(errorText(cause));
    } finally {
      setSaving(false);
    }
  };
  return (
    <form onSubmit={submit} className="mt-2 space-y-2 pl-7">
      <p className="text-xs text-attention">
        Every agent on every machine, the server included, can read machine variables.
      </p>
      <div className="flex gap-2">
        <Input
          type="password"
          autoComplete="off"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder={`Value for ${name}`}
          aria-label={`Value for ${name}`}
        />
        <Button type="submit" size="sm" disabled={saving || value === ""}>
          Save
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
