#!/usr/bin/env bash
# Skip and Undo, as the banner and the chip's popover press them (the
# plugin's `skip` RPC):
#   a compaction skipped is not sent at its deadline, with "skipped" as the
#   reason, and the Skip ends when the thread next runs; one skipped and
#   undone is sent at its deadline;
#   a keep-warm skipped is no longer planned; undone, it is planned again and
#   sent at its deadline; skipped again, the next one is held with "skipped".
# The two halves run one after the other, each on its own thread, so moving
# the clock for one sends nothing to the other. Checked from bb's event
# history of the threads and `bb cache-keeper status --json`.
source "$(dirname "$0")/lib.sh"
drive skip-undo
config '{"keepWarm":"switched"}'
config '{"checkIns":false}'
skip() { rpc skip "{\"threadId\":\"$1\",\"what\":\"$2\",\"undo\":$3}" > /dev/null; }

t=$(spawn "drive: skip compaction" "Hello")
say "compaction: thread $t"
bb cache-keeper on "$t" --above 100k > /dev/null
skip "$t" compaction false
v=$(view "$t")
check "Skip: compaction skipped, none due" eq "$(jq -c '[.compactOn, .compactSkipped, .compactionDue]' <<< "$v")" '[true,true,false]'
advance_to $(($(jq .deadline <<< "$v") + 200))
sleep 3
v=$(view "$t")
check "no /compact at the deadline" eq "$(count_sent "$t" "$COMPACT")" 0
check "last decision: compaction held back, skipped" eq "$(jq -c '[.decision.what, .decision.reason]' <<< "$v")" '["compact","skipped"]'

tell "$t" "Carry on"
check "the Skip ended when the thread ran again" eq "$(view "$t" | jq -c '[.compactSkipped, .compactionDue]')" '[false,true]'
skip "$t" compaction false
check "Skip again" eq "$(view "$t" | jq -c '[.compactSkipped, .compactionDue]')" '[true,false]'
skip "$t" compaction true
v=$(view "$t")
check "Undo: due again" eq "$(jq -c '[.compactSkipped, .compactionDue]' <<< "$v")" '[false,true]'
advance_to $(($(jq .deadline <<< "$v") + 200))
check "undone, /compact sent at the deadline" wait_sent "$t" "$COMPACT" 1
check "exactly one /compact" eq "$(count_sent "$t" "$COMPACT")" 1
archive "$t"

w=$(spawn "drive: skip keep-warm" "Start the deploy. [fake: background]")
say "keep-warm: thread $w"
bb cache-keeper keep-warm on "$w" > /dev/null
check "keep-warm planned" eq "$(view "$w" | jq -c '[.keptWarm, .warmPlanned, .warmSkipped]')" '[true,true,false]'
skip "$w" warm false
v=$(view "$w")
check "Skip: keep-warm skipped, none planned" eq "$(jq -c '[.warmSkipped, .warmPlanned, .nextWarmAt]' <<< "$v")" '[true,false,null]'
deadline=$(jq .deadline <<< "$v")
advance_to $((deadline - 30000))
skip "$w" warm true
v=$(view "$w")
check "Undo: planned again for its deadline" eq "$(jq -c '[.warmSkipped, .warmPlanned, .nextWarmAt]' <<< "$v")" "[false,true,$deadline]"
check "nothing sent before it" eq "$(count_sent "$w" "$KEEP_WARM")" 0
advance_to $((deadline + 200))
check "undone, keep-warm sent at the deadline" wait_sent "$w" "$KEEP_WARM" 1
v=$(view "$w")
skip "$w" warm false
advance_to $(($(jq .deadline <<< "$v") + 200))
sleep 3
check "skipped again, the next keep-warm held: still one sent" eq "$(count_sent "$w" "$KEEP_WARM")" 1
check "last decision: keep-warm held back, skipped" eq "$(view "$w" | jq -c '[.decision.what, .decision.reason]')" '["keep-warm","skipped"]'
finish
