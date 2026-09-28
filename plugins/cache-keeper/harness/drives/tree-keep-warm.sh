#!/usr/bin/env bash
# A tree keep-warm: a tree top waits on a child thread that waits on a
# background command. With the tree kept warm, the child, the tree's leaf,
# gets a keep-warm at its deadline and none before; its reply's report climbs
# to the top and refreshes the top's cache, so the top gets no keep-warm of
# its own. Checked from bb's event history of both threads and
# `bb cache-keeper status --json`.
source "$(dirname "$0")/lib.sh"
drive tree-keep-warm
config keepWarm "Only threads switched on"
config stalledCheckIns false

top=$(spawn "drive: tree top" "Hello")
child=$(spawn "drive: tree child" "Start the deploy. [fake: background]" "$top")
settle "$top"
# A later turn on the top, so its deadline comes clearly after the child's.
sleep 3
tell "$top" "Anything new?"
say "top $top, child $child"

bb cache-keeper keep-warm on "$top" > /dev/null
vt=$(view "$top")
vc=$(view "$child")
check "both wait, the top on the child and the child on a command" eq "$(jq -c '[.waiting, .counts.threads]' <<< "$vt")$(jq -c '[.waiting, .counts.commands]' <<< "$vc")" "[true,1][true,1]"
check "both kept warm, with the top as the tree top" eq "$(jq -c '[.keptWarm, .treeTop.threadId]' <<< "$vt")$(jq -c '[.keptWarm, .treeTop.threadId]' <<< "$vc")" "[true,\"$top\"][true,\"$top\"]"
send_at=$(jq .nextWarmAt <<< "$vc")
top_deadline=$(jq .deadline <<< "$vt")
check "the child's keep-warm is planned before the top's deadline" within "$send_at" 0 "$top_deadline"

advance_to $((send_at - 30000))
sleep 2
check "nothing sent 30 s before the child's deadline" eq "$(count_sent "$child" "$KEEP_WARM")$(count_sent "$top" "$KEEP_WARM")" 00

advance_to $((send_at + 200))
check "the child got a keep-warm at its deadline" wait_sent "$child" "$KEEP_WARM" 1
vc=$(view "$child")
check "child's decision: keep-warm sent, within 2 s of its deadline" eq "$(jq -c '[.decision.what, .decision.reason, (.decision.at - '"$send_at"' | . >= 0 and . <= 2000)]' <<< "$vc")" '["keep-warm",null,true]'
check "the child replied with the nothing-new reply" eq "$(bb thread output "$child" 2>/dev/null | grep -c '^Not finished yet, still waiting on ' || true)" 1
check "its report reached the top" wait_sent "$top" "Not finished yet, still waiting on " 1
vt=$(view "$top")
check "the report moved the top's deadline on" within "$(jq .deadline <<< "$vt")" $((top_deadline + 1)) 99999999999999

advance_to $((top_deadline + 35000))
sleep 2
check "the top got no keep-warm of its own, past its old deadline and grace" eq "$(count_sent "$top" "$KEEP_WARM")" 0
check "the child got exactly one" eq "$(count_sent "$child" "$KEEP_WARM")" 1
finish
