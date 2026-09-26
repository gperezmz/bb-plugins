# Thread Glance: first run

In this tutorial you install Thread Glance, switch the sidebar to it, and watch a parent thread and its child thread in the list. You need a bb server you can install plugins on and one project with an agent that can run.

## 1. Install it and switch the sidebar

```sh
bb plugin install git:https://github.com/gperezmz/bb-plugins.git@main --plugin thread-glance
```

In bb, open Settings → Appearance → Sidebar and choose **Thread Glance**.

The list looks much like bb's: Thread Glance copied your grouping, sort, group order, and hidden and collapsed groups from it. Every window you have open switches too.

## 2. Read a row

Look at any thread you have run before. From left to right, its row holds:

- a state glyph, or nothing when the thread is idle and read;
- the title, bold if you have not read the thread since it finished;
- a small logo of the harness that runs it;
- how long ago it last finished.

Hover the row for half a second. The card names the state, the harness, the model the next turn will use, the branch and the machine.

## 3. Start a parent with a child

In a thread of your project, send:

```text
Spawn one child thread that lists the files in this repository, then wait for it and summarise what it found.
```

While the parent works, its row shows a blue spinner and a timer counting up. When the child appears, the parent's row gets a chip: `1` with a spinner, because its one child is working. The child has no row of its own at the top of the group. It sits behind that chip.

Click the chip. The child's row opens under the parent, slightly indented, on a thin line that joins it to its parent.

## 4. Let it finish

When the child finishes, its row shows a blue dot: it finished and you have not looked at it. The parent's chip does not turn urgent, because the parent is the one waiting for that result.

When the parent finishes, its row shows the dot and a bold title.

## 5. See what needs attention

When the parent finished unread, its family moved into **Needs attention**, the section at the top of the list, and left its project's group. Your finished child did not bring it there: [what "Needs attention" means](../explanation/thread-glance-attention.md) explains why. The parent's row shows its project's name where the age normally is.

Open the parent. The family stays in the section while you read it, in the same place, but its title is no longer bold and the section's count leaves it out: it is attended. Open a thread outside it, and the family goes back to its project.

## 6. Change a setting

Click the gear at the top of the list, and under **Rows** set **Harness icon** to **Colour**. Every row's logo takes its provider's colour. Set it back to **Muted**.

You have installed Thread Glance, read its rows and chips, and watched a family move through Needs attention. [States and glyphs](../reference/thread-glance-states.md) lists every glyph you can meet, and [preferences](../reference/thread-glance-preferences.md) every setting.
