#!/usr/bin/env bash
# The manifest is read again when the manager's turn ends: the manager adds a
# pull request to its manifest's In flight table and ends its turn, the plugin
# reads that pull request at once (not at the next poll), and a review that
# lands before the next poll wakes the manager with a line for it and none of its
# text. Checked from the fake GitHub's request log, `fleet status` and the
# manager's messages in bb's event history.
source "$(dirname "$0")/lib.sh"
drive turn-end

# pull_read: the fake GitHub was asked about the pull request.
# shellcheck disable=SC2329
pull_read() { fake_requests github | jq -e 'any(.[]; .url | test("/issues/20"))' > /dev/null; }

repo=github.example/org/turn-end
t=$(spawn_manager "drive: turn-end")
say "manager $t"
manifest "$manifests/manifest.md" "$repo"

# The pull request exists, and nothing names it yet.
fake_state github "$(jq -nc --arg at "$(iso)" '{repos: {"org/turn-end": {issues: [
  {number: 7, state: "open", labels: [], assignees: [], creator: "olivia", createdAt: $at, updatedAt: $at},
  {number: 20, state: "open", labels: [], assignees: [], creator: "olivia", createdAt: $at, updatedAt: $at, pull: {merged: false, headSha: "abc123"}}]}}}')"
register "$t" "$repo" forge-issues "$manifests/manifest.md" > /dev/null
bb unattendish fleet interval "$repo" 30s > /dev/null
check "the first poll runs" wait_until 20 polled "$repo"
check "it did not read the pull request, which no row names" eq "$(fake_requests github | jq '[.[] | select(.url | test("/(issues|pulls)/20"))] | length')" 0

# The manager writes its manifest and ends its turn.
manifest "$manifests/manifest.md" "$repo" '#7' "https://$repo/issues/7" "| #20 | A pull request | under review | 2026-10-12T09:00:00Z | — | https://$repo/pull/20 |"
polled_at=$(status "$repo" | jq -r .lastPolledAt)
bb thread tell "$t" "The manifest is written." > /dev/null
sleep 1
bb thread wait "$t" --status idle --timeout 60s > /dev/null
check "the plugin read the pull request when the turn ended" wait_until 20 pull_read
check "that was not a poll: the fleet's last poll is unchanged, and nothing woke the manager" eq "$(status "$repo" | jq -r .lastPolledAt)-$(wake_count "$t")" "$polled_at-0"

# A review lands before the next poll.
fake_state github "$(jq -nc --arg at "$(iso)" --arg later "$(iso '+3 seconds')" '{repos: {"org/turn-end": {issues: [
  {number: 7, state: "open", labels: [], assignees: [], creator: "olivia", createdAt: $at, updatedAt: $later},
  {number: 20, state: "open", labels: [], assignees: [], creator: "olivia", createdAt: $at, updatedAt: $later, pull: {merged: false, headSha: "abc123"}}],
  reviews: [{id: 1, pull: 20, user: "alice", body: "SECRET-REVIEW-TEXT", state: "APPROVED", submittedAt: $later}]}}}')"
check "the next poll wakes the manager" wait_wakes "$t" 1 45
wake=$(wake_text "$t" 1)
say "wake: $(tr '\n' '|' <<< "$wake")"
check "with a line for the review and none of its text" eq "$(tail -n +2 <<< "$wake")" "#20 reviewed: approved by alice https://github.example/org/turn-end/pull/20"
check "it came from a poll: the fleet's last poll is later" eq "$([[ $(status "$repo" | jq -r .lastPolledAt) > $polled_at ]] && echo later)" later
check "every request to the four fakes was a read" fakes_read_only
finish
