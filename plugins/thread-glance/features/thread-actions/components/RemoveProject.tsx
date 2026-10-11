// Removing a project: the confirmation that needs the project's exact name
// typed, shared by the thread menu's Remove project and the settings page's
// Project management, and the removal itself.
import { useState } from "react";
import type { PluginBrowserBbSdk, PluginRpcClient } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { pluginData } from "@/features/thread-list";
import type { RpcContract } from "@/shared/contract";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { confirmsRemoval } from "../model/projects";

export const REMOVE_WARNING = "Its threads are removed from BB too. This cannot be undone.";

export interface RemoveProjectConfirmationProps {
  projectName: string;
  /** Runs once the name is typed exactly and Remove project is pressed. */
  onConfirm(): void | Promise<void>;
  /** Draws a Cancel button that calls this; omitted where the confirmation sits in a page. */
  onCancel?(): void;
}

/** The warning, the field for the project's name and the Remove project button, enabled by an exact match. */
export function RemoveProjectConfirmation({ projectName, onConfirm, onCancel }: RemoveProjectConfirmationProps) {
  const [typed, setTyped] = useState("");
  const [pending, setPending] = useState(false);
  const matches = confirmsRemoval(typed, projectName);
  return (
    <form
      className="grid gap-3"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!matches || pending) return;
        setPending(true);
        try {
          await onConfirm();
        } finally {
          setPending(false);
        }
      }}
    >
      <p className="text-sm text-muted-foreground">{REMOVE_WARNING}</p>
      <label className="grid gap-1 text-sm">
        <span>
          Type <strong className="font-semibold">{projectName}</strong> to confirm
        </span>
        <Input value={typed} onChange={(event) => setTyped(event.target.value)} aria-label="Project name" />
      </label>
      <div className="flex justify-end gap-2">
        {onCancel !== undefined ? (
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
        <Button type="submit" disabled={!matches || pending}>
          Remove project
        </Button>
      </div>
    </form>
  );
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Removes the project from bb, then has the plugin's server forget its colour
 * and icon. The returned promise resolves with whether bb removed it; a
 * refusal is toasted.
 */
export async function removeProject(
  sdk: PluginBrowserBbSdk,
  rpc: PluginRpcClient<RpcContract>,
  projectId: string,
): Promise<boolean> {
  try {
    await sdk.projects.delete({ projectId });
  } catch (error) {
    toast.error(messageOf(error) || "Failed to remove project.");
    return false;
  }
  try {
    pluginData.appearanceSignal(await rpc.call("forgetProject", { projectId }));
  } catch {
    // The project is gone; its colour and icon are only a leftover the next sync of the appearance drops.
  }
  return true;
}
