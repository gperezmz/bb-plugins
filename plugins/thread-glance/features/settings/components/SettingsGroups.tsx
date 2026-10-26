// The groups of settings that are plain fields: Sidebar layout, Thread
// behavior and Child threads. Project appearance and Project management hold
// more than fields and have their own files.
import { Input } from "@/components/ui/input";
import { DAYS_BEFORE_AUTO_SETTLE_RANGE, HOURS_BEFORE_INACTIVE_RANGE, type Settings } from "@/shared/settings";
import { readSnoozePresets } from "@/shared/snooze";
import { Group, NumberRow, Row, SelectRow, SwitchRow, Select } from "./Fields";
import type { Form } from "./form";

export const THREAD_DISPLAY_CHOICES: readonly { value: Settings["threadDisplay"]; label: string }[] = [
  { value: "full-cards", label: "Full cards" },
  { value: "compact-working", label: "Compact working threads" },
  { value: "compact-all", label: "Compact all threads" },
];

export const CHILD_ORDER_CHOICES: readonly { value: Settings["childOrder"]; label: string }[] = [
  { value: "created", label: "Date created" },
  { value: "activity", label: "Last activity" },
];
export const CHILD_DIRECTION_CHOICES: readonly { value: Settings["childDirection"]; label: string }[] = [
  { value: "oldest", label: "Oldest first" },
  { value: "newest", label: "Newest first" },
];
export const CHILD_ICON_CHOICES: readonly { value: Settings["childIcon"]; label: string }[] = [
  { value: "colour-circle", label: "Colour circle" },
  { value: "provider-icon", label: "Provider icon" },
];

export function SidebarLayout({ form }: { form: Form }) {
  const { values, errors, edit } = form;
  return (
    <Group id="tg-sidebar-layout" title="Sidebar layout">
      <SelectRow
        label="Thread display"
        experimental
        description={
          values.threadDisplay === "compact-all"
            ? "Draw every Pinned, Active and Inactive thread as a one-line folded card, its branch, pull request and harness in the hover card. A thread that fails or needs you unfolds."
            : "Which Pinned, Active and Inactive threads draw as a one-line folded card. A thread that fails or needs you unfolds."
        }
        value={values.threadDisplay as Settings["threadDisplay"]}
        choices={THREAD_DISPLAY_CHOICES}
        onChange={(value) => edit("threadDisplay", value)}
      />
      {values.threadDisplay === "compact-all" ? (
        <>
          <SwitchRow
            label="Keep pinned as full cards"
            description="Draw pinned threads as full cards."
            checked={values.keepPinnedAsFullCards === true}
            onChange={(on) => edit("keepPinnedAsFullCards", on)}
          />
          <SwitchRow
            label="Keep woke as full cards"
            description="Draw a thread back from a snooze as a full card until you open it."
            checked={values.keepWokeAsFullCards === true}
            onChange={(on) => edit("keepWokeAsFullCards", on)}
          />
        </>
      ) : null}
      <SwitchRow
        label="Project icon only"
        description="Show only the project's icon on folded cards. Its name shows on hover and in the hover card."
        checked={values.projectIconOnly === true}
        onChange={(on) => edit("projectIconOnly", on)}
      />
      <SwitchRow
        label="Working shelf"
        experimental
        description="Move threads whose tree is working to their own shelf."
        checked={values.workingShelf === true}
        onChange={(on) => edit("workingShelf", on)}
      />
      <SwitchRow
        label="Inactive shelf"
        description="Move threads with no activity for a while to the Inactive shelf."
        checked={values.inactiveShelf === true}
        onChange={(on) => edit("inactiveShelf", on)}
      />
      <NumberRow
        label="Hours before inactive"
        description="Whole hours, 1 to 720."
        value={String(values.hoursBeforeInactive)}
        min={HOURS_BEFORE_INACTIVE_RANGE.min}
        max={HOURS_BEFORE_INACTIVE_RANGE.max}
        error={errors.hoursBeforeInactive}
        onChange={(typed) => edit("hoursBeforeInactive", typed)}
      />
      <SwitchRow
        label="Dock shelves to the bottom"
        experimental
        description="Keep the lower shelves at the bottom of the sidebar."
        checked={values.dockShelves === true}
        onChange={(on) => edit("dockShelves", on)}
      />
      <SwitchRow
        label="Group by worktree"
        description="Under the Project sort on Active, group threads that share a worktree under its branch."
        checked={values.groupByWorktree === true}
        onChange={(on) => edit("groupByWorktree", on)}
      />
    </Group>
  );
}

export function ThreadBehavior({ form }: { form: Form }) {
  const { values, errors, edit } = form;
  const shortcuts = String(values.snoozeShortcuts);
  return (
    <Group id="tg-thread-behavior" title="Thread behavior">
      <Row
        label="Snooze shortcuts"
        labelFor="tg-snooze-shortcuts"
        error={errors.snoozeShortcuts}
        description={
          <>
            Comma-separated durations (1h, 2d) or times (evening@18:00, tomorrow, next-week@09:00), each optionally named as Label=value.
            <span className="mt-1 block">Preview:</span>
            <ul aria-label="Snooze shortcut preview" className="mt-0.5 flex flex-wrap gap-1.5">
              {readSnoozePresets(shortcuts).map((preset) => (
                <li key={preset.id} className="rounded-sm bg-state-hover px-1.5 py-0.5 text-foreground">
                  {preset.label}
                </li>
              ))}
            </ul>
          </>
        }
      >
        <Input
          id="tg-snooze-shortcuts"
          value={shortcuts}
          aria-invalid={errors.snoozeShortcuts !== undefined}
          onChange={(event) => edit("snoozeShortcuts", event.target.value)}
          className="w-80"
        />
      </Row>
      <SwitchRow
        label="Settle quiet threads"
        description="Settle a thread with no open pull request once it has been quiet for the days below."
        checked={values.settleQuietThreads === true}
        onChange={(on) => edit("settleQuietThreads", on)}
      />
      <NumberRow
        label="Days before auto-settle"
        description="Whole days, 1 to 90."
        value={String(values.daysBeforeAutoSettle)}
        min={DAYS_BEFORE_AUTO_SETTLE_RANGE.min}
        max={DAYS_BEFORE_AUTO_SETTLE_RANGE.max}
        error={errors.daysBeforeAutoSettle}
        onChange={(typed) => edit("daysBeforeAutoSettle", typed)}
      />
      <SwitchRow
        label="Settle merged pull requests"
        description="A merged pull request settles its thread. Closed pull requests always count."
        checked={values.settleMergedPullRequests === true}
        onChange={(on) => edit("settleMergedPullRequests", on)}
      />
    </Group>
  );
}

export function ChildThreads({ form }: { form: Form }) {
  const { values, edit } = form;
  return (
    <Group id="tg-child-threads" title="Child threads">
      <SwitchRow
        label="Show children that need attention"
        description="Keep children with a status in a closed child list, and on a collapsed shelf or group."
        checked={values.showChildrenNeedingAttention === true}
        onChange={(on) => edit("showChildrenNeedingAttention", on)}
      />
      <Row label="Order" labelFor="tg-child-order" description="How a thread's children are sorted.">
        <div className="flex flex-wrap gap-2">
          <Select id="tg-child-order" value={values.childOrder as Settings["childOrder"]} choices={CHILD_ORDER_CHOICES} onChange={(value) => edit("childOrder", value)} />
          <Select
            label="Direction"
            value={values.childDirection as Settings["childDirection"]}
            choices={CHILD_DIRECTION_CHOICES}
            onChange={(value) => edit("childDirection", value)}
          />
        </div>
      </Row>
      <SelectRow
        label="Icon"
        description="A child's mark."
        value={values.childIcon as Settings["childIcon"]}
        choices={CHILD_ICON_CHOICES}
        onChange={(value) => edit("childIcon", value)}
      />
    </Group>
  );
}
