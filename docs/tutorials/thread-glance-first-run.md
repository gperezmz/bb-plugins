# Thread Glance: first run

In this tutorial you install Thread Glance, switch the sidebar to it, and put threads away and bring them back: snooze one, park one, settle one and undo it, then put your Active threads in an order of your own. You need a bb server you can install plugins on and one project with an agent that can run, with a few threads in it.

## 1. Install it and switch the sidebar

```sh
bb plugin install git:https://github.com/gperezmz/bb-plugins.git@main --plugin thread-glance
```

In bb, open Settings → Appearance → Sidebar and choose **Thread Glance**. Every window you have open switches too.

The list opens on its [defaults](../reference/thread-glance-settings.md#where-a-new-install-starts): every thread starts on Active, and no thread is snoozed, parked or settled.

`bb thread-glance prefs` and the `thread-glance` agent skill change its settings from a terminal or an agent: see [The command line](../reference/thread-glance-settings.md#the-command-line).

## 2. Read the list

At the top is the project scope, set to **All projects**. Below it are the [shelves](../reference/thread-glance-list.md#shelves), top to bottom: **Pinned** if you have pinned a thread, then **Active**, where your threads sit. A shelf with no threads is not drawn, so the lower shelves are missing for now.

Each Active thread is a card of three lines: the project and a status on the right, the title, and the branch with the pull request and harness logo.

## 3. Snooze a thread

Pick a thread that is not working. Hover its card and click the clock button, then choose **1 hour**.

The card leaves Active and a **Snoozed** shelf appears, collapsed and reading `Snoozed (1)`. Open it: the thread is a one-line row with the time it wakes. A toast says "Thread snoozed", with **Undo**.

Click **Wake** on the row. The thread returns to Active and the toast reads "Thread woke up". Snooze it again and let the toast pass; the [snooze presets](../reference/thread-glance-actions.md#snooze-presets) say what else the clock menu offers, and **Pick date & time…** takes any moment within a year.

## 4. Park a thread

Open the clock menu on another thread that is not working and choose **Park thread**. The thread goes to a collapsed **Parked** shelf, where its row shows how long it has waited. Parking is for a thread waiting on someone else: it needs no time, and it returns by itself when new attention arrives. Click **Resume** to bring it back by hand.

## 5. Settle a thread, and undo it

Hover a card and click **Settle**. The card sweeps across and the thread moves to **Settled**, with the toast "Thread settled" and **Undo**. Click **Undo**: the thread goes back to the shelf it was on.

Settle it again, and let the toast go. Open **Settled** and click **Un-settle** on its row to return it to Active. A settle covers the thread's whole tree, so a parent with a working child shows **Settling** on its card and settles once the child is done; the card's cancel button calls it off. The [children chip](../reference/thread-glance-list.md#children-chip) on a parent's card is where the child list opens.

## 6. Put Active in your own order and change a setting

Drag a card on Active up or down, keeping the pointer more vertical than sideways, or focus a card and press Alt+Arrow Up. Active is on **Manual order**: the order is yours, every window follows it, and new threads arrive at its top. [Reordering](../reference/thread-glance-actions.md#reordering) has the details.

Open Thread Glance's section in bb's settings. Under **Sidebar layout**, turn on **Working shelf**. The settings save by themselves: the heading reads "Saving…", then "Saved". Threads whose tree is working now sit on a **Working** shelf instead of Active. Turn it off again.

You have installed Thread Glance, and used its three ways to put a thread away. [The list](../reference/thread-glance-list.md) describes every shelf and row, [actions](../reference/thread-glance-actions.md) every button, [settings](../reference/thread-glance-settings.md) every setting, and [why it keeps threads on shelves](../explanation/thread-glance-shelves.md) the reasons.
