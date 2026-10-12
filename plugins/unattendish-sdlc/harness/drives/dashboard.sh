#!/usr/bin/env bash
# The Fleets dashboard's RPC, called as its pages call it, through the running
# bb: the Inbox row of a registered fleet with what it offers; an Answer sent to
# the manager arrives in its thread as the operator's plain prompt, and stays
# *sent* through the polls that follow while the row is still in the Inbox; once
# the manager's manifest no longer holds the row, the next poll shows the action
# done; a second action on a row with one in flight is refused; the settings
# list the four fake credentials without a token, and an interval under 30
# seconds is refused. Checked from the RPC's own JSON and the manager's messages
# in bb's event history. The toast signal travels over bb's websocket, which this
# drive does not open: the composition tests check what is published.
source "$(dirname "$0")/lib.sh"
drive dashboard

repo=github.example/org/dashboard
t=$(spawn_manager "drive: dashboard")
say "manager $t"
manifest "$manifests/manifest.md" "$repo"
register "$t" "$repo" forge-issues "$manifests/manifest.md" > /dev/null
bb unattendish fleet interval "$repo" 30s > /dev/null

page=$(rpc fleets)
check "the page counts the one Inbox row waiting" eq "$(jq -c '[.waiting, (.inbox | length), .fleets[0].repo, .fleets[0].managerThreadId]' <<< "$page")" "[1,1,\"$repo\",\"$t\"]"
check "the row offers Answer…" eq "$(jq -c '.inbox[0] | [.ref, .waitsFor, .offer.label, .action]' <<< "$page")" '["#7","answer","Answer…",null]'
check "the card has no cost without Thread Usage, and no reason it is not fully watched" eq "$(jq -c '.fleets[0] | [.cost, (.reasons | length)]' <<< "$page")" '[null,0]'
row_id=$(jq -r '.inbox[0].id' <<< "$page")

sent=$(rpc sendAction "$(jq -nc --arg fleet "$repo" --arg row "$row_id" '{fleet: $fleet, rowId: $row, kind: "answer", text: "Go with B.\nIt is simpler."}')")
check "an Answer is sent and recorded as sent" eq "$(jq -c '[.ok, .action.state, .action.ref]' <<< "$sent")" '[true,"sent","#7"]'
# shellcheck disable=SC2329
answer_arrived() { messages "$t" | jq -se --arg want "Answer to #7: Go with B.
It is simpler." 'any(.[]; .text == $want)' > /dev/null; }
check "the manager's thread received it as a plain prompt, nothing added" wait_until 30 answer_arrived
check "the page shows the row as sent with no offer" eq "$(rpc fleets | jq -c '.inbox[0] | [.offer, .action.state]')" '[null,"sent"]'
second=$(rpc sendAction "$(jq -nc --arg fleet "$repo" --arg row "$row_id" '{fleet: $fleet, rowId: $row, kind: "answer", text: "again"}')")
check "a second action on the row is refused" eq "$(jq -c '[.ok, (.reason | contains("already sent"))]' <<< "$second")" '[false,true]'

before=$(polls "$repo")
check "a poll runs" wait_poll "$repo" "$before" 50
check "the row still in the Inbox, the action is still sent after that poll" eq "$(rpc fleets | jq -c '.inbox[0].action.state')" '"sent"'

# The manager answers: its manifest no longer holds the row.
printf '# Fleet: %s\n\n## Inbox\n\nNothing waits.\n' "$repo" > "$manifests/manifest.md"
before=$(polls "$repo")
check "a poll runs after the row is gone" wait_poll "$repo" "$before" 50
page=$(rpc fleets)
check "the action is done, and the Inbox is empty" eq "$(jq -c '[.waiting, (.inbox | length), .recentActions[0].state, .recentActions[0].ref]' <<< "$page")" '[0,0,"done","#7"]'

detail=$(rpc fleetDetail "$(jq -nc --arg repo "$repo" '{repo: $repo}')")
check "the Fleet tab reads the manifest and the credential the fleet uses" eq "$(jq -c '[.ok, .detail.manifest.status, .detail.credentials[0].prefix, .detail.credentials[0].sharesAgentRateLimit]' <<< "$detail")" '[true,"ok","github.example/org",false]'
check "the thread of the manager is the manager, any other thread runs no fleet" eq "$(rpc threadFleet "$(jq -nc --arg id "$t" '{threadId: $id}')" | jq -r .kind)-$(rpc threadFleet '{"threadId":"thr_none"}' | jq -r .kind)" "manager-none"
check "the ledger opens" eq "$(rpc ledger "$(jq -nc --arg repo "$repo" '{repo: $repo}')" | jq -r .ok)" true

settings=$(rpc settings)
check "the settings list the four fake credentials, each with a token stored" eq "$(jq -c '[.credentials[].prefix, (.credentials | all(.hasToken))]' <<< "$settings")" '["github.example/org","gitlab.example/group","linear:ENG","jira:acme.atlassian.net",true]'
refused=$(rpc setInterval "$(jq -nc --arg repo "$repo" '{repo: $repo, seconds: 29}')")
check "an interval under 30 seconds is refused" eq "$(jq -c '[.ok, (.reason | contains("30"))]' <<< "$refused")" '[false,true]'
added=$(rpc saveCredential '{"prefix":"github.example/other","auth":"token","service":"github","token":"ghp_harness_dashboard_token"}')
check "a credential is added" eq "$(jq -c '[.ok, (.settings.credentials | length)]' <<< "$added")" '[true,5]'
removed=$(rpc removeCredential '{"prefix":"github.example/other"}')
check "and removed" eq "$(jq -c '[.ok, (.settings.credentials | length)]' <<< "$removed")" '[true,4]'
check "no token is in any answer" none_in "$page$detail$settings$added$removed"
check "the added token is in none of them either" lacks "$added$removed$settings" ghp_harness_dashboard_token
check "every request to the four fakes was a read" fakes_read_only
finish
