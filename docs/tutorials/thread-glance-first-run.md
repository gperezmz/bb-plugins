# Thread Glance: first run

In this tutorial you install Thread Glance, switch the sidebar to it, and watch a parent thread and its child thread in the list. You need a bb server you can install plugins on and one project with an agent that can run.

## 1. Install it and switch the sidebar

```sh
bb plugin install git:https://github.com/gperezmz/bb-plugins.git@main --plugin thread-glance
```

In bb, open Settings → Appearance → Sidebar and choose **Thread Glance**.

The list looks much like bb's: Thread Glance copied your grouping, sort, group order, and hidden and collapsed groups from it. Every window you have open switches too.

## 2. Read a row

The list starts with its header: `Projects`, the name of the grouping, then a sliders button, with a Mark all read button before it while any thread in the list is unread. Below it are your groups, each ending with a faint `Settled (N)` divider when some of its threads have gone a day without activity.

Look at any thread you have run before. From left to right, its row holds:

- a state glyph, or a faint ring when the thread is idle and read;
- the title, bold if you have not read the thread since it finished;
- a small harness logo, only if the thread runs on a harness other than bb's default;
- the machine's name, only if the thread runs on a machine other than bb's own;
- how long ago it last finished.

Hover the row for half a second. The card names the state, the harness, the model the next turn will use, the branch and the machine.

## 3. Start a parent with a child

In a thread of your project, send:

```text
Spawn one child thread that lists the files in this repository, then wait for it and summarise what it found.
```

Then open a different thread. A thread shown in a pane of bb's window is an [open thread](../explanation/thread-glance-attention.md#what-a-thread-needs-attention-for), which is never unread, so the steps below need the parent out of view.

While the parent works, its row shows a blue spinner and a timer counting up. When the child appears, the parent's row gets a muted `1` and a chevron just before its time: its one child. The child has no row of its own at the top of the group. It sits behind that chip.

Click the chip. The child's row opens under the parent, indented one step, its title the same size as its parent's.

## 4. Let it finish

The parent's glyph always shows the parent's own state. If its turn ends while the child still works, its glyph turns to the idle ring, and its chip turns blue and leads with a small spinner: a child is working.

When the child finishes, its row shows a blue dot: it finished and you have not looked at it. The parent's chip swaps its spinner for a small blue dot, now for unread, and the parent's row does not turn urgent, because the parent is the one waiting for that result.

When the parent finishes, its row shows the dot and a bold title.

## 5. See what needs attention

The tree stays where it is in its project's group, and the list header now shows `1 need you`, because the parent finished unread. Your finished child did not add to it: [what "Needs attention" means](../explanation/thread-glance-attention.md) explains why.

Click `1 need you`. The list narrows to that one tree under its project's header. Click it again for the full list. Hover the parent's row and click **Mark read**, the open envelope beside archive: the parent and its child are read, and `1 need you` goes away.

## 6. Change a setting

Click the sliders button at the right of the list header. Under **List**, set **Settle after** to **12h**. Trees that have gone half a day without activity join each group's `Settled (N)` divider at its end; click a divider to see what it holds. Set it back to **1d**, and click the sliders button again to close the panel.

You have installed Thread Glance, read its rows and chips, and used the need-you filter. [States and glyphs](../reference/thread-glance-states.md) lists every glyph you can meet, and [preferences](../reference/thread-glance-preferences.md) every setting.
