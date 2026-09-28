#!/usr/bin/env bash
# A reinstall reset: with a thread's Compact when idle on and its compaction
# skipped, a tree kept warm and its keep-warm skipped, the Agent tools row on
# and check-ins on, the plugin is uninstalled and installed again from the
# same copy. On its first load every one of those is off, bb's settings say
# check-ins are off, and the first line of `bb cache-keeper status` says
# what was switched off, until a switch is next flipped. Checked from
# `bb cache-keeper status`, `bb plugin config` and the plugin's RPC.
source "$(dirname "$0")/lib.sh"
drive reinstall
config keepWarm "Only threads switched on"
config stalledCheckIns true
skip() { rpc skip "{\"threadId\":\"$1\",\"what\":\"$2\",\"undo\":false}" > /dev/null; }
tools() { rpc agentTools | jq -c '[.[] | .on]'; }

c=$(spawn "drive: reinstall compaction" "Hello")
w=$(spawn "drive: reinstall keep-warm" "Start the deploy. [fake: background]")
say "threads $c (compaction), $w (keep-warm)"
bb cache-keeper on "$c" --above 100k > /dev/null
skip "$c" compaction
bb cache-keeper keep-warm on "$w" > /dev/null
skip "$w" warm
rpc setAgentTool '{"name":"compactWhenIdle","on":true}' > /dev/null
check "before: compaction on and skipped" eq "$(view "$c" | jq -c '[.compactOn, .compactSkipped]')" '[true,true]'
check "before: tree kept warm and skipped" eq "$(view "$w" | jq -c '[.keptWarm, .warmSkipped]')" '[true,true]'
check "before: Agent tools row on" eq "$(tools)" '[true]'
check "before: check-ins on" eq "$(bb plugin config cache-keeper | grep -c '^stalledCheckIns = true')" 1

bb plugin uninstall cache-keeper > /dev/null
bb plugin install "path:$run/plugin/cache-keeper" --yes > /dev/null
check "installed again and running" eq "$(bb plugin list --json | jq -r '.plugins[] | select(.id == "cache-keeper") | .status')" running
bb plugin config cache-keeper set fetchPrices false > /dev/null
settle "$c"

first=$(bb cache-keeper status | head -1)
say "status: $first"
check "status's first line says every switch was switched off" grep -qE '^Reinstalled: every thread.s Compact when idle, every tree.s Keep warm while waiting, every Skip, the Agent tools and check-ins were switched off' <<< "$first"
check "the thread's status leads with it too" grep -q '^Reinstalled: ' <<< "$(bb cache-keeper status "$c" | head -1)"
check "after: Compact when idle off, Skip cleared" eq "$(view "$c" | jq -c '[.compactOn, .compactSkipped, (.reset != null)]')" '[false,false,true]'
check "after: tree not kept warm, Skip cleared" eq "$(view "$w" | jq -c '[.keptWarm, .warmSkipped]')" '[false,false]'
check "after: Agent tools row off" eq "$(tools)" '[false]'
check "after: bb's settings say check-ins are off" eq "$(bb plugin config cache-keeper | grep -c '^stalledCheckIns = false')" 1

bb cache-keeper on "$c" > /dev/null
check "a switch flipped: the notice is gone" eq "$(bb cache-keeper status | grep -c '^Reinstalled: ')" 0
finish
