#!/usr/bin/env bash
# Credentials: a fleet whose host no credential matches, or only matches as a
# prefix of a longer host name, registers, shows as not watched naming the
# prefix, and sends no request to any fake; a fleet whose token the service
# refuses (a scripted 401) shows as not watched since a time, and its manager
# gets one wake saying so and naming the credential's prefix, however many
# polls fail. The token the fakes were given is sent to them and appears in no
# wake, status or ledger. Checked from `fleet status --json`, the manager's
# messages and the fakes' request logs.
# shellcheck source=lib.sh
source "$(dirname "$0")/lib.sh"
drive credentials
t=$(spawn_manager "drive: credentials")
say "manager $t"

# No credential matches the host; a credential for gitlab.example/group does not match a longer host.
lonely=nocred.example/org/repo
evil=gitlab.example.evil.net/group/proj
manifest "$manifests/lonely.md" "$lonely"
manifest "$manifests/evil.md" "$evil"
out=$(register "$t" "$lonely" forge-issues "$manifests/lonely.md")
check "a fleet no credential matches registers, not watched" eq "$(jq -c '[.outcome, .watched, .notWatched[0].code]' <<< "$out")" '["registered",false,"no-credential"]'
check "and the reason names the prefix" contains "$(jq -r '.notWatched[0].text' <<< "$out")" "nocred.example"
out=$(register "$t" "$evil" forge-issues "$manifests/evil.md")
check "so does a fleet on a host that only begins with a credential's" eq "$(jq -c '[.outcome, .watched, .notWatched[0].code]' <<< "$out")" '["registered",false,"no-credential"]'
check "status shows both not watched, naming the missing prefix" eq "$(bb unattendish fleet status --json | jq -c '[.fleets[] | select(.watched == false) | .notWatched[0].text | (contains("nocred.example") or contains("gitlab.example.evil.net"))] | sort')" "[true,true]"
check "both are polled" wait_until 20 polled "$lonely"
wait_until 20 polled "$evil"
check "but no request reached any fake" eq "$(for s in github gitlab linear jira; do fake_requests "$s"; done | jq -s 'map(length) | add')" 0

# A credential the service refuses.
repo=github.example/org/refused
manifest "$manifests/refused.md" "$repo"
fake_state github "$(jq -nc --arg at "$(iso)" '{repos: {"org/refused": {issues: [{number: 7, state: "open", labels: [], assignees: [], creator: "olivia", createdAt: $at, updatedAt: $at}]}}, faults: [{pathIncludes: "/repos/", status: 401}]}')"
out=$(register "$t" "$repo" forge-issues "$manifests/refused.md")
check "a fleet with a credential registers, watched" eq "$(jq -c '[.outcome, .watched]' <<< "$out")" '["registered",true]'
bb unattendish fleet interval "$repo" 30s > /dev/null
check "the manager gets a wake" wait_wakes "$t" 1 40
wake=$(wake_text "$t" 1)
say "wake: $(tr '\n' '|' <<< "$wake")"
check "naming the credential's prefix and since when" grep -qE '^Not watched since [0-9T:.Z-]+: the credential for github\.example/org was refused by the service\.$' <<< "$wake"
s=$(status "$repo")
check "status shows it not watched, since a time, naming the prefix" eq "$(jq -c '[.watched, .notWatchedSince != null, .notWatched[0].code, (.notWatched[0].text | contains("github.example/org"))]' <<< "$s")" '[false,true,"credential-refused",true]'
check "the fake was sent the token (an Authorization header) on every request" eq "$(fake_requests github | jq '[.[] | select(.hasAuthorization | not)] | length')" 0
polled=$(polls "$repo")
check "another poll fails" wait_poll "$repo" "$polled" 50
check "and sends no second wake" eq "$(wake_count "$t")" 1
everything="$(bb unattendish fleet status)$(ledger "$repo")$(wakes "$t")"
check "no token is in the status, the ledger or the wake" none_in "$everything"
check "no token is in bb's logs or the harness's" eq "$(grep -rlE 'ghp_harness_fake_token|harness-fake-token' "$run"/*.log "$run/bb/logs" 2> /dev/null | wc -l)" 0
finish
