# Thread Glance: menus, dragging and keys

What each of the list's menus offers, what a drop does, and what the keyboard reaches. Sources: [`components/thread-menu.ts`](../../plugins/thread-glance/features/thread-list/components/thread-menu.ts) for what Thread Glance adds to a thread row's menu, [`components/overlays/`](../../plugins/thread-glance/features/thread-list/components/overlays/) for the other menus and the hover card, and [`model/drag.ts`](../../plugins/thread-glance/features/thread-list/model/drag.ts) for drops.

## A thread row's menu

The row's **…** button, a right-click on the row, the context-menu key or Shift+F10 on it, and on a phone a long press, all open bb's own thread menu, the one bb's list and a thread's header show: the same items, order, submenus and phone drawer, and every action another plugin adds to bb's thread menus. Rename edits the title in place in the row.

Thread Glance adds four items of its own, each at the end of the bb group it belongs with:

| Item | Shown | Does |
|---|---|---|
| Details | Always, with bb's Open in split | Opens the thread's details: state, harness, model, branch, machine, children, last reply, when it was created and last finished |
| Copy thread ID | Always, with bb's organizing items | Copies the ID |
| Mark tree read | On a root with an unread thread below it | Marks the root and every thread below it read; see [Marking threads read](#marking-threads-read) |
| Move… | On a thread that is not archived | Opens a search for a new parent thread, or none |

The row itself also offers bb's **Mark read**, while bb has the thread unread, and bb's **Archive** on hover, as [the row's right end](thread-glance-states.md#the-rows-right-end) shows.

A worktree folder row, drawn while **Worktrees as folders** is on, has its own **…** menu: **New thread in environment**, **Rename** and **Archive**, which archives every thread in the worktree as bb's own list does: the threads leave the list at once, split panes showing them close, and bb's toast offers **Undo**.

## A group header's menu

| Item | Shown | Does |
|---|---|---|
| Mark all read | While the group holds an unread thread | See [Marking threads read](#marking-threads-read) |
| New thread | On a group that names a project, not on Pinned | Opens a new thread there |
| New section | While grouped by Custom | Creates a bb section |
| Rename | On a section or a machine | Renames it in bb |
| Hide from list, Show in list | On every group but Pinned | Moves the group into **More** at the end of the list, or back |
| Show archived threads | Always | Shows archived threads in every group; a check marks it on |
| Customize list | Always | Opens the dialog that orders and hides groups |
| Remove section | On a section | Asks first, then removes the section; its threads go back to Threads |

## The hover card

Resting the pointer on a row for half a second, or moving keyboard focus onto it, opens a card with the same lines as **Details**, and the pull request where the row shows one, with [what bb knows of it](thread-glance-states.md#the-pull-request-badge). A row that slides under a still pointer, the focused thread's row, and any row while a menu is open or a title is being renamed open no card. The card stays open while the pointer is on it.

## Dragging

A row or a group header is dragged with the pointer; the list scrolls while the pointer waits at its top or bottom edge. A thread row is split into a top quarter, a middle half and a bottom quarter as a target:

| Dropped on | Does |
|---|---|
| The middle of another thread's row | Makes the dragged thread its child, unpinning it first. On its own child or deeper, nothing happens and the row shows the drop as blocked |
| The top or bottom quarter of a pinned row, in Pinned | Pins the thread there, or moves a pinned thread to that place in Pinned |
| The Pinned header | Pins the thread |
| Any other group, its header, or the top or bottom quarter of a row in it | Unpins a pinned thread. Under Custom, a thread dropped on Threads or a section moves there, leaving its parent. Otherwise a child leaves its parent, and a root stays where it is |
| A group header, dragging a group header | Puts the dragged group before or after it, by which half of the target group the pointer is over |

bb's own drag out of the sidebar still works on a row: dropped on the main area's edge, it opens the thread in a split pane.

## Keys

Enter on a row opens its thread, as a click does, and the context-menu key or Shift+F10 opens its menu. No key drags a row or a group header: **Move…** in the row's menu moves a thread under another, and **Customize list** reorders groups. bb's thread shortcuts work as on bb's own list: its jump keys reach the first nine threads, and its next and previous thread keys walk every thread, rows scrolled out of view included.

## Marking threads read

**Mark all read** in the list header marks every unread thread in the list read: every group, hidden ones included, child threads, children that finished since you last looked at them, and archived threads while **Show archived threads** is on. A group's **Mark all read** does the same for that group, and **Mark tree read** in a root's menu for that root's thread tree. Above 20 threads, Mark all read asks first. bb's own **Mark read**, in the row's menu, on hover and in Details, marks the one thread.

The threads show read at once. Thread Glance then sends bb one read request per thread, six at a time, so bb is never sent them all at once. A thread whose request fails shows unread again, and Mark tree read says it could not.
