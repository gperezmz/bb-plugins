# Unattendish: the Fleets page, the Fleet chip and the Fleet tab

```mermaid
flowchart LR
  poll["A poll or a manager's turn ending<br/>reads the manifest"] --> state[("Registration, cursors,<br/>ledger, sent actions,<br/>seen Inbox rows")]
  state --> page["Fleets page:<br/>fleet board and queue"]
  state --> chip["Fleet chip"]
  state --> tab["Fleet tab"]
  poll -->|a new Inbox row| toast["Toast in every window"]
  poll -->|a fleet that newly needs an account| needs["Toast with Connect…"]
  needs --> connect["Connect popup"]
  page -->|Connect… Renew…| connect
  tab --> connect
  page -->|Answer… Grant… Build it| manager["Manager thread"]
  tab -->|the same actions| manager
  manager -->|writes to the tracker| service["Tracker and forge"]
  service --> poll
```

What the operator sees of their fleets. The pages only read what the plugin keeps, send the manager a message when the operator acts, and open **Connect…** to give a fleet an account; they write nothing to a tracker or forge. Source: [`views.ts`](../../plugins/unattendish-sdlc/src/fleet/application/views.ts) (what the pages read), [`rpc.ts`](../../plugins/unattendish-sdlc/src/fleet/adapters/rpc.ts), [`app.tsx`](../../plugins/unattendish-sdlc/app.tsx). To do the jobs, see [answer, grant or build from the dashboard](../how-to/unattendish-answer-from-the-dashboard.md) and [connect a fleet to an account](../how-to/unattendish-connect-a-fleet.md). The words are defined in the [Unattendish glossary](../../plugins/unattendish-sdlc/GLOSSARY.md).

## What the numbers count

| Count | What |
|---|---|
| Blocked | The Blocked rows |
| In flight | The In flight rows |
| Waits on you | Every Inbox row of the fleet: rows the plugin cannot read, rows waiting for `other`, and rows whose action is *sent* all count, since each still waits until the manager acts |
| Landed in the last 7 days | The Landed rows merged in the 7 days before now. A row whose time cannot be read is left out |

A fleet whose manifest is missing or unreadable counts zero in each. The title bar's count and the navigation's are every fleet's Waits on you, Inbox rows alone: a fleet half that needs an account adds nothing to it, since the fleet board offers **Connect…** for it instead. Neither shows at zero.

## The Fleets page

Open it from **Fleets** in bb's navigation. It is the **fleet board** over the **queue**. An Inbox row's age, a fleet's "late" time and a manager's idle time count from the server's clock.

### The fleet board

One line for each fleet that is not quiet, in this order, left to right.

| Part | What it shows |
|---|---|
| Name | The forge's logo (GitHub's; GitLab shows its name) and the fleet's name. Where the tracker is Linear or Jira, its name and key follow: Linear's team key, Jira's project key. A tracker that is the forge's issues adds nothing |
| Manager | A turning icon while it works, with no time, since the plugin cannot know how long; a cup with how long it has been idle; a red person with a cross when its thread is archived or gone. The icon's accessible name and hover text say the state. How long is the thread's last update, which is approximate |
| Status | Four fixed slots in this order: Blocked, In flight, Waits on you, Landed in the last 7 days. A count of zero leaves its slot empty and the others keep their places. Hovering a slot names its count, and the header lists the four |
| Spend | The manager's thread tree's total from Thread Usage, "since this manager started". Empty, with no error, where Thread Usage is not installed or its answer cannot be read. Cached for 30 seconds |
| Polling | Empty while polling is healthy. `not yet` where the fleet has never been polled; amber `9m late` where the last poll is more than twice the fleet's poll interval ago |
| Fix | The first of the fleet's problems and warnings as a coloured verb, with the full sentence on hover, and `+N` when there are more, in which case the hover lists every sentence. See below |
| Fleet tab | An icon that opens the manager's thread on its Fleet tab |

A problem is red, a warning amber, and a fleet with either has a bar of that colour on the left edge of its line. A fleet with both is red. The fix verb is one of these, in the order a fleet's flags are ranked:

| Flag | Kind | Shown as | Opens |
|---|---|---|---|
| The manifest is missing or unreadable | Problem | **Review** | The Fleet tab |
| Manifest rows the plugin cannot read | Problem | **Review** | The Fleet tab |
| A half no account reads, or whose credential the service refuses or cannot read the repository with | Problem | **Connect…** | The [Connect popup](../how-to/unattendish-connect-a-fleet.md#connect-a-half) for that half |
| The manager thread is archived or gone | Problem | A red ✕, whose sentence says to run `/run-fleet` in a new thread to take the fleet over | Nothing |
| Any other [`notWatched` reason](unattendish-fleet-contract.md), or an outage the poll found | Problem | A red ✕ | Nothing |
| A credential that expires within 7 days, or has expired | Warning | **Renew…** | The Connect popup, to renew it |
| Polling is late or has never run | Warning | Nothing: the polling cell says it | Nothing |

A credential sharing the agents' rate limit is a warning on the fleet's card and not on the board.

Fleets are listed with problems first, then warnings, then the rest with the most waiting first and ties in name order. A **quiet fleet**, with every Status count at zero, no problem and no warning, is folded under one line, `N quiet fleets`, which unfolds them when pressed. Clicking a line, anywhere but its buttons, or its name, filters the queue to that fleet; the line shows as selected and a chip with the fleet's name and an ✕ appears beside the queue's tabs. Clicking the line again or the ✕ clears the filter. A fleet selected as the filter is listed even if it is quiet. The Fleet tab icon, **Connect…**, **Renew…** and **Review** act without changing the filter.

### The queue

One list of every Inbox row across fleets, oldest first. Its tabs:

| Tab | Lists |
|---|---|
| All | Every row, the unreadable ones among them |
| Answer | Rows waiting for `answer` |
| Grant | Rows waiting for `grant` |
| Build | Rows waiting for `ready` |
| Other | Rows waiting for `other` |
| Unreadable | Rows the plugin cannot read; the tab shows only while there is one |
| Sent | The actions seen done in the last hour, set apart by a divider: `You answered #5 Which queue · 40m ago · done`. An action still *sent* shows on its row in the queue instead |

Each tab shows its count; with the queue filtered to one fleet the counts and the lists cover that fleet only, and the fleet is left off each row. A row shows, in this order:

| Part | What |
|---|---|
| Kind | The icon of what it waits for: a speech bubble for an answer, a merge icon for a grant, a rocket for a ready label, a dashed circle for something else |
| Title | Its Ref and What |
| Link | A short link to the item on the tracker or forge, such as `#7 ↗` |
| Age | How long it has waited, amber after 8 hours |
| Fleet | The forge's logo and the fleet's name |
| Action | See [Actions](#actions) |

A row waiting for `other` has its link and no action: the cell reads `watch only`. A row the plugin cannot read is a red line, `Unreadable Inbox row, line N: <reason>`, with **Review**, which opens that fleet's Fleet tab; it counts as waiting.

### Around the board and queue

| State | The page shows |
|---|---|
| Loading | Grey bars in the shape of the board and the queue |
| No data and an error | `Couldn't load your fleets` with the error and **Try again**, which reloads at once. The page retries every minute |
| A refresh fails over data already shown | The data stays, and an amber pill in the title bar reads `3m old`, the age of the data, with a reload button. Hovering it gives the error |
| No fleet registered | `No fleet is registered`, and that a fleet appears once `/run-fleet` from unattendish-sdlc runs with this plugin installed |
| Empty Inbox | `Nothing waits on you`. The tabs stay, and Sent still lists what was done in the last hour |

### On a compact viewport

Below 768 px a fleet is named by its [short name](../../plugins/unattendish-sdlc/GLOSSARY.md): the end of its name, with as many segments as tell it apart from every other registered fleet, so `github.example/org/dash` reads `dash` until another fleet ends in `dash`. The board's lines, the queue's rows, the Sent tab's lines and the filter chip use it, and each keeps the full name as its accessible name; the composer still names the full fleet. The filter chip's ✕ is touch-sized.

The board shows three lines: each has the fleet's logo and short name, a ⚠ for a problem or a key for a warning that **Renew…** fixes, and its non-zero Status counts. The rest fold under `N more fleets`. Tapping a line filters the queue as above. The ⚠ or key is a touch-sized button that does what the verb does, since a phone has no hover; its accessible name is the full sentence. The tabs are pills.

Each queue row is three parts, one under the other:

| Part | What |
|---|---|
| Title | The kind's icon, then the Ref and What across the row's width, wrapping onto a second line; only a title longer than two lines is cut with `…` |
| Details | The fleet's logo and short name (left out while the queue is filtered to one fleet), the link and the age. The link shows its short form (`#7 ↗`, `!3 ↗`, `ENG-212 ↗`) or `↗` alone, its full text the accessible name, with a touch-sized tap area. A short name too wide to share the line takes it whole, and the link and the age go under it |
| Action | The row's buttons across its width, each touch-sized, Grant… and Re-grant half each. Every other state is its text at the buttons' height, so the row keeps its height: `composing…`, `sending…`, `checking…`, `sent · 4m`, `done`; `watch only` takes a line of its own height. A refused Build it or Re-grant shows `Not sent: <reason>` in red under the buttons, and a send that could not be confirmed shows `could not confirm whether the last send went through` |

## The fleet card

What the Fleet tab opens on and the Fleet chip shows on hover: the board's line in full.

| Line | What |
|---|---|
| Name | The repository, with a link that opens the manager's thread on its Fleet tab |
| Manager | `working`; `idle` and for how long; or `no manager` when its thread is archived or gone. A thread bb did not answer for also reads `no manager`, without the problem a gone manager raises |
| Counts | Waits on you, in flight, blocked and landed in 7d (the last 7 days), a count of zero left out |
| Cost | As the board's Spend |
| Polled | When the fleet was last polled |
| Accounts | One line for the `forge` and one for a `tracker` of its own: what it reads (`acme/web`, `team ENG`, `OPS`), `reads as GitHub · yuser` or `no account yet`, **can write** where the credential can, and what it needs. A half that needs something offers **Connect…**; a half that is read offers **Change account…**. Both open the Connect popup for that half |
| Reasons | The fleet's problems: the [`notWatched` reasons](unattendish-fleet-contract.md), an outage the poll found, how many manifest rows cannot be read and in which sections, and a manager whose thread is archived or gone. Each links to where it is put right: a credential reason to **Connect…**, a missing or unreadable manifest or unreadable rows to the Fleet tab; a gone manager has none |
| Warnings | A credential the service says expires within 7 days, or has expired (`token expires in 3 days`, `token expires today`, `token expired 2 days ago`), with the credential and **Renew**; for a `gh` or `glab` login, that it shares the fleet's agents' rate limit; and polling that is late (`polling is late`, with when it was last polled) or has never run (`not polled yet`) |

## The Fleet chip

A button in a manager thread's header, shown only on a thread that holds a registration. It spells out the card's counts, leaving out any that is zero: `1 waits on you · 3 in flight · 1 blocked · 2 landed in 7d`, or `Fleet idle` when all are. Counts of up to 45 characters share one line; longer ones are set on two short lines inside the same header row. Its accessible name always carries every count. Hovering shows the card; clicking opens the Fleet tab. On a compact viewport it shows only the Waits on you count, or a dot with none, and tapping it opens the tab.

## The Fleet tab

Opened from the chip, from the board's Fleet tab icon or **Review**, from a card's link, or from **Fleet** in a thread panel's new-tab Actions list, on any thread. On a thread that holds no registration it says so and names the manager holding the thread's repository, where there is one. On a manager it shows:

| Section | What |
|---|---|
| Card | The fleet's card |
| Inbox | The rows in a table, with the same actions as the queue |
| In flight | Each row's stage, how long it has been at it, a link to its builder thread and to its item |
| Blocked | Each row and what it is blocked on |
| Landed | The last 7 days, with links to the pull requests |
| Backlog, Set aside, Standing orders and any other section | As the manifest writes them |
| Unreadable rows | Each row the plugin cannot read, with its section, line and the column |
| Watched set | Each item and why it is in it: `named in In flight`, `named in Inbox`, `named in Blocked`, `blocked on <Ref>`, or `carries the spec label` or `carries the ready label` |
| Credentials | Each credential the fleet uses: the account it is read as beside it, its kind, **can write** where it can, its expiry date or `no expiry reported`, and whether it shares the agents' rate limit |
| Polling | The poll interval, when the fleet was last polled and the requests spent this hour |
| Ledger | The fleet's [ledger](unattendish-cli.md#bb-unattendish-fleet-ledger), filterable by item and by what was done, with dropped changes grouped by reason and a count for each, so a noisy echo source stands out; a Jira poll cut off at its page limit shows as `out of scope: listing cut at its page limit`, with the window it listed and the last update it reached where a change shows its ref, kind and actor. A change shows once: under All the list holds the changes that were not dropped, and the groups hold the dropped ones; an item filter hides the wakes, which name no item |

A table shows at most 200 rows, and the queue at most 400 in all; the counts are of every row. The ledger shows at most 250 changes, as the command does.

## Toasts

A fleet that newly needs an account raises a toast in every open bb window, led by a red plug. Its title is `<fleet> can't be read`, the server's sentence for what it needs is under it, and its button **Connect…** opens the popup over the view that is open. There is one toast for each half of a fleet, so a signal delivered twice raises one. It appears when a fleet becomes not watched for want of an account, a credential the service refuses, or a credential that cannot read the repository, and not again while the reason stays.

When a poll or a manager's turn ending shows an Inbox row never seen before for its repository, every open bb window shows a toast. Its title is the item, such as `#7 Which cache to use`, led by the icon of what the row waits for, and the line under it is the forge's logo and `<fleet> waits for <your answer | a grant to merge | your ready label | something else>`. Its button **Open Fleets** opens the Fleets page. A row is told apart by its Ref, what it waits for, its Since and, for a row with no Ref, its Link.

The plugin keeps which rows it has seen for each repository, so opening a window, reloading, restarting bb and taking a fleet over toast nothing. Registering a fleet whose manifest can be read records its rows without a toast; registering one whose manifest is missing records none, so the first rows the manager writes toast.

## Actions

An action sends the manager one message, a plain prompt in the operator's voice with nothing that names the plugin. The manager acts on the tracker as it always does; the plugin sends no write.

| Action | On an Inbox row waiting for | The message | Done when a poll sees |
|---|---|---|---|
| Answer… | `answer` | `Answer to <Ref>: ` and the operator's text, or `Answer to message <n>: ` where Ref is `—` | The row gone from the Inbox, the Inbox [read whole](#an-inbox-row-that-cannot-be-read-holds-actions-back) |
| Grant… | `grant` | `Grant: ` and the operator's text | The row gone from the Inbox, the Inbox [read whole](#an-inbox-row-that-cannot-be-read-holds-actions-back) |
| Re-grant | `grant`, where the Link names a previous manager's message | `Grant: ` and the row's What | The row gone from the Inbox, the Inbox [read whole](#an-inbox-row-that-cannot-be-read-holds-actions-back) |
| Build it | `ready` | `Build <Ref>` | The spec carrying the ready label, or the row gone from the Inbox, the Inbox [read whole](#an-inbox-row-that-cannot-be-read-holds-actions-back) |

Answer… and Grant… open a composer under the row. Its header reads `Your answer for #7 Which cache to use · goes to org/dash's manager`, beside a link to the item or the park, and its hint `⌘↵ send · Esc cancel`. The text takes several lines, follows the prefix and runs to the end of the message; ⌘/Ctrl+Enter sends, Esc cancels, and nothing sends while it is empty. A compact viewport has no such keys and leaves the hint out. The message is queued behind a running turn.

An action is *sent* once bb accepts the message, and *done* once a poll or a manager's turn ending sees its result. The plugin keeps it, so every window shows the row's action cell as `sent · 4m` and no action, after a reload too. While the call is in flight the cell reads `sending…`, while the words are being written `composing…`, and a Build it that a poll saw done while its row is still in the Inbox reads `done`. A sent action is never marked failed for waiting. A done action leaves the queue with its row and is listed under Sent for an hour, then dropped from the page, and the plugin deletes it after a day. If bb refuses the message, an Answer… or Grant… composer stays open with the draft and its footer reads `Not sent: <reason>`, such as `Not sent: HTTP 409: Thread is archived`; a refused Build it or Re-grant, which have no composer, shows a red `not sent` beside the row's title with the reason on hover. The row keeps its action. The reason is bb's message cut to 160 characters, with the text you sent and any configured token replaced; it reaches only the page, never the ledger or the log, where a refused wake is recorded as its status alone. If the call fails with no answer, the cell reads `checking…` until the page has fetched what the plugin recorded, and then shows that.

Esc or Cancel discards what was typed; a refusal keeps it in the open composer.

### An Inbox row that cannot be read holds actions back

A row the manifest reader names unreadable is left out of the rows a poll compares an action against, so an action sent for it would look gone. While any Inbox row of a fleet cannot be read, no poll marks an action of that fleet done because its row is missing, whichever row the action was sent for. A Build it whose spec carries the ready label is still marked done, since that reads the tracker and not the Inbox. An answer, a grant or a Build it without the label then stays *sent* with no row to show it, and appears nowhere, not under Sent either, until the Inbox reads whole again; the fleet's problem with **Review** says why. Once it does, actions are judged as usual. A manifest that is missing or cannot be read marks nothing done, and an unreadable row in In flight, Blocked or Landed holds nothing back.

A takeover drops the actions still *sent* on the fleet, since the new manager never received them, and the rows offer their actions again. A message sent while a takeover happens is refused with a reason, because it went to the manager the fleet no longer has.

## Live updates

The pages refetch when the server publishes `board-changed`, at most once a second whatever the number of polls, when a connection returns, and every 60 seconds. `inbox-new` carries a new row's fleet, Ref, What (cut to 500 characters), id, what it waits for (`waitsFor`) and the forge's service (`forge`, `github` or `gitlab`), so the toast draws its icon, line and logo without a fetch. `fleet-needs` carries a fleet, its manager's thread, the half (`forge` or `tracker`) and what it needs, for the Connect… toast.
