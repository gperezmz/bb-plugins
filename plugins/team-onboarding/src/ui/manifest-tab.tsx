// The Manifest tab: the parsed manifest by section, its version, and every
// command, tool install and plugin source with its approval state.
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { useRealtime, type PluginNavPanelProps } from "@get-bb/plugin-sdk/app";
import { Button } from "@/components/ui/button";
import { CHANGED_CHANNEL, errorText, postAction, useOnboardingRpc } from "./hooks.js";

type View = {
  text: string | null;
  version: string | null;
  path: string;
  sections: { title: string; entries: { id: string; title: string; detail: string }[] }[];
  commands: { role: string; text: string; ref: string | null; hash: string; approved: boolean; itemId: string; itemTitle: string }[];
  issues: { message: string; path: string; line: number | null }[];
};

export function ManifestTab(_props: PluginNavPanelProps) {
  const rpc = useOnboardingRpc();
  const [view, setView] = useState<View | null>(null);
  const [showRaw, setShowRaw] = useState(false);
  const refetch = useCallback(() => {
    rpc.call("manifestView").then((next) => setView(next), (cause) => toast.error(errorText(cause)));
  }, [rpc]);
  useEffect(() => refetch(), [refetch]);
  useRealtime(CHANGED_CHANNEL, refetch);

  if (view === null) return <p className="text-sm text-muted-foreground">Loading the manifest…</p>;
  if (view.text === null) {
    return <p className="text-sm text-muted-foreground">No team manifest on this server, so only the built-in checks run. The Onboarding page shows how an admin adds one.</p>;
  }
  const act = async (method: "approve" | "revoke", hash: string) => {
    try {
      await postAction({ action: method, hash });
      refetch();
    } catch (cause) {
      toast.error(errorText(cause));
    }
  };
  return (
    <div className="space-y-4 text-sm">
      <div className="text-xs text-muted-foreground">
        {view.path}
        {view.version === null ? "" : ` · ${view.version.slice(0, 12)}`}
      </div>
      {view.issues.length > 0 ? (
        <ul className="list-disc pl-5 text-xs text-destructive">
          {view.issues.map((issue) => (
            <li key={`${issue.path}:${issue.message}`}>
              {issue.line === null ? "" : `line ${issue.line}: `}
              {issue.path} {issue.message}
            </li>
          ))}
        </ul>
      ) : null}
      <section>
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Commands from your team</h3>
        {view.commands.length === 0 ? (
          <p className="mt-1 text-xs text-muted-foreground">Your manifest runs no commands and installs no plugins.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {view.commands.map((command) => (
              <li key={command.hash} className="rounded-md border border-border p-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-muted-foreground">
                    {command.itemTitle} · {command.role}
                  </span>
                  {command.approved ? (
                    <Button size="sm" variant="ghost" className="h-7" onClick={() => void act("revoke", command.hash)}>
                      Revoke
                    </Button>
                  ) : (
                    <Button size="sm" className="h-7" onClick={() => void act("approve", command.hash)}>
                      Approve
                    </Button>
                  )}
                </div>
                <code className="mt-1 block whitespace-pre-wrap break-all font-mono text-xs">{command.text}</code>
                <span className={command.approved ? "text-xs text-success" : "text-xs text-attention"}>
                  {command.approved ? "Approved" : "Waiting for your approval"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
      {view.sections.map((section) => (
        <section key={section.title}>
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{section.title}</h3>
          <ul className="mt-1 divide-y divide-border">
            {section.entries.map((entry) => (
              <li key={entry.id} className="flex items-baseline justify-between gap-3 py-1">
                <span>{entry.title}</span>
                <span className="min-w-0 truncate text-right text-xs text-muted-foreground">{entry.detail}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <Button size="sm" variant="ghost" onClick={() => setShowRaw(!showRaw)}>
        {showRaw ? "Hide" : "Show"} onboarding.yaml
      </Button>
      {showRaw ? <pre className="overflow-auto rounded-md bg-surface-recessed p-2 font-mono text-xs">{view.text}</pre> : null}
    </div>
  );
}
