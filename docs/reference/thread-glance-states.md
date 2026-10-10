# Thread Glance: states and glyphs

Every row shows one **state**, the first in this table that matches the thread. The glyph's tooltip and its screen-reader label name the state; Idle's ring has the tooltip only. Source: [`features/thread-list/model/state.ts`](../../plugins/thread-glance/features/thread-list/model/state.ts).

| # | State | When | Glyph | Colour |
|---|---|---|---|---|
| 1 | Waits on you | The thread waits on you: a question, an approval or a plan review | Question mark; a shield for an approval, a list for a plan | Amber |
| 2 | Failed | The thread's last run ended in an error | Circle with a cross | Red |
| 3 | Queued message failed | A queued message could not be sent | Warning triangle | Red |
| 4 | Machine offline | The thread waits for its machine to come back | Cloud with a slash | Amber |
| 5 | Working | Setting up, running or stopping | Spinner; a pencil while you have a draft open, a list in plan mode, a target with a goal | Blue |
| 6 | Background | The turn has ended but plan mode, a goal, a workflow, a background agent or a background command is still active | That activity's icon, shining | Grey |
| 7 | Scheduled | A queued message has a send time in the future | Calendar; the hover card and the row's screen-reader label give the time | Grey |
| 8 | Queued | A queued message waits to be sent | Clock | Grey |
| 9 | Unread | The thread finished since you last read it, and is not an [open thread](../explanation/thread-glance-attention.md#what-a-thread-needs-attention-for) | Filled dot | Blue |
| 10 | Draft | You have an unsent draft in its composer | Pencil | Grey |
| 11 | Idle | None of the above | Faint ring, smaller than the other glyphs, which screen readers skip | Grey |

A parent thread's glyph is chosen exactly as for a thread with no children, from its own state only, open or collapsed: an idle parent whose children are working shows the idle ring. What its children are doing is on its [children chip](#the-children-chip).

A failed thread keeps its red glyph after you read it; reading it only stops it [needing attention](../explanation/thread-glance-attention.md). An unread thread's title is bold whatever its state. A [quiet thread](../explanation/thread-glance-attention.md#trees-and-folding)'s title is dimmed, at any depth, and so is a root's once every thread in its tree is quiet, chip included; anything running, unread, focused or needing attention is drawn at full brightness. A child's title is the same size as its parent's at any depth; the indent and the ↳ mark show its depth.

When another plugin sets a status for a row, that status replaces the glyph in every state except waits on you, failed, and working with a spinner, as in bb's own list.

## The second line

A thread that waits on you or failed says why under its title, whatever the settings:

| Starts with | Meaning | Tone |
|---|---|---|
| `Asks:` | The question it asked | Amber |
| `Approve:` | The command, file change or tool it wants to run | Amber |
| `Plan:` | The first line of the plan to review | Amber |
| `Needs:` | Any other request | Amber |
| `Failed:` | The error the provider reported, or that a queued message was not sent | Red |

A row with nothing to follow the prefix has no second line. A finished, unread thread has none either: its dot and bold title say it.

While the [Branch line](thread-glance-preferences.md#branch-line) switch is on, a row with no note whose branch is not its project's default branch shows that branch on its second line, followed by its pull request badge when the branch has a pull request. Every other row is one line. [Density](thread-glance-preferences.md#density) sets how tall one-line and two-line rows are. Thread Glance asks bb for each project's default branch on the machine of the project's default source, and shows no branch line until bb answers.

## The pull request badge

The badge reads `#<number>`, coloured red when checks failed, the branch conflicts or changes were requested, green when it is ready to merge, and grey otherwise. It sits after the branch when the second line shows the branch. Otherwise, with Branch line on or off, it sits on the title line of a root whose branch is not its project's default branch.

The hover card and **Details** name the pull request with what the badge's colour stands for, and under it, while the pull request is open, whatever else bb knows of it: its checks, its review, whether it can merge, auto-merge, and the merge queue.

## The row's right end

Left to right, from the title to the row's end. On hover the children chip stays where it was, and the title gives up room only where the actions need more than the harness and machine leave. Source: [`features/thread-list/components/ThreadRowView.tsx`](../../plugins/thread-glance/features/thread-list/components/ThreadRowView.tsx).

| | Title | Harness and machine | Children chip | Trailing slot |
|---|---|---|---|---|
| At rest | The title, then the hidden badge on a hidden child, or the [pull request badge](#the-pull-request-badge) on a root | The [harness logo and machine name](#the-harness-logo-and-the-machine-name), where the row shows them | On a parent thread only | The time |
| On hover, or with keyboard focus in the row | Shortened where the actions need the room | bb's **Mark read**, while bb has the thread unread, and bb's **Archive**, in place of the harness and machine, which fade out | Unchanged, and still opens and closes the children | **…**, the thread's menu, in place of the time |

A row without children has no children chip and no space kept for one. A mouse click that leaves focus in a row, or a menu closed with the pointer, does not keep the hover look: the row is back at rest once the pointer leaves it. Focus counts only when the keyboard moved it there. Group headers follow the same rule.

What the menu, the keyboard and dragging do is in [menus, dragging and keys](thread-glance-actions.md).

On a phone nothing fades, and the row has no hover actions; a long press opens bb's menu drawer. While bb's thread shortcut modifier is held, the row's shortcut takes the place of the machine and the time.

## The trailing slot

The last column of every row, 4 px after the children chip. It is as wide as the **…** button or the widest time up to `99w`, whichever is wider, so the times line up down the list; a thread 100 weeks old or more widens its own row's slot.

| Row | Shows |
|---|---|
| Working | How long it has been working, `<1m`, `4m`, `2h`, in blue |
| Waits on you | How long it has waited on you, muted |
| Anything else | How long since it last finished: `now`, `5m`, `3h`, `2d`, `4w`, muted |

An archived row shows no time. A thread that started before Thread Glance was installed has no start time, and shows no timer until its next run.

## The harness logo and the machine name

A thread on a machine other than bb's primary machine shows the machine's name before the children chip, in both densities. A thread on the primary machine shows no machine, and while the list is grouped by machine no row does.

The logo of the thread's [harness](../explanation/how-the-plugins-fit-bb.md#threads-and-trees), the provider's logo or a two-letter mark when the provider has none, sits before the machine name only where the harness differs: on a root whose harness is not bb's default harness, and on a child whose harness is not its parent thread's. The **Harness icon** preference draws it muted or in the provider's colour.

## The children chip

A parent thread carries a chip just before its time: the number of its direct children and a chevron that opens and closes them. Hidden children are not counted; archived children are counted while archived threads are shown.

When a descendant, at any depth, is in one of these states, the chip leads with the glyph of the first of them found, smaller than a row's glyph, and its number and chevron take that glyph's colour. Otherwise the number and chevron are muted.

| # | Descendant state | Glyph on the chip | Colour |
|---|---|---|---|
| 1 | Waits on you | Question mark, whatever the descendant waits on; its own row shows which | Amber |
| 2 | Failed, and not read since | Circle with a cross | Red |
| 3 | Queued message failed | Warning triangle | Red |
| 4 | Machine offline | Cloud with a slash | Amber |
| 5 | Working | Spinner, still under reduced motion | Blue |
| 6 | Unread | Filled dot | Blue |

Archived descendants are left out. A hidden descendant adds only waits on you, failed, queued message failed and offline.

A parent whose only children are hidden keeps its chip while one of them shows a state, drawn with the state's glyph and the chevron but no number.

The chip looks the same whether the tree is open or closed. Another plugin's row status stays on the thread it is set on and never reaches a chip.

The chip's screen-reader label gives the number and names the state without counting it, for example "Show 2 child threads of Release, working below", since the number counts direct children and the state can come from any depth. With no number, it reads "Show hidden child threads of Release, waiting on you below". Opening the chip shows its direct children, and those rows plus the number on its `N more child threads` row, when there is one, add up to the chip's number. Which children show without opening it is set out in [what "Needs attention" means](../explanation/thread-glance-attention.md#trees-and-folding).

## The settled fold

Each group ends with a muted divider, `Settled (N)` while closed and `Settled` while open, with a hairline and a chevron. It holds the group's [settled](../explanation/thread-glance-attention.md#settled-threads) thread trees, and N counts trees. It is absent when no tree in the group is settled, and starts closed.

## The list header

The first row of the list, above every group:

| Item | Does |
|---|---|
| `Projects`, `Sections` or `Machines` | Names the current grouping. Clicking it does nothing: grouping changes in the settings panel |
| `N need you` | The [need-you filter](../explanation/thread-glance-attention.md#the-need-you-filter), N being the thread trees that need attention in every group, hidden ones included. Absent when N is 0 |
| Mark all read | [Marks every unread thread in the list read](thread-glance-actions.md#marking-threads-read), asking first above 20. Absent while no thread in the list is unread |
| Settings (sliders) | Opens the [settings panel](thread-glance-preferences.md#the-settings-panel) under the header, and closes it |

## Group header counters

Each group header counts over every [tree](../explanation/how-the-plugins-fit-bb.md#threads-and-trees) in the group, those behind folds included:

| Counter | Glyph | Shown |
|---|---|---|
| Wait on you | Question mark, amber | Always, when not zero |
| Failed | Circle with a cross, red | Always, when not zero |
| Offline | Cloud with a slash, amber | Always, when not zero |
| Working | Spinner | Only while the group is collapsed |
| Unread | Dot | Only on **More**, which holds hidden groups |

The wait-on-you, failed, offline and unread counters count threads that [need attention](../explanation/thread-glance-attention.md); working counts every thread that runs. The counters sit at the right edge of the header, in line with the rows' ages; with the pointer over the header, or keyboard focus in it, the **+** and **…** buttons take their place.
