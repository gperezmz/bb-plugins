// Host icon names the list draws outside the state model. Components take
// names from here so one test can check them all against the host list.

export const ICONS = {
  archive: "Archive",
  unarchive: "ArchiveRestore",
  more: "MoreHorizontal",
  openInSplit: "Columns2",
  copy: "Copy",
  link: "ExternalLink",
  markRead: "MailOpen",
  markUnread: "Mail",
  pin: "Pin",
  unpin: "PinOff",
  moveToSection: "SectionMove",
  rename: "Edit",
  remove: "Trash2",
  details: "Info",
  crossGroup: "FolderExport",
  hidden: "EyeOff",
  show: "Eye",
  expand: "ChevronRight",
  collapse: "ChevronDown",
  moveUp: "ChevronUp",
  newThread: "Plus",
  newSection: "SectionAdd",
  customize: "SlidersHorizontal",
  check: "Check",
  pullRequest: "GitPullRequest",
  branch: "GitBranch",
  worktree: "FolderGit",
  machine: "Laptop",
  environmentFallback: "Zap",
  filter: "FilterHorizontal",
  drag: "DragDropVertical",
  move: "MoveTo",
  open: "ArrowUpRight",
} as const;

export const ROW_ICON_NAMES: readonly string[] = Object.values(ICONS);

/** Glyphs the group header counters draw. */
export const COUNTER_ICON_NAMES: readonly string[] = ["CircleQuestion", "CircleX", "CloudOff", "Loading"];
