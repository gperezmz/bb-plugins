#!/usr/bin/env bash
# The other services, each as a fleet of its own: a GitLab project (its issues
# as the tracker), a GitHub repository with its tracker in Linear, and one with
# its tracker in Jira Cloud. A comment on an item each manifest names wakes
# that fleet's manager with one line and none of the text, and every request
# the plugin made to any of the four fakes was a read: a GET, or a GraphQL query to
# Linear with no mutation. Checked from the managers' messages in bb's event
# history and the fakes' request logs.
# shellcheck source=lib.sh
source "$(dirname "$0")/lib.sh"
drive trackers
lab=gitlab.example/group/proj
lin=github.example/org/linear-fleet
jir=github.example/org/jira-fleet
a=$(spawn_manager "drive: trackers, GitLab")
b=$(spawn_manager "drive: trackers, Linear" "$a")
c=$(spawn_manager "drive: trackers, Jira" "$a")
say "managers $a (GitLab), $b (Linear), $c (Jira)"
soon=$(iso '+3 seconds')
jira_soon=$(date -u -d '+3 seconds' +%Y-%m-%dT%H:%M:%S.000+0000)

fake_state gitlab "$(jq -nc --arg at "$soon" '{projects: {"group/proj": {mergeRequests: [], issues: [{iid: 3, state: "opened", author: "olivia", created_at: $at, updated_at: $at,
  web_url: "https://gitlab.example/group/proj/-/issues/3", notes: [{id: 1, author: "alice", body: "SECRET-TEXT-GITLAB", created_at: $at}]}]}}}')"
fake_state linear "$(jq -nc --arg at "$soon" '{users: [{id: "u-olivia", email: "olivia@acme.test", displayName: "olivia"}, {id: "u-alice", email: "alice@acme.test", displayName: "alice"}],
  issues: [{identifier: "ENG-12", state: "started", createdAt: $at, updatedAt: $at, labels: [], assignee: "u-olivia", creator: "u-olivia", history: [],
  comments: [{id: "c1", createdAt: $at, user: "u-alice", body: "SECRET-TEXT-LINEAR"}]}]}')"
fake_state jira "$(jq -nc --arg at "$jira_soon" '{users: [{accountId: "acc-olivia", emailAddress: null, displayName: "Olivia"}, {accountId: "acc-alice", emailAddress: null, displayName: "Alice"}],
  issues: [{id: "100", key: "PROJ-5", status: "10000", labels: [], assignee: null, creator: "acc-olivia", updated: $at,
  comments: [{id: "1", author: "acc-alice", created: $at, text: "SECRET-TEXT-JIRA"}]}]}')"
fake_state github "$(jq -nc '{repos: {"org/linear-fleet": {}, "org/jira-fleet": {}}}')"

manifest "$manifests/gitlab.md" "$lab" '#3' https://gitlab.example/group/proj/-/issues/3
manifest "$manifests/linear.md" "$lin" ENG-12 https://linear.app/acme/issue/ENG-12
manifest "$manifests/jira.md" "$jir" PROJ-5 https://acme.atlassian.net/browse/PROJ-5
check "a GitLab fleet registers, watched" eq "$(register "$a" "$lab" forge-issues "$manifests/gitlab.md" | jq -c '[.outcome, .watched]')" '["registered",true]'
check "a fleet with its tracker in Linear registers, watched" eq "$(register "$b" "$lin" linear:ENG "$manifests/linear.md" --operator olivia@acme.test | jq -c '[.outcome, .watched]')" '["registered",true]'
check "a fleet with its tracker in Jira registers, watched" eq "$(register "$c" "$jir" jira:acme.atlassian.net/PROJ "$manifests/jira.md" --operator acc-olivia | jq -c '[.outcome, .watched]')" '["registered",true]'
check "status lists a tracker credential for each of the last two" eq "$(bb unattendish fleet status --json | jq -c '[.fleets[] | select(.repo != "'"$lab"'") | .credentials[] | select(.role == "tracker") | .service] | sort')" '["jira","linear"]'

check "the GitLab manager is woken" wait_wakes "$a" 1 40
check "the Linear manager is woken" wait_wakes "$b" 1 40
check "the Jira manager is woken" wait_wakes "$c" 1 40
check "GitLab: one line, the item and its URL, no text" grep -qxE '#3 commented by [^ ]+ https://gitlab\.example/group/proj/-/issues/3' <<< "$(wake_text "$a" 1 | tail -n +2)"
check "Linear: one line, the item and its URL, no text" grep -qxE 'ENG-12 commented by [^ ]+ https://linear\.app/acme/issue/ENG-12' <<< "$(wake_text "$b" 1 | tail -n +2)"
check "Jira: one line, the item and its URL, no text" grep -qxE 'PROJ-5 commented by [^ ]+ https://acme\.atlassian\.net/browse/PROJ-5' <<< "$(wake_text "$c" 1 | tail -n +2)"
for wake in "$(wake_text "$a" 1)" "$(wake_text "$b" 1)" "$(wake_text "$c" 1)"; do
  say "wake: $(tr '\n' '|' <<< "$wake")"
  check "exactly one change line, and nothing a comment said" eq "$(tail -n +2 <<< "$wake" | wc -l)-$(grep -c SECRET-TEXT <<< "$wake" || true)" "1-0"
done

for service in gitlab linear jira; do
  check "the fake $service was asked" eq "$(fake_requests "$service" | jq 'length > 0')" true
done
check "every request to the four fakes was a read" fakes_read_only
check "Linear was asked in queries, each carrying the token" eq "$(fake_requests linear | jq -c '[.[] | (.method == "POST" and .hasAuthorization and ((.body | fromjson | .query) | test("^\\s*query\\b")))] | all')" true
everything="$(bb unattendish fleet status)$(ledger "$lab")$(ledger "$lin")$(ledger "$jir")$(wakes "$a")$(wakes "$b")$(wakes "$c")"
check "no token is in the status, a ledger or a wake" none_in "$everything"
finish
