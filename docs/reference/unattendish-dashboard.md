# Unattendish: the Fleets page, the Fleet chip and the Fleet tab

```mermaid
flowchart LR
  poll["A poll or a manager's turn ending<br/>reads the manifest"] --> state[("Registration, cursors,<br/>ledger, sent actions,<br/>seen Inbox rows")]
  state --> page["Fleets page:<br/>fleet board and queue"]
  state --> chip["Fleet chip:<br/>the fleet header on hover"]
  state --> tab["Fleet tab:<br/>the fleet header over<br/>Work, Notes, Watching, Ledger"]
  chip -->|click| tab
  poll -->|a new Inbox row| toast["Toast in every window"]
  poll -->|a fleet that newly needs an account| needs["Toast with Connect…<br/>or Renew…"]
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
| Spend | The manager's thread tree's total from Thread Usage, "since this manager started". Where the manager's thread holds other fleets, `shared with <their names>` follows under it, since each of those fleets shows the same money. Empty, with no error, where Thread Usage is not installed or its answer cannot be read. Cached for 30 seconds |
| Polling | Empty while polling is healthy. `not yet` where the fleet has never been polled; amber `9m late` where the last poll is more than twice the fleet's poll interval ago |
| Fix | The first of the fleet's problems and warnings as a coloured verb, with the full sentence on hover, and `+N` when there are more, in which case the hover lists every sentence. See below |
| Fleet tab | An icon that opens the manager's thread on its Fleet tab, showing this fleet |

A problem is red, a warning amber, and a fleet with either has a bar of that colour on the left edge of its line. A fleet with both is red. The fix verb is one of these, in the order a fleet's flags are ranked:

| Flag | Kind | Shown as | Opens |
|---|---|---|---|
| The manifest is missing or unreadable | Problem | **Review** | The Fleet tab |
| Manifest rows the plugin cannot read | Problem | **Review** | The Fleet tab |
| A half no account reads, or whose credential the service refuses or cannot read the repository with | Problem | **Connect…** | The [Connect popup](../how-to/unattendish-connect-a-fleet.md#connect-a-half) for that half |
| A token whose expiry has passed: `token expired N days ago`, or `token expired today`, its days counted in your own calendar. Where the service also refuses it, or it counts as unable to read the repository, this is the half's only flag | Problem | **Renew…** | The Connect popup, to renew it |
| The manager thread is archived or gone | Problem | A red ✕, whose sentence says to run `/run-fleet` in a new thread to take the fleet over | Nothing |
| The manifest names another repository: the fleet is [left behind](#a-left-behind-fleet) | Problem | A red ✕, whose sentence names the repository the manifest names and the command that unregisters the fleet | Nothing |
| Any other [`notWatched` reason](unattendish-fleet-contract.md), or an outage the poll found | Problem | A red ✕ | Nothing |
| A token that has not expired yet but expires within 7 days: `token expires in N days`, the days counted up | Warning | **Renew…** | The Connect popup, to renew it |
| Polling is late or has never run | Warning | Nothing: the polling cell says it | Nothing |

A credential sharing the agents' rate limit is a warning on the fleet's card and not on the board.

Fleets are listed with problems first, then warnings, then the rest with the most waiting first and ties in name order. A **quiet fleet**, with every Status count at zero, no problem and no warning, is folded under one line, `N quiet fleets`, which unfolds them when pressed. Clicking a line, anywhere but its buttons, or its name, filters the queue to that fleet; the line shows as selected and a chip with the fleet's name and an ✕ appears beside the queue's tabs. Clicking the line again or the ✕ clears the filter. The chip is a shaded tag as tall as the tabs, with the fleet's logo and name and a small ✕. A fleet selected as the filter is listed even if it is quiet. The Fleet tab icon, **Connect…**, **Renew…** and **Review** act without changing the filter.

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

Each tab shows its count; the tabs are borderless and 24 px tall, the picked one shaded, in both layouts. With the queue filtered to one fleet the counts and the lists cover that fleet only, and the fleet is left off each row. In the [wide layout](#the-wide-and-narrow-layouts) a row is one line, in this order:

| Part | What |
|---|---|
| Kind | The icon of what it waits for: a speech bubble for an answer, a merge icon for a grant, a rocket for a ready label, a dashed circle for something else |
| Title | Its Ref and What, at least 12rem wide, cut with `…` where the line is too short for it |
| Link | A short link to the item on the tracker or forge, such as `#7 ↗`. A link with no short form shows its own text, cut with `…` past 16rem, its full text on hover and keyboard focus |
| Age | How long it has waited, amber after 8 hours, on one line |
| Fleet | The forge's logo and the fleet's name |
| Action | See [Actions](#actions). A send that could not be confirmed adds an icon beside the buttons, `could not confirm whether the last send went through` on hover and keyboard focus |

A row waiting for `other` has its link and no action: the cell reads `watch only`. A row the plugin cannot read is a red line, `Unreadable Inbox row, line N: <reason>`, with **Review**, which opens that fleet's Fleet tab; it counts as waiting.

### Around the board and queue

| State | The page shows |
|---|---|
| Loading | Grey bars in the shape of the board and the queue |
| No data and an error | `Couldn't load your fleets` with the error and **Try again**, which reloads at once. The page retries every minute |
| A refresh fails over data already shown | The data stays, and an amber pill in the title bar reads `3m old`, the age of the data, with a reload button. Hovering it gives the error |
| No fleet registered | `No fleet is registered`, and that a fleet appears once `/run-fleet` from unattendish-sdlc runs with this plugin installed |
| Empty Inbox | `Nothing waits on you`. The tabs stay, and Sent still lists what was done in the last hour |

### The wide and narrow layouts

The page draws its **wide layout**, the board and one line per queue row as above, wherever the page itself is at least 64rem wide, and its **narrow layout**, below, anywhere narrower: on a phone, and in a desktop window that bb's sidebar leaves narrow, such as a 1024 px window with the sidebar open. The width counted is the page's own, beside bb's sidebar, with a scrollbar drawn whether one shows or not, so the page goes wide up to one scrollbar's width later where nothing scrolls. 64rem is where the widest row the wide layout can hold still shows every part whole. The page switches as it is resized, with no reload, keeping an open composer with its draft, focus and caret, the queue's tab, its filter, every action's state, and whether each layout's board is unfolded.

In the narrow layout a fleet is named by its [short name](../../plugins/unattendish-sdlc/GLOSSARY.md): the end of its name, with as many segments as tell it apart from every other registered fleet, so `github.example/org/dash` reads `dash` until another fleet ends in `dash`. The board's lines, the queue's rows, the Sent tab's lines and the filter chip use it, and each keeps the full name as its accessible name; the composer still names the full fleet. The filter chip's ✕ is drawn small and has a 44 px tap area around it.

The board shows three lines: each has the fleet's logo and short name, a ⚠ for a problem or a key for a warning that **Renew…** fixes, and its non-zero Status counts. The rest fold under `N more fleets`. Tapping a line filters the queue as above. The ⚠ or key is a touch-sized button that does what the verb does; its accessible name is the full sentence. A tab has a tap area 32 px tall, and the tabs wrapped onto two rows keep their areas apart. The Fleet tab's Waits on you section draws the same buttons, with the 44 px tap areas on a phone. With a mouse or a keyboard, the ⚠ or key shows its sentences, each count its label, a short name the full name and a `↗` alone its link's text, on hover and keyboard focus, as the wide layout's icons do; a tap shows none of them.

Each queue row is three parts, one under the other:

| Part | What |
|---|---|
| Title | The kind's icon, then the Ref and What across the row's width, wrapping onto a second line; only a title longer than two lines is cut with `…` |
| Details | The fleet's logo and short name (left out while the queue is filtered to one fleet), the link and the age. The link shows its short form (`#7 ↗`, `!3 ↗`, `ENG-212 ↗`) or `↗` alone, its full text the accessible name, with a touch-sized tap area. A short name too wide to share the line takes it whole, and the link and the age go under it |
| Action | The row's buttons together at the end of the line, each 28 px tall and as wide as its label, with a 44 px tap area around it that reaches past what is drawn. Every other state is its text at the height the buttons take, tap areas included, so the row keeps its height: `composing…`, `sending…`, `checking…`, `sent · 4m`, `done`; `watch only` takes a line of its own height. A refused Build it or Re-grant shows `Not sent: <reason>` in red under the buttons, and a send that could not be confirmed shows `could not confirm whether the last send went through` |

## The fleet header

What the Fleet tab opens on and the Fleet chip shows on hover, in this order:

| Line | What |
|---|---|
| Fleet | The forge's logo, the fleet's name, and a tracker of its own as its name and key: Linear's team key or Jira's project key. GitHub shows its logo; GitLab, Linear and Jira show their names, since their trademark rules refuse third parties or forbid recolouring their logos |
| Manager | A turning icon in green while it works, with no duration, since the plugin cannot know how long it has worked; a cup in grey with how long it has been idle; a person with a cross in red when its thread is archived or gone. A thread bb did not answer for also shows no manager, without the problem a gone manager raises |
| Status | The four counts, each an icon and a number in its colour, a zero left out: blocked grey, in flight blue, waits on you amber, landed in the last 7 days purple |
| Spend | As the board's Spend, where there is one, followed by `shared with <their names>` where the manager's thread holds other fleets |
| Problems and warnings | Each as one strip tinted red or amber, with the server's sentence and its verb, in the board's order: **Connect…** for a half with no account or a credential connecting another account fixes; **Review** for a missing or unreadable manifest or rows that cannot be read; **Renew…** for a token that has expired, in red, or that expires within 7 days, in amber; none for a problem nothing on the page fixes, late or never-run polling, or a gone manager, whose sentence says to run `/run-fleet` in a new thread to take the fleet over |
| Last action | The action seen done most recently in the last hour whose row has left the Inbox: `You answered #5 Which queue · done 40m ago`. Left out with none |

## The Fleet chip

A button in a manager thread's header, shown only on a thread that holds a registration: the fleet icon, then, when at least one row waits on you, that count in amber. A small red dot on the icon marks a problem, an amber one a warning alone. With nothing waiting and no problem or warning it is the icon alone. Its accessible name gives the count and says when the fleet has a problem or a warning: `Fleet: 6 waiting on you, and it has a problem`.

A thread holding more than one fleet has one chip for all of them. Its count is the sum of their waiting rows, its dot is red when any of them has a problem, a left-behind fleet's included, and otherwise amber when any has a warning, and its accessible name says so: `2 fleets: 8 waiting on you, and a fleet has a problem`.

It is drawn like the controls beside it in bb's header, as tall as the header, with a border on desktop and none on a compact viewport, and never wraps. Hovering it shows the fleet header with `Click the chip to open the Fleet tab`; its **Review** opens the Fleet tab. A thread holding more than one fleet stacks one fleet header per fleet, in the [Fleet tab's order](#which-fleet-the-tab-shows), each fleet's name a button that opens the Fleet tab on that fleet and its **Review** opening it on that fleet at what needs reviewing. Clicking or tapping the chip opens the Fleet tab with no fleet named. A compact viewport has no hover card. While its data loads, or when it failed to load, it draws nothing.

## The Fleet tab

Opened from the chip, from the board's Fleet tab icon or **Review**, from a queue row's **Review**, or from **Fleet** in a thread panel's new-tab Actions list, on any thread. On a thread that holds no registration it reads `This thread runs no fleet.` and names the manager holding the thread's repository, where there is one, with a link to it. On a manager it shows one of the thread's fleets, as [below](#which-fleet-the-tab-shows): its fleet header over four tabs, each with a count; the tab bar stays at the top while the tab scrolls, and the arrow keys move between tabs. Work opens first.

| Tab | Its count | What |
|---|---|---|
| Work | The rows that wait on you, in amber | The manifest's rows, in four folding sections below |
| Notes | The sections the manifest writes | Backlog, Set aside, Standing orders and any other section, each under its own heading, rendered as Markdown; `Nothing written.` under a blank one |
| Watching | The items in the watched set | The watched set, the credentials and polling, below |
| Ledger | The reads that failed in the last 24 hours, in red; none when no read failed | The ledger, below. It loads when its tab first opens |

**Review** in the header opens Work at what needs reviewing: the section holding the first row the plugin cannot read, in section order, unfolded, scrolled to that row. When the manifest is missing, cannot be read or names another repository, Work and Notes show that in place of their content: `No manifest was found at the path the fleet registered.`, `The manifest cannot be read: <reason>`, or `The manifest now names <repository>, so nothing in it is this fleet's.`

### Which fleet the tab shows

A thread has one Fleet tab, which shows one of its fleets at a time. Where the thread holds more than one, the fleet's name in the header is a menu listing each, in the order below, with its waiting count in amber and a red dot for a problem or an amber one for a warning, the one shown checked. Picking one shows it in the header and in all four tabs. The menu opens with Enter, Space or the down arrow, the arrows, Home and End move in it, Enter or Space picks, and Escape closes it. A thread holding one fleet shows its name as plain text.

The fleets are ordered with those [left behind](#a-left-behind-fleet) last; within each group a problem comes before a warning before neither, then the most waiting rows first, then the name.

Every link that opens the Fleet tab for a fleet opens it on that fleet: the board's Fleet tab icon and **Review**, a queue row's **Review**, and the chip's fleet headers. Where the tab is already open, it switches to that fleet. Opened with no fleet named, from the chip or from the panel's Actions list, it shows the fleet it last showed for the thread, or the first in order where it has shown none since bb's window loaded. It stays on that fleet as the counts change, and when it is closed and opened again, until you pick another or a link names one; where the thread no longer holds it, the tab shows the thread's first fleet.

### A left-behind fleet

A fleet whose manifest's first line names another repository is **left behind**: run-fleet keeps one manifest per thread, so a thread that ran `/run-fleet` for one repository and later for another holds both registrations on the one file, which now names the second. A left-behind fleet shows none of that manifest's rows anywhere, none of the four Status counts, and no action; no new Inbox row raises a toast for it; and its watched set is its labelled items alone, as for a missing manifest. Its credential problems, and their **Connect…**, stay as for any fleet. It carries a problem saying what its manifest now names and how to unregister it, such as:

> Its manifest now names github.com/org/wake, so nothing in it is this fleet's. Unregister it with `bb unattendish fleet unregister github.com/org/dash`.

Once the manifest names the fleet again, it shows its rows at the next read.

### Work

Each section is a heading with its icon, its name and how many lines it lists; clicking the heading folds or unfolds it. Waits on you, In flight and Blocked start open, Landed folded. Each section lists the rows the plugin cannot read in it as red lines, `Unreadable row, line N: <reason>`.

| Section | Each row | When empty |
|---|---|---|
| Waits on you | Two lines: the icon of what it waits for and the title; then the item's short link with ↗ and its age, amber once it has waited 8 hours. The action sits at the right, with the queue's states and composer | `Nothing waits on you` |
| In flight | Its stage's icon in blue, the title, the short link, `<stage> for <duration>`, and **builder** linking to its builder thread where it has one | `Nothing in flight` |
| Blocked | The blocked icon, the Ref, its link, and `waits for <Ref>, <Ref>`, each Ref linking to its item where the watched set knows it | `Nothing blocked` |
| Landed | The merged icon, the title, its pull request's link, and `merged <date and time>` | `Nothing landed in the last 7 days` |

In flight's icons, by stage:

| Stage | Icon |
|---|---|
| building | A hammer |
| asking | A speech bubble |
| waiting on you | A bell |
| under review | An eye |
| at the bar | Scales |
| round open | Repeat arrows |
| brainstorming | A light bulb |

### Watching

| Block | What |
|---|---|
| Watched set | Each item's short link and why it is in it: `named in In flight`, `named in Inbox`, `named in Blocked`, `blocked on <Ref>`, or `carries the spec label` or `carries the ready label` |
| Credentials | A small card for each credential the fleet uses: the service's logo or name, the account, the half it reads (`reads the forge`), its kind, **can write** where it can, its expiry date (`expires 18 Oct`, or `expired 12 Oct` in red once it has passed) or `no expiry reported`, `shares the agents' rate limit` in amber for a `gh` or `glab` login, and **Change account…**, which opens the Connect popup for that half |
| Polling | `every <interval> · polled <age> ago · <n> requests this hour` |

### Ledger

The fleet's [ledger](unattendish-cli.md#bb-unattendish-fleet-ledger). A row of pills filters it by what was done (All, Woke, Dropped, Held, Failed reads, Wakes) and a search box by item. The changes are a timeline, newest first: each shows its time, its Ref, kind and actor, and what was done with it, marked by an icon in the outcome's colour: woke amber, dropped as an echo or out of scope grey, held grey, a failed read red. **Dropped, by reason** groups the dropped changes with a count for each, so a noisy echo source stands out; a Jira poll cut off at its page limit shows as `out of scope: listing cut at its page limit`, with the window it listed and the last update it reached where a change shows its Ref, kind and actor. **Wakes** lists the wakes. A change shows once: under All the timeline holds the changes that were not dropped, and the groups hold the dropped ones; an item filter hides the wakes, which name no item.

A section shows at most 200 rows, and the queue at most 400 in all; the counts are of every row. The ledger shows at most 250 changes, as the command does.

## Toasts

A fleet that newly needs an account raises a toast in every open bb window, led by a red plug. Its title is `<fleet> can't be read`, the server's sentence for what it needs is under it, and its button **Connect…** opens the popup over the view that is open. There is one toast for each half of a fleet, so a signal delivered twice raises one. It appears when a fleet becomes not watched for want of an account, a credential the service refuses, or a credential that cannot read the repository, and not again while the reason stays. Where the service refuses a token because it has expired, the line under the title says so instead, `<credential>: token expired N days ago`, and its button is **Renew…**, which opens the popup to renew that token. A token that expires before the service refuses it raises no toast: the fleet board says it.

When a poll or a manager's turn ending shows an Inbox row never seen before for its repository, every open bb window shows a toast. Its title is the item, such as `#7 Which cache to use`, led by the icon of what the row waits for, and the line under it is the forge's logo and `<fleet> waits for <your answer | a grant to merge | your ready label | something else>`. Its button follows what the row waits for:

| The row waits for | The toast's button |
| --- | --- |
| your answer | **Answer…** |
| a grant to merge | **Grant…** |
| your ready label, or something else | **Open Fleets**, which opens the Fleets page |

**Answer…** and **Grant…** open the Fleets page at the row, scrolled into view, with the composer its own button opens under it and its text box focused. A fleet filter or a tab that would hide the row is cleared to every fleet and All; one that already shows it stays. The row is judged on a view fetched after the click, so the page shows its loading state until it arrives, and where it can't load, Can't load, with no composer. A row whose action reads `sending…`, `checking…` or `sent · <age>` is shown with no composer, and a row that left the Inbox opens none and raises a short toast, `#7 Which cache to use no longer waits on you`. Every other composer keeps its draft, and a composer already open on the row keeps its own and takes the focus.

A row is told apart by its Ref, what it waits for, its Since and, for a row with no Ref, its Link.

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
