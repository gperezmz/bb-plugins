# Thread Glance: the list, its shelves and rows

```mermaid
flowchart TB
  scope["Project scope: All projects, or one project"]
  subgraph upper["Upper group"]
    pinned["Pinned"] --> active["Active"]
  end
  subgraph lower["Lower group"]
    working["Working, only when its setting is on"] --> inactive["Inactive"] --> snoozed["Snoozed"] --> parked["Parked"] --> settled["Settled"]
  end
  scope --> upper --> lower
```

The list is a [project scope](#project-scope) and then a column of [shelves](#shelves). Which shelf a thread sits on follows its [lifecycle row](#which-shelf-a-thread-is-on); what a row draws depends on the shelf. The settings that change the list are in [settings](thread-glance-settings.md), the actions on a row in [actions](thread-glance-actions.md), and [why the list keeps threads on shelves](../explanation/thread-glance-shelves.md) is its own page. Sources: [`shared/lifecycle.ts`](../../plugins/thread-glance/shared/lifecycle.ts) for the shelf rules, [`shared/busy.ts`](../../plugins/thread-glance/shared/busy.ts) for the busy rule and [`features/thread-list/model/list-model.ts`](../../plugins/thread-glance/features/thread-list/model/list-model.ts) for what the list draws.

## Project scope

The picker at the top of the list. **All projects** shows every shelf as it is; choosing one project limits every shelf to that project.

- It lists every project, the personal one included, with a filter field. The arrow keys move through the options and wrap, and Home and End jump to the first and last.
- It is not saved. Each time the list mounts it starts on All projects, and it falls back to All projects when its project disappears.

## Shelves

| Shelf | Icon | Open by default | Row | Sorted by |
|---|---|---|---|---|
| Pinned | `Pin` | Yes | [Full card](#full-card) | bb's pin order, which you can change by [reordering](thread-glance-actions.md#reordering) |
| Active | `Pulse` | Yes | Full card | The [Active sort](thread-glance-actions.md#active-sort), manual order by default |
| Working | `Loading`, spinning while the shelf has work, even under reduced motion | Yes | [Folded card](#folded-card) | Active's manual order |
| Inactive | `PauseCircle` | No | Full card | Active's manual order |
| Snoozed | `Clock` | No | [Slim row](#slim-row) | Soonest wake first |
| Parked | `Car` | No | Slim row | Newest park first |
| Settled | `Meditation` | No | Slim row | Newest settle first: 10 shown, then **Load N more** in pages of 25 |

- **Upper group** is Pinned, then Active. **Lower group** is Working (only with the **Working shelf** setting on), Inactive, Snoozed, Parked and Settled. With **Dock shelves to the bottom** on, the lower group sits at the bottom of the sidebar's viewport.
- A shelf header shows its icon and name, and "Name (count)" while the shelf is collapsed. A shelf with no threads is not drawn.
- Collapsing is per shelf and saved on the device. A collapsed shelf still shows the open thread and, with **Show children that need attention** on, any thread whose tree needs you or failed.
- The scroller has no scrollbar, and its edges fade by up to 12 px.

### While loading, and when empty

| Shown | When |
|---|---|
| "Loading threads…" with a spinner | The list has been loading for 200 ms. Its live region exists from the start |
| "Could not load threads." | Loading failed |
| **All clear** scene: "All clear. Time to touch some grass." and a small outline illustration | No pinned, Active, Working or Inactive thread is visible |
| **Working scene**: an animated outline typist and one of 18 lines | The Working shelf is on and every visible thread is on it. The line is drawn when the scene mounts and the next draw never repeats the previous one; the animation runs only without reduced motion |

## Which shelf a thread is on

Archived threads appear nowhere.

A child thread whose parent is visible in the current scope is not a row of its own: it appears under its parent's card, behind the [children chip](#children-chip). A child whose parent is archived, in another project or outside the scope is an ordinary row. A pinned child is a row of its own on Pinned and leaves its parent's chip and child list while it is pinned.

The server keeps a [lifecycle row](../../GLOSSARY.md) per thread. The shelf is the first of these that applies:

| # | Rule | Shelf |
|---|---|---|
| 1 | The thread is pinned | Pinned |
| 2 | The thread has no lifecycle row | Active |
| 3 | The thread is [busy](#busy-threads) | Active |
| 4 | The thread is parked, and no attention arrived after the park | Parked |
| 5 | The thread is snoozed, and has not woken | Snoozed |
| 6 | The thread is settled, and no attention arrived after the settle | Settled |
| 7 | Otherwise | Active |

Attention that arrives after a park or a settle brings the thread back to Active and clears the park or settle mark. A snooze ends at its wake time or on attention, and the thread is then [woke](#woke).

Pin is bb's own action, so a window that sees a pinned thread with a lifecycle row asks the server to clear the row, and unpinning returns the thread to Active under these rules.

Of the threads left on Active:

| Setting | Moves a thread to | When |
|---|---|---|
| **Working shelf** on | Working | Its tree is working, it is not woke and it does not need you |
| **Inactive shelf** on | Inactive | It is not busy, it does not need you, it is not woke, and its latest activity (the latest of created, updated and attention) is **Hours before inactive** ago or more |

A row being renamed keeps its shelf until the rename ends.

### Busy threads

One rule decides busy for the buttons, the server's checks, automatic settling and Reclaim. A thread is busy while any of these holds:

- a question or approval is pending;
- a queued message waits, or one failed;
- a turn is in flight;
- any activity counter is above zero: workflows, background agents, background commands, plan mode, goals;
- its runtime is starting, active or provisioning (the runtime's display status), which includes a runtime kept alive between turns by a running monitor.

A busy thread offers no Snooze, Park or Settle, and the server refuses all three.

### Woke

A snoozed thread wakes at its wake time or when attention arrives after the snooze. It is then on Active, in bold, with a **Woke** label and a **Dismiss Woke marker** button. Opening the thread, or dismissing the label, clears the marker. The marker is the same in every window and survives reloads. A woke thread offers no Snooze, and is never moved to Working or Inactive.

## Cards and rows

| Row | Lines | Used on |
|---|---|---|
| [Full card](#full-card) | 3 | Pinned, Active, Inactive, and a working thread unless it is folded |
| [Folded card](#folded-card) | 1 | Working, and working threads while **Compact working threads** is on |
| [Slim row](#slim-row) | 1, 32 px | Snoozed, Parked, Settled |

Heights are kept in one place, [`model/heights.ts`](../../plugins/thread-glance/features/thread-list/model/heights.ts).

### Full card

- Line 1: the project's icon and name, then the [status slot](#status-slot).
- Line 2: the title.
- Line 3: the branch, or the worktree branch, or the machine when there is no branch; then the [children chip](#children-chip); then a machine icon when both a branch and a machine exist; workflow and background-agent counts; the [pull request badge](#pull-request-badge); and the harness logo, always.

### Folded card

One line: project name · title, then the children chip, an unpin button and the live status with elapsed time or the age. It unfolds to a full card when the work ends, fails or needs you.

### Slim row

One line: project name · title and the shelf's label, with a button to restore the thread. The button shows on hover, always on touch. The thread's other actions are in the [thread menu](thread-glance-actions.md#thread-menu).

| Shelf | Label | Restore button |
|---|---|---|
| Parked | "Waiting Nd" | **Resume thread** |
| Snoozed | The wake time ("now", "Nm", "Nh" or "Nd", rounded up) | **Wake thread now** |
| Settled | The status slot's status, or the age | **Un-settle thread** |

### Stripe, colour and icon

With **Project colors** on, a 2 px stripe at a row's left edge shows the project colour, following **Show stripes in**. [Project colours and icons](thread-glance-settings.md#project-colours-and-icons) says how the colour, the icon and the monogram are chosen.

### On any row

- On hover, a card that is not busy and not woke shows **Snooze** and **Settle** in the status slot.
- Unread titles are bold; read idle titles are muted.
- The open thread's row is highlighted, and a row open in another pane is tinted.
- The **Unpin** button shows on hover, always on touch.
- Double-click renames inline. Enter or leaving the field saves a trimmed, changed title; Escape cancels.
- Inside a project group on Active, a card hides its project line ([Project sort](thread-glance-actions.md#active-sort)).

### Pull request badge

`#number` comes from bb for the thread's branch. Its colour follows bb's attention, as the [hover card](#hover-card) colours its label. Its tooltip is the pull request's title and label, and it opens the pull request in a new tab.

## Status slot

The 80 px, right-aligned slot shows one thing, the first that applies:

1. "Needs you" while a question or approval is pending.
2. "Send failed" or "Queued" for the queued message.
3. The indicator's label: Failed, Needs you, Unread, Working or Monitoring, Workflow, Agent, Command, Planning, Goal, Draft or Drafting.
4. Otherwise the age: "now", "Nm", "Nh", "Nd" up to 7 days, then "Nw", refreshed every minute.

Working-type labels add " · 5m" from when the thread was first seen working. That stamp survives reloads, and a fresh one starts after a pause.

| Label | Glyph | Colour |
|---|---|---|
| Failed | Circle with a cross | Red |
| Needs you | Question mark | Amber |
| Working | Spinner | Sky |
| Workflow, Agent, Command, Monitoring, Planning, Goal | A shining icon | Sky |
| Draft, Drafting | Pencil | Amber |
| Unread | Dot | Emerald |

Colours follow bb's theme, light or dark, not the operating system's.

## Children chip

On a parent's card:

- the number of its direct, non-archived children;
- up to three child marks;
- the most urgent glyph in the whole subtree: failed, then needs you, then done, then working;
- a chevron.

Its tooltip reads "N child threads, 1 failed, 2 need you…".

Opening the chip lists the children under the card. Which parents are open is saved on the device (the last 100 parents). A closed list still shows the path to the open thread and, with **Show children that need attention** on, children with a status.

Child rows have their own marks, titles and status or age, and a disclosure for their own children, named "Grandchildren", "Great-grandchildren" and "Descendants". A child from another project carries its project icon. Children sort and are marked by the [Child threads settings](thread-glance-settings.md#child-threads).

## Hover card

Opens 250 ms after the pointer rests on a row, never on touch, and closes 300 ms after the pointer leaves. Keyboard focus opens it at once. One card is open at a time, on the right of the row, 256 px wide. It shows:

- the title, project, machine and branch;
- the harness with its status glyph, model and reasoning level, loaded from bb: "Loading…", "Not set" or "Unavailable";
- the branch's pull request from bb, when it has one: `#number` and title, linking to it, with bb's attention as its label and its checks, review and mergeability on one line. No pull request, no section;
- "Subthreads (N)", with a toggle listing the direct children, each opening that child.

| Pull request label | Colour |
|---|---|
| Merged | Violet |
| Blocked, Changes requested, Checks failed, Conflicts, Closed | Red |
| Open (when bb reports no attention) | Emerald |
| Draft, Checks pending, Ready to merge, In merge queue, Review requested | Muted |

## Jump hints

Holding Ctrl (⌘ on Mac) alone for 700 ms shows "Ctrl + n" or "⌘ n" in the status slot of the first nine rows. Shift, Alt, another key, release or losing focus cancels it. bb performs the jump.
