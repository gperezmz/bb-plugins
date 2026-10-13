# Answer, grant or build from the dashboard

Use this when a fleet's Inbox holds a row waiting on you and you would rather act on it where you see it than find the manager's thread and type the message. Each action sends the manager one message; [what each says](../reference/unattendish-dashboard.md#actions) is in the reference. You need a registered fleet whose manager is live, and the plugin's pages open in bb.

## Answer a parked question

1. Open **Fleets** in bb's navigation, or the **Fleet** tab of the manager's thread. A toast tells you when a row has just appeared. On the Fleets page, a fleet no account reads has a red **Connect…** on the fleet board: [connect it](unattendish-connect-a-fleet.md) first, since a fleet no account reads is not watched and sends no wakes. Pressing a fleet's line filters the queue to its rows.
2. In the queue, on a row waiting for `answer` (the **Answer** tab lists them), choose **Answer…**. A composer opens under the row, saying which item it answers and which fleet's manager it goes to, with a link to the park.
3. Write your answer, over as many lines as you need, and press ⌘/Ctrl+Enter. Esc cancels, and nothing sends while the text is empty.

The row's action cell reads `sent · 4m`, in every window. The row leaves the queue once a poll sees it gone from the Inbox, which is when the manager has acted on it, and the **Sent** tab lists the action as done for an hour. If the manager has not acted after several polls the row stays *sent*: the plugin never marks it failed, so open the manager's thread to see what it is doing.

## Grant a merge or another change that cannot be undone

On a row waiting for `grant`, choose **Grant…**, write what you grant and send it. For a grant carried over from a manager that has since been archived, choose **Re-grant** to send the row's What as the grant in one click.

## Build a spec

On a row waiting for `ready`, choose **Build it**. It sends `Build <Ref>` with no composer, and reads `done` once the spec carries the ready label, or the row leaves the queue.

## When bb refuses the message

bb's reason shows and the row keeps its action; a message to an archived manager is refused this way. For **Answer…** and **Grant…** the composer stays open with your text and its footer reads `Not sent: <reason>`, so correct what the reason names and send again. **Build it** and **Re-grant** have no composer: a red `not sent` appears beside the row's title, with the reason on hover.

A row waiting for `other` has a link and reads `watch only`: act on it where it lives.
