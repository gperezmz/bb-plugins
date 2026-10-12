#!/usr/bin/env bash
# A restart: after the plugin is reloaded the fleet is still registered, its
# cursor held, so a change already delivered is not delivered again; and a
# change made while the plugin was off (disabled, with its stored last-poll
# time moved back 15 minutes, since the plugin reads wall time and a catch-up
# needs a gap of ten) reaches the manager in one wake that says it is a
# catch-up and how long the plugin was away. Checked from `fleet status --json`
# and the manager's messages in bb's event history.
# shellcheck source=lib.sh
source "$(dirname "$0")/lib.sh"
drive restart
repo=github.example/org/restart
plugin=unattendish-sdlc
t=$(spawn_manager "drive: restart")
say "manager $t"
manifest "$manifests/manifest.md" "$repo"

gh_state org/restart "$(gh_issue 7 olivia)" "$(gh_comment 1 7 alice "SECRET-TEXT")"
register "$t" "$repo" forge-issues "$manifests/manifest.md" > /dev/null
bb unattendish fleet interval "$repo" 30s > /dev/null
check "the first change wakes the manager" wait_wakes "$t" 1 40
before=$(status "$repo")

bb plugin reload "$plugin" > /dev/null
check "the plugin answers again" wait_until 30 bb unattendish fleet status --json
after=$(status "$repo")
check "the fleet is still registered, with its manager, its interval and its last poll" eq "$(jq -c '[.manager, .intervalMs, .lastPolledAt]' <<< "$after")" "$(jq -c '[.manager, .intervalMs, .lastPolledAt]' <<< "$before")"
check "its cursor holds: the ledger still holds the change as a wake, once" eq "$(ledger_rows "$repo" | jq -r .disposition | tr '\n' ' ')" "wake "

# The plugin is away while the next change is made.
bb plugin disable "$plugin" > /dev/null
check "the plugin is away" eq "$(bb plugin list --json | jq -r --arg id "$plugin" '.plugins[] | select(.id == $id) | .status')" disabled
gh_state org/restart "$(gh_issue 7 olivia)" "$(gh_comment 1 7 alice "SECRET-TEXT"; gh_comment 2 7 bob "SECRET-TEXT-WHILE-AWAY")"
aged=$(node "$harness/age-last-poll.mjs" "$run/bb/plugins/$plugin/data.db" "$repo" 15)
say "last poll moved back to $aged"
bb plugin enable "$plugin" > /dev/null

check "the manager gets a second wake" wait_wakes "$t" 2 45
wake=$(wake_text "$t" 2)
say "wake: $(tr '\n' '|' <<< "$wake")"
check "with the one change made while the plugin was away" eq "$(grep -c '^#7 ' <<< "$wake")-$(grep '^#7 ' <<< "$wake")" "1-#7 commented by bob https://github.example/org/restart/issues/7"
check "and a closing line saying it is a catch-up and for how long" grep -qE '^Catch-up: the plugin was away for 1[5-9]m( [0-9]+s)?\.$' <<< "$wake"
check "no more than two wakes in all" eq "$(wake_count "$t")" 2
finish
