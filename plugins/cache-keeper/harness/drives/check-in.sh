#!/usr/bin/env bash
# A check-in after the no-output wait: with "Check in on stalled background
# work" on and a 10-minute wait, a thread whose background command prints
# nothing gets no check-in at 9.5 minutes and one at 10; the next waits twice
# as long, 20 minutes. The check-in asks the agent to check the task and
# says a task quiet on purpose is fine; the agent's nothing-new reply is the
# one it asked for. Checked from bb's event history of the thread,
# `bb thread output` and `bb cache-keeper status --json`.
source "$(dirname "$0")/lib.sh"
drive check-in
config keepWarm "Only threads switched on"
config noOutputWait "10 min"
config stalledCheckIns true
check "bb holds the settings" eq "$(bb plugin config cache-keeper | grep -cE '^(stalledCheckIns = true|noOutputWait = "10 min")')" 2
offset=$(clock_offset)

t=$(spawn "drive: check-in" "Start the deploy. [fake: background]")
say "thread $t"
# When bb saw the background command start, on the plugin's clock.
started=$(curl -fsS "$BB_SERVER_URL/api/v1/threads/$t/events?order=asc&limit=100&types=item/started" |
  jq '[.[] | select(.data.item.type == "backgroundTask")][0].createdAt')
started=$((started + offset))
v=$(view "$t")
check "waiting on one background command, not kept warm" eq "$(jq -c '[.waiting, .counts.commands, .keptWarm]' <<< "$v")" '[true,1,false]'

advance_to $((started + 570000))
sleep 2
check "no check-in after 9.5 minutes without output" eq "$(count_sent "$t" "$CHECK_IN")" 0

advance_to $((started + 600000 + 200))
check "a check-in after 10 minutes" wait_sent "$t" "$CHECK_IN" 1
v=$(view "$t")
first=$(jq .decision.at <<< "$v")
check "last decision: check-in sent" eq "$(jq -c '[.decision.what, .decision.reason]' <<< "$v")" '["check-in",null]'
check "sent within 3 s of the wait's end" within $((first - started - 600000)) 0 3000
text=$(requests "$t" | jq -rs --arg re "$CHECK_IN" '[.[] | select(.text | test($re))][0].text')
check "it names the quiet command and asks for a check" grep -qE "^Background command \S+ \(\"Wait for the fake deploy\"\) hasn't printed anything in 10 minutes\. Can you check on it\?" <<< "$text"
check "it says a task quiet on purpose is fine to leave running" grep -qF "A task that's quiet on purpose, such as a server or a watcher, is fine to leave running." <<< "$text"
check "it tells the agent to stop, kill or restart nothing" eq "$(grep -ciE '\b(stop|kill|restart)\b' <<< "$text")" 0
check "the agent gave the nothing-new reply it asked for" grep -qE '^Checked \S+, still running normally, nothing new\. Nothing needed from you\.$' <<< "$(bb thread output "$t")"

advance_to $((first + 1140000))
sleep 2
check "no second check-in 19 minutes on" eq "$(count_sent "$t" "$CHECK_IN")" 1
advance_to $((first + 1200000 + 200))
check "a second check-in 20 minutes on, twice the wait" wait_sent "$t" "$CHECK_IN" 2
# `status` keeps the time of the first of a run of like decisions, so bb's record times this one.
check "bb recorded it within 3 s of twice the wait" within $(($(sent_at "$t" "$CHECK_IN" 2) - first - 1200000)) 0 3000

config stalledCheckIns false
finish
