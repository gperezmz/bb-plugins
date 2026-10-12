# Answer, grant or build from the dashboard

Use this when a fleet's Inbox holds a row waiting on you and you would rather act on it where you see it than find the manager's thread and type the message. Each action sends the manager one message; [what each says](../reference/unattendish-dashboard.md#actions) is in the reference. You need a registered fleet whose manager is live, and the plugin's pages open in bb.

## Answer a parked question

1. Open **Fleets** in bb's navigation, or the **Fleet** tab of the manager's thread. A toast tells you when a row has just appeared. Above the table, **Needs an account** lists any fleet no account reads, with **Connect…**: [connect it](unattendish-connect-a-fleet.md) first, since a fleet no account reads is not watched and sends no wakes.
2. On a row waiting for `answer`, choose **Answer…**. The composer shows the row's What and a link to the park.
3. Write your answer, over as many lines as you need, and press ⌘/Ctrl+Enter. Esc cancels, and nothing sends while the text is empty.

The row shows *sent* with its age, in every window. It shows *done* once a poll sees the row gone from the Inbox, which is when the manager has acted on it. If the manager has not acted after several polls the row stays *sent*: the plugin never marks it failed, so open the manager's thread to see what it is doing.

## Grant a merge or another change that cannot be undone

On a row waiting for `grant`, choose **Grant…**, write what you grant and send it. For a grant carried over from a manager that has since been archived, choose **Re-grant** to send the row's What as the grant in one click.

## Build a spec

On a row waiting for `ready`, choose **Build it**. It sends `Build <Ref>` with no composer, and shows *done* once the spec carries the ready label or the row leaves the Inbox.

## When bb refuses the message

The row shows *not sent* with bb's reason and keeps its action; a message to an archived manager is refused this way. Your text stays in the composer, so correct what the reason names and send again.

A row waiting for `other` has a link and no action: act on it where it lives.
