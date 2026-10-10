// What a thread row adds to bb's thread menus: Thread Glance's own items,
// each in the bb group it belongs with. bb's items are bb's.
import { experimental_THREAD_ACTION_GROUPS as GROUPS } from "@get-bb/plugin-sdk/app";
import type { PluginSidebarSection, PluginThreadActionsInlineItem } from "@get-bb/plugin-sdk/app";
import type { Commands } from "../commands/commands";
import { ICONS } from "../icons";

/** bb's own actions a row's hover buttons run: Mark read and Archive. */
export const QUICK_ACTION_KEYS = ["bb--core/read", "bb--core/archive"] as const;

/** Where a thread sits among the sections. */
export interface SectionPlace {
  /** The thread's section; null in the loose Threads bucket. */
  sectionId: string | null;
  pinned: boolean;
  /** Only a root moves between sections. */
  root: boolean;
}

export interface InlineInputs {
  threadId: string;
  /** A root with an unread thread below it offers Mark tree read. */
  descendantsUnread: boolean;
  archived: boolean;
  place: SectionPlace;
  /** bb's sections; empty when the list offers no Move to section. */
  sections: readonly PluginSidebarSection[];
}

/** Ours reads differently from the built-in list's "Move to section", which ForeignMoveToSection tells apart by text. */
export const MOVE_TO_SECTION_LABEL = "Move to a section";

/** The choice that files a thread in the loose Threads bucket. */
const THREADS_CHOICE = "threads";
const SECTION_CHOICE = "section:";

const sectionOfChoice = (choice: string): string | null => (choice === THREADS_CHOICE ? null : choice.slice(SECTION_CHOICE.length));

/** Move to section: Threads and each section, the thread's current place disabled. */
function moveToSection(
  { threadId, place, sections }: Pick<InlineInputs, "threadId" | "place" | "sections">,
  commands: Commands,
): PluginThreadActionsInlineItem | null {
  if (!place.root || sections.length === 0) return null;
  const here = (sectionId: string | null) => !place.pinned && place.sectionId === sectionId;
  const choices = [
    { id: THREADS_CHOICE, label: "Threads", sectionId: null },
    ...sections.map((section) => ({ id: `${SECTION_CHOICE}${section.id}`, label: section.name, sectionId: section.id })),
  ];
  return {
    key: "thread-glance/move-to-section",
    group: GROUPS.organize,
    action: {
      label: MOVE_TO_SECTION_LABEL,
      icon: ICONS.moveToSection,
      choices: { items: choices.map(({ id, label, sectionId }) => ({ id, label, selected: here(sectionId), disabled: here(sectionId) })) },
      run: ({ value }) => {
        if (value !== undefined) commands.moveToSection(threadId, sectionOfChoice(value));
      },
    },
  };
}

export function inlineThreadActions({ threadId, descendantsUnread, archived, place, sections }: InlineInputs, commands: Commands): PluginThreadActionsInlineItem[] {
  const items: PluginThreadActionsInlineItem[] = [
    { key: "thread-glance/details", group: GROUPS.open, action: { label: "Details", icon: ICONS.details, run: () => commands.showDetails(threadId) } },
    { key: "thread-glance/copy-id", group: GROUPS.organize, action: { label: "Copy thread ID", icon: ICONS.copy, run: () => commands.copyThreadId(threadId) } },
  ];
  if (descendantsUnread) {
    items.push({
      key: "thread-glance/mark-tree-read",
      group: GROUPS.organize,
      action: { label: "Mark tree read", icon: ICONS.markRead, run: () => commands.markTreeRead(threadId) },
    });
  }
  if (!archived) {
    const section = moveToSection({ threadId, place, sections }, commands);
    if (section !== null) items.push(section);
    items.push({ key: "thread-glance/move", group: GROUPS.organize, action: { label: "Move…", icon: ICONS.move, run: () => commands.startMove(threadId) } });
  }
  return items;
}
