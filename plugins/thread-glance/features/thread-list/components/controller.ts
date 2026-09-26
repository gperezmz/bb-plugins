// What rows and headers are given to act with. The list keeps one object
// while the settings it carries hold still; its callbacks read the latest
// state, so a thread changing never renews it.
import { createContext } from "react";
import type { PluginSidebarSection, PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import type { Stamps } from "@/shared/contract";
import type { HarnessIcon, OrganizationMode } from "@/shared/preferences";
import type { ThreadNotes } from "@/shared/contract";
import type { Family } from "../model/families";
import type { RowMenuAction } from "../model/menu";
import type { OlderRow, ThreadRow } from "../model/view";
import type { ProviderDisplay } from "./ProviderBadge";

export interface ModelInfo {
  /** The catalog's display name ("Haiku 4.5"), or the raw id when unknown. */
  model: string;
  reasoningLevel: string;
}

export interface RowController {
  compact: boolean;
  comfortable: boolean;
  setEditingId(id: string | null): void;
  showPullRequests: boolean;
  harnessIcon: HarnessIcon;
  /** Undefined while unknown; the lookup starts on first ask. */
  defaultBranchOf(thread: PluginSidebarThread): string | null | undefined;
  multiHost: boolean;
  /** One object per harness, the same one on every call. */
  provider(providerId: string): ProviderDisplay;
  sections: readonly PluginSidebarSection[];
  mode: OrganizationMode;
  onNavigate(): void;
  onToggleChip(row: ThreadRow): void;
  onToggleOlder(row: OlderRow): void;
  /** Opens a family's children from its "+N more" line in Needs attention. */
  onOpenChildren(rootId: string): void;
  onToggleEnvironment(environmentId: string): void;
  onMenuAction(action: RowMenuAction, thread: PluginSidebarThread, sectionId?: string | null): void;
  onRename(threadId: string, title: string): Promise<void>;
  loadModel(threadId: string, status: string): Promise<ModelInfo | null>;
  openDetails(threadId: string): void;
  /** Opens a new thread in an environment (folder menu). */
  onNewThreadInEnvironment(environmentId: string, projectId: string, sectionId: string | null): void;
  onRenameEnvironment(environmentId: string, name: string): Promise<void>;
  onArchiveEnvironment(environmentId: string): void;
}

/**
 * What changes with every event and only open details read: rows get their
 * own slice as props instead, so one thread changing renders one row.
 */
export interface ListLive {
  now: number;
  stamps: Stamps;
  notes: Readonly<Record<string, ThreadNotes>>;
  familyOf(threadId: string): Family | undefined;
}

export const ListLiveContext = createContext<ListLive>({
  now: 0,
  stamps: { startedAt: {}, finishedAt: {}, pendingAt: {}, seenAt: {} },
  notes: {},
  familyOf: () => undefined,
});
