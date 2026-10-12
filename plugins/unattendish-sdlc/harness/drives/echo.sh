#!/usr/bin/env bash
# Echoes: a comment whose last line is the registered marker (bare, or inside a
# <kbd> wrapper) and a comment by a registered echo actor are dropped, and the
# ledger records each with its rule; the operator's comment without the marker
# wakes, and so does the operator's quote-reply with the marker inside the
# quote. Checked from the manager thread's wake and `fleet ledger`.
# shellcheck source=lib.sh
source "$(dirname "$0")/lib.sh"
drive echo
repo=github.example/org/echo
t=$(spawn_manager "drive: echo")
say "manager $t"
manifest "$manifests/manifest.md" "$repo"

gh_state org/echo "$(gh_issue 7 olivia)" "$(
  gh_comment 1 7 olivia $'Round closed.\n\n'"$MARKER"
  gh_comment 2 7 olivia "I would rather go with B."
  gh_comment 3 7 olivia $'> Parked: which one?\n>\n> '"$MARKER"$'\n\nGo with A.'
  gh_comment 4 7 fleet-bot "Working on it."
  gh_comment 5 7 alice $'Merged.\n\n<kbd>'"$MARKER"$'</kbd>\n\n'
)"
check "registered, with a separate bot account as an echo actor" eq "$(register "$t" "$repo" forge-issues "$manifests/manifest.md" --echo-actor fleet-bot | jq -r .outcome)" registered
bb unattendish fleet interval "$repo" 30s > /dev/null

check "a wake reaches the manager" wait_wakes "$t" 1 40
polled=$(polls "$repo")
wake=$(wake_text "$t" 1)
say "wake: $(tr '\n' '|' <<< "$wake")"
check "it holds the two comments that are not echoes, both the operator's" eq "$(tail -n +2 <<< "$wake" | sort | uniq -c | tr -s ' ' | tr '\n' ';')" " 2 #7 commented by olivia https://github.example/org/echo/issues/7;"
check "the ledger holds three echoes" eq "$(ledger_rows "$repo" --done echo | wc -l)" 3
check "by their rules: the marker twice, the echo actor once" eq "$(ledger_rows "$repo" --done echo | jq -r '.actor + ":" + .rule' | sort | tr '\n' ' ')" "alice:marker fleet-bot:echo actor olivia:marker "
check "the other two are recorded as wakes" eq "$(ledger_rows "$repo" | jq -r 'select(.disposition == "wake") | .actor' | sort | uniq -c | tr -s ' ' | tr '\n' ';')" " 2 olivia;"
check "the plain-text ledger names the echo and its rule" contains "$(bb unattendish fleet ledger "$repo" --done echo)" "(marker)"

check "another poll runs" wait_poll "$repo" "$polled" 50
check "and wakes nothing: the echoes were settled, the comments delivered" eq "$(wake_count "$t")" 1
finish
