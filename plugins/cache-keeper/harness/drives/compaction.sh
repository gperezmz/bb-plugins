#!/usr/bin/env bash
# A compaction at its deadline: a thread above its compaction line, switched
# on, gets no /compact before its deadline and gets one within a second or two
# of it. Checked from bb's event history of the thread and `bb cache-keeper
# status --json`.
source "$(dirname "$0")/lib.sh"
drive compaction
config keepWarm "Only threads switched on"
config stalledCheckIns false

t=$(spawn "drive: compaction" "Hello")
say "thread $t"
bb cache-keeper on "$t" --above 100k > /dev/null
v=$(view "$t")
deadline=$(jq .deadline <<< "$v")
check "switched on, context $(jq .context <<< "$v") above its line $(jq .line <<< "$v"), a compaction due" \
  eq "$(jq -c '[.compactOn, .compactionDue, .context > .line]' <<< "$v")" "[true,true,true]"

advance_to $((deadline - 30000))
sleep 2
check "nothing sent 30 s before the deadline" eq "$(count_sent "$t" "$COMPACT")" 0

advance_to $((deadline + 200))
check "/compact sent at the deadline" wait_sent "$t" "$COMPACT" 1
v=$(view "$t")
check "one /compact in bb's history" eq "$(count_sent "$t" "$COMPACT")" 1
check "last decision: compact sent, no reason" eq "$(jq -c '[.decision.what, .decision.reason]' <<< "$v")" '["compact",null]'
check "decided within 2 s of the deadline" within $(($(jq .decision.at <<< "$v") - deadline)) 0 2000
at=$(requests "$t" | jq -s --arg re "$COMPACT" '[.[] | select(.text | test($re))][0].at')
check "bb recorded the send within 2 s of the decision" within $((at + $(clock_offset) - $(jq .decision.at <<< "$v"))) -2000 2000
check "status says compacted" eq "$(jq -r '.statusText | test("^compacted")' <<< "$v")" true
finish
