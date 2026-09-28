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
| 7 | Scheduled | A queued message has a send time in the future | Calendar; the hover card and the row's screen-reader label give the time | Grey |
| 8 | Queued | A queued message waits to be sent | Clock | Grey |
| 9 | Unread | The thread finished since you last read it | Filled dot | Blue |
| 10 | Draft | You have an unsent draft in its composer | Pencil | Grey |
| 11 | Idle | None of the above | Faint ring, smaller than the other glyphs, which screen readers skip | Faint grey |

A thread's glyph shows its own state, except on a parent thread whose [children chip](#the-children-chip) is closed: there it shows the most urgent state in its tree, as bb's own list does, with the [child dot](#the-child-dot) when that state is not the parent's own.

A failed thread keeps its red glyph after you read it; reading it only stops it [needing attention](../explanation/thread-glance-attention.md). An unread thread's title is bold whatever its state. A [quiet thread](../explanation/thread-glance-attention.md#trees-and-folding)'s title is dimmed, at any depth, and so is a root's once every thread in its tree is quiet, chip included; anything running, unread, open or needing attention is drawn at full brightness. A child's title is one size smaller than its parent's.

When another plugin sets a status for a row, that status replaces the glyph in every state except waits on you, failed, and working with a spinner, as in bb's own list.

## The child dot

While a parent thread's chip is closed, its glyph shows the first of these states found among its descendants, at any depth, when that state comes before the parent's own state in the table above:

| # | Descendant state |
|---|---|
| 1 | Waits on you |
| 2 | Failed, and not read since |
| 3 | Queued message failed |
| 4 | Machine offline |
| 5 | Working |
| 6 | Unread |

Where the parent's own state comes first, or is the same state, or no descendant is in any of these, the glyph shows the parent's own state. So a parent that is running background work keeps its glyph over an unread child, and a parent with a draft shows the unread dot of an unread child. A state from the tree is drawn with the glyph in the table above; waits on you takes the glyph of the first descendant waiting, so an approval shows the shield there too. Archived descendants are left out. A hidden descendant adds only waits on you, failed, queued message failed and offline.

When the glyph shows a state from the tree, a small grey dot, the child dot, sits at its lower right, set apart from the glyph by a ring of the sidebar's colour. It is grey whatever the state, so blue, amber and red on the glyph keep their meaning. With the parent's own state on the glyph there is no child dot.

While the chip is open, the children have rows of their own and the parent's glyph shows its own state.

The title is bold only when the parent itself is unread, whatever the glyph shows. A plugin's row status is judged against the glyph shown, by the rule above, and draws no child dot. The row's screen-reader label names the tree's state and then the parent's own, for example "Working, in child threads; unread".

## The second line

A thread that waits on you or failed says why under its title, in both densities:

| Starts with | Meaning | Tone |
|---|---|---|
| `Asks:` | The question it asked | Amber |
| `Approve:` | The command, file change or tool it wants to run | Amber |
| `Plan:` | The first line of the plan to review | Amber |
| `Needs:` | Any other request | Amber |
| `Failed:` | The error the provider reported, or that a queued message was not sent | Red |

A row with nothing to follow the prefix has no second line. A finished, unread thread has none either: its dot and bold title say it.

With **Comfortable** density, a row with no note whose branch is not its project's default branch shows that branch on its second line, followed by its pull request badge when the branch has a pull request. Every other row is one line. Thread Glance asks bb for each project's default branch on the machine of the project's default source, and shows no branch line until bb answers.

## The pull request badge

The badge reads `#<number>`, coloured red when checks failed, the branch conflicts or changes were requested, green when it is ready to merge, and grey otherwise. It sits after the branch when the second line shows the branch. Otherwise, in either density, it sits on the title line of a root whose branch is not its project's default branch.

## The row's right end

Left to right, from the title to the row's end. On hover the children chip stays where it was, and the title gives up room only where the actions need more than the harness and machine leave. Source: [`features/thread-list/components/ThreadRowView.tsx`](../../plugins/thread-glance/features/thread-list/components/ThreadRowView.tsx).

| | Title | Harness and machine | Children chip | Trailing slot |
|---|---|---|---|---|
| At rest | The title, then the hidden badge on a hidden child, or the [pull request badge](#the-pull-request-badge) on a root | The [harness logo and machine name](#the-harness-logo-and-the-machine-name), where the row shows them | On a parent thread only | The time |
| On hover | Shortened where the actions need the room | **Mark read**, on a root whose tree holds something unread, and **Archive**, in place of the harness and machine, which fade out | Unchanged, and still opens and closes the children | **…**, the thread's menu, in place of the time |

A row without children has no children chip and no space kept for one.

On a phone nothing fades, and the row has no hover actions; a long press opens the menu. While bb's thread shortcut modifier is held, the row's shortcut takes the place of the machine and the time.

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

A parent thread carries a muted chip just before its time: the number of its direct children and a chevron that opens and closes them. Hidden children are not counted; archived children are counted while archived threads are shown. The number is drawn in the unread dot's blue while any descendant, at any depth, that is neither archived nor hidden is unread, whether the chip is open or closed, and the chip's screen-reader label counts them, for example "Show 2 child threads of Release, 1 unread in the tree". Opening the chip shows its direct children, and those rows plus the number on its `N more child threads` row, when there is one, add up to the chip's number. Which children show without opening it is set out in [what "Needs attention" means](../explanation/thread-glance-attention.md#trees-and-folding).

## The settled fold

Each group ends with a faint divider, `Settled (N)` while closed and `Settled` while open, with a hairline and a chevron. It holds the group's [settled](../explanation/thread-glance-attention.md#settled-threads) thread trees, and N counts trees. It is absent when no tree in the group is settled, and starts closed.

## The list header

The first row of the list, above every group:

| Item | Does |
|---|---|
| `Projects`, `Sections` or `Machines` | Names the current grouping. Clicking it does nothing: grouping changes in the settings panel |
| `N need you` | The [need-you filter](../explanation/thread-glance-attention.md#the-need-you-filter), N being the thread trees that need attention in every group, hidden ones included. Absent when N is 0 |
| Mark all read | Marks every unread thread in the list read, in every group, hidden ones included. Above 20 threads it asks first, as a group's **Mark all read** does |
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
