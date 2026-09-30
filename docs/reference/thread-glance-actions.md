# Thread Glance: menus, dragging and keys

What each of the list's menus offers, what a drop does, and what the keyboard reaches. Sources: [`model/menu.ts`](../../plugins/thread-glance/features/thread-list/model/menu.ts) for the row menu, [`components/overlays/`](../../plugins/thread-glance/features/thread-list/components/overlays/) for the other menus and the hover card, and [`model/drag.ts`](../../plugins/thread-glance/features/thread-list/model/drag.ts) for drops.

## A thread row's menu

The row's **…** button, a right-click on the row, the context-menu key or Shift+F10 on it, and on a phone a long press, all open the same items, top to bottom:

| Item | Shown | Does |
|---|---|---|
| Details | Always | Opens the thread's details: state, harness, model, branch, machine, children, last reply, when it was created and last finished |
| Open in split | While bb offers split panes here | Opens the thread in a new pane |
| Copy thread link, Copy thread ID | Always | Copies the link or the ID |
| Mark read | On a root while its tree holds something unread, on any other row while the thread is unread | See [Marking threads read](#marking-threads-read); on a root, bb's own lists in the window show the tree unread until a reload ([known limitation](#known-limitation-bbs-own-lists-until-a-reload)) |
| Mark unread | Otherwise | Marks the thread unread in bb |
| Pin, Unpin | Always | Pins or unpins the thread in bb |
| Move to section | On a root that is not archived, while the list has sections or groups by Custom | Moves the thread to Threads or one of bb's sections, with a check on its own. A phone's menu lists the sections under the label instead of in a submenu |
| Move… | On a thread that is not archived | Opens a search for a new parent thread, or none |
| Rename | Always | Edits the title in place |
| Archive, Unarchive | Always | Archives the thread, or brings it back |
| Delete | Always | Asks bb to delete the thread, with bb's own confirmation |

The row itself also offers **Mark read** and **Archive** on hover, as [the row's right end](thread-glance-states.md#the-rows-right-end) shows.

A worktree folder row, drawn while **Worktrees as folders** is on, has its own **…** menu: **New thread in environment**, **Rename** and **Archive**, which archives every thread in the worktree.

## A group header's menu

| Item | Shown | Does |
|---|---|---|
| Mark all read | While the group holds an unread thread | See [Marking threads read](#marking-threads-read); bb's own lists in the window show those threads unread until a reload ([known limitation](#known-limitation-bbs-own-lists-until-a-reload)) |
| New thread | On a group that names a project, not on Pinned | Opens a new thread there |
| New section | While grouped by Custom | Creates a bb section |
| Rename | On a section or a machine | Renames it in bb |
| Hide from list, Show in list | On every group but Pinned | Moves the group into **More** at the end of the list, or back |
| Show archived threads | Always | Shows archived threads in every group; a check marks it on |
| Customize list | Always | Opens the dialog that orders and hides groups |
| Remove section | On a section | Asks first, then removes the section; its threads go back to Threads |

## The hover card

Resting the pointer on a row for half a second, or moving keyboard focus onto it, opens a card with the same lines as **Details**, and the pull request where the row shows one. A row that slides under a still pointer, the focused thread's row, and any row while a menu is open or a title is being renamed open no card. The card stays open while the pointer is on it.

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

**Mark all read** in the list header marks every unread thread in the list read: every group, hidden ones included, child threads, children that finished since you last looked at them, and archived threads while **Show archived threads** is on. A group's **Mark all read** does the same for that group. **Mark read** on a root marks its whole thread tree; on any other row, the thread alone. Above 20 threads, Mark all read asks first.

The threads show read at once. Thread Glance then sends bb one read request per thread, six at a time, so bb is never sent them all at once. A thread whose request fails shows unread again, and a row's Mark read says it could not.

### Known limitation: bb's own lists until a reload

After Mark all read, or Mark read on a thread tree, bb's own thread lists in the same window still show those threads unread until the page is reloaded. In practice that is the phone home screen's **Recent** list. bb 0.44 updates its own copy of read state only through its own mark-read action, and sends no realtime update for read state, while Thread Glance sends its paced read requests instead so that it never sends them all at once. A window loaded afterwards shows them read. A window already open elsewhere, Thread Glance's list in it included, shows them read from its next reload, as it does for any read state set outside it in bb 0.44.
