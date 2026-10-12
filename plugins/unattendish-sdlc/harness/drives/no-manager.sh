#!/usr/bin/env bash
# A fleet whose manager is archived: its changes are held, recorded in the
# ledger once, and nothing is sent to the archived manager; the manager that
# takes the fleet over gets them in its first wake, which says they gathered
# while no manager held the fleet. Checked from `fleet ledger`, `fleet status`
# and the managers' messages in bb's event history.
# shellcheck source=lib.sh
source "$(dirname "$0")/lib.sh"
drive no-manager
repo=github.example/org/no-manager
old=$(spawn_manager "drive: no-manager, archived")
new=$(spawn_manager "drive: no-manager, takes over" "$old")
say "managers $old (to be archived) and $new"
manifest "$manifests/manifest.md" "$repo"
archive "$old"

gh_state org/no-manager "$(gh_issue 7 olivia)" "$(gh_comment 1 7 alice "SECRET-TEXT")"
check "the archived manager's registration is accepted" eq "$(register "$old" "$repo" forge-issues "$manifests/manifest.md" | jq -r .outcome)" registered
bb unattendish fleet interval "$repo" 30s > /dev/null

check "the change is recorded as held" wait_until 30 ledger_has "$repo" --done held
held=$(polls "$repo")
check "recorded once" eq "$(ledger_rows "$repo" --done held | wc -l)" 1
check "status says changes are held, since when" contains "$(bb unattendish fleet status)" "changes held since"

check "another poll runs, with no manager" wait_poll "$repo" "$held" 50
check "the change is still recorded once" eq "$(ledger_rows "$repo" --done held | wc -l)" 1
check "nothing was sent to the archived manager" eq "$(wake_count "$old")" 0

out=$(register "$new" "$repo" forge-issues "$manifests/manifest.md")
check "the next manager takes the fleet over" eq "$(jq -c '[.outcome, .previousManager]' <<< "$out")" "[\"taken-over\",\"$old\"]"
check "it gets a wake" wait_wakes "$new" 1 45
wake=$(wake_text "$new" 1)
say "wake: $(tr '\n' '|' <<< "$wake")"
check "with the held change" contains "$wake" "#7 commented by alice https://github.example/org/no-manager/issues/7"
check "and the line saying it gathered while no manager held the fleet" grep -qE '^Gathered while no manager held the fleet, since [0-9T:.Z-]+\.$' <<< "$wake"
check "the ledger now records the change as a wake, and none held" eq "$(ledger_rows "$repo" | jq -r .disposition | sort -u | tr '\n' ' ')" "wake "
check "the archived manager still got nothing" eq "$(wake_count "$old")" 0
finish
