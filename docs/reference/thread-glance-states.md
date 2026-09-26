# Thread Glance: states and glyphs

Every row shows one **state**, the first in this table that matches the thread. The glyph's tooltip and its screen-reader label name the state; Idle's ring has the tooltip only. Source: [`features/thread-list/model/state.ts`](../../plugins/thread-glance/features/thread-list/model/state.ts).

| # | State | When | Glyph | Colour |
|---|---|---|---|---|
| 1 | Waits on you | The thread waits on you: a question, an approval or a plan review | Question mark; a shield for an approval, a list for a plan | Amber |
| 2 | Failed | The thread's last run ended in an error | Circle with a cross | Red |
| 3 | Queued message failed | A queued message could not be sent | Warning triangle | Red |
| 4 | Machine offline | The thread waits for its machine to come back | Cloud with a slash | Amber |
| 5 | Working | Setting up, running, reconnecting or stopping | Spinner; a pencil while you have a draft open, a list in plan mode, a target with a goal | Blue |
| 6 | Background | The turn has ended but plan mode, a goal, a workflow, a background agent or a background command is still active | That activity's icon | Faint grey |
| 7 | Scheduled | A queued message has a send time in the future | Calendar; the tooltip gives the time | Grey |
| 8 | Queued | A queued message waits to be sent | Clock | Grey |
| 9 | Unread | The thread finished since you last read it | Filled dot | Blue |
| 10 | Draft | You have an unsent draft in its composer | Pencil | Grey |
| 11 | Idle | None of the above | Faint ring, smaller than the other glyphs, which screen readers skip | Faint grey |

A failed thread keeps its red glyph after you read it; reading it only stops it [needing attention](../explanation/thread-glance-attention.md). An unread thread's title is bold whatever its state. A [quiet thread](../explanation/thread-glance-attention.md#families-and-folding)'s title is dimmed, at any depth, and so is a root's once every thread in its family is quiet, chip included; anything running, unread, open or needing attention is drawn at full brightness. A child's title is one size smaller than its parent's.

When another plugin sets a status for a row, that status replaces the glyph in every state except waits on you, failed, and working with a spinner, as in bb's own list.

## The second line

A thread that waits on you or failed says why under its title. In the Needs attention section, every row that itself [needs attention](../explanation/thread-glance-attention.md) says why, finished and offline threads included; a row there that does not, such as a child opened with the chip, keeps the rule above.

| Starts with | Meaning | Tone |
|---|---|---|
| `Asks:` | The question it asked | Amber |
| `Approve:` | The command, file change or tool it wants to run | Amber |
| `Plan:` | The first line of the plan to review | Amber |
| `Needs:` | Any other request | Amber |
| `Failed:` | The error the provider reported, or that a queued message was not sent | Red |
| `Offline:` | The machine it waits for; Needs attention only | Amber |
| `Finished:` | The start of its last reply; Needs attention only | Grey |

The prefix stands alone when there is nothing to follow it. A thread with more than one reason shows the first in the table's order: waits on you, failed, offline, finished.

With **Comfortable** density, other rows use the second line for the branch (when it is not the project's default branch) and the machine (when threads run on more than one).

## The trailing slot

| Row | Shows |
|---|---|
| Working | How long it has been working, `<1m`, `4m`, `2h`, in blue |
| Waits on you | How long it has waited on you, muted |
| A root in Needs attention | The name of its home group, muted |
| Anything else | How long since it last finished: `now`, `5m`, `3h`, `2d`, `4w`, muted |

A thread that started before Thread Glance was installed has no start time, and shows no timer until its next run.

The logo of the thread's [harness](../explanation/how-the-plugins-fit-bb.md#threads-and-families) sits beside the time: the provider's logo, or a two-letter mark when the provider has none. The **Harness icon** preference draws it muted, in the provider's colour, or not at all.

## The chip

A parent thread carries a chip with the number of its children and the glyph of the most urgent thing among them, in this order: waits on you, failed, queued message failed, offline, working, unread. The chip is tinted amber for waits on you, red for a failure, blue for working, and neutral otherwise. Up to three child harnesses that differ from the parent's show as small logos beside it.

Which children count toward the chip, and which show without opening it, is set out in [what "Needs attention" means](../explanation/thread-glance-attention.md). A family's root carries the same chip in the Needs attention section.

## Group header counters

Each group header counts, over every [family](../explanation/how-the-plugins-fit-bb.md#threads-and-families) whose home is the group, those drawn in Needs attention included:

| Counter | Glyph | Shown |
|---|---|---|
| Wait on you | Question mark, amber | Always, when not zero |
| Failed | Circle with a cross, red | Always, when not zero |
| Offline | Cloud with a slash, amber | Always, when not zero |
| Working | Spinner | Only while the group is collapsed |
| Unread | Dot | Only on **More**, which holds hidden groups |

The wait-on-you, failed, offline and unread counters count threads that [need attention](../explanation/thread-glance-attention.md); working counts every thread that runs. The Needs attention section's own header counts its families. The counters sit at the right edge of the header, in line with the rows' ages; with the pointer over the header, or keyboard focus in it, the **+** and **…** buttons take their place.
