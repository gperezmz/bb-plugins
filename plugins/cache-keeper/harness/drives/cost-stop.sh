#!/usr/bin/env bash
# The cost stop: a large thread (800k tokens) waiting on a background command,
# kept warm, whose keep-warm turns each write 30% of its context to the cache,
# as if the cache had partly gone cold, so each costs about a third of a cold
# rewrite, the stop. After a few keep-warms, one cache lifetime less a minute
# apart, none is planned; at the next deadline the keep-warm is held back
# with "cost stop", and none goes after it however far the clock moves.
# Checked from bb's event history of the thread and `bb cache-keeper status
# --json`.
source "$(dirname "$0")/lib.sh"
drive cost-stop
config '{"keepWarm":"switched"}'
config '{"checkIns":false}'

t=$(spawn "drive: cost stop" "Start the deploy. [fake: background] [fake: context=800000] [fake: warmWrite=0.3]")
say "thread $t"
bb cache-keeper keep-warm on "$t" > /dev/null
v=$(view "$t")
check "waiting on a command, kept warm, priced, 800k context" eq "$(jq -c '[.waiting, .keptWarm, .warmNoPrice, .context >= 800000, .priceSource]' <<< "$v")" '[true,true,false,true,"bundled"]'

# Each cycle moves the clock to the next keep-warm, one cache lifetime less a minute on.
sent=0
for cycle in 1 2 3 4 5; do
  next=$(jq .nextWarmAt <<< "$v")
  if [[ $next == null ]]; then break; fi
  advance_to $((next + 200))
  if wait_sent "$t" "$KEEP_WARM" $((sent + 1)); then
    sent=$((sent + 1))
    say "cycle $cycle: keep-warm $sent sent"
  else
    say "cycle $cycle: nothing sent"
  fi
  v=$(view "$t")
done
check "the stop came after 2 to 4 keep-warms ($sent)" within "$sent" 2 4
check "no keep-warm is planned, the thread still waits" eq "$(jq -c '[.warmPlanned, .nextWarmAt, .waiting]' <<< "$v")" '[false,null,true]'

# The deadline the next keep-warm would have gone at.
advance_to $(($(jq .deadline <<< "$v") + 200))
sleep 3
v=$(view "$t")
say "decision: $(jq -c .decision <<< "$v")"
check "last decision: keep-warm held back for the cost stop" eq "$(jq -c '[.decision.what, .decision.reason]' <<< "$v")" '["keep-warm","cost stop"]'
check "status says so" eq "$(bb cache-keeper status "$t" | grep -c 'last decision: held back keep-warm at .*: cost stop')" 1
check "the plugin's log names the hold" eq "$(bb plugin logs cache-keeper -n 200 | grep -c "$t: keep-warm due .* held back: cost stop")" 1

# Two more cache lifetimes: nothing more goes.
advance 9m
sleep 3
check "nothing more sent two cache lifetimes on" eq "$(count_sent "$t" "$KEEP_WARM")" "$sent"
finish
