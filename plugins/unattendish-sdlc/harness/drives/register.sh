#!/usr/bin/env bash
# Registering, as the contract's outcomes give it: a fresh repository
# registers and is watched once its manifest exists; a second live manager is
# refused and the first's registration stands; an archived manager is taken
# over, with its manifest path handed on; contract version 2 is unsupported, an
# echo actor equal to the operator is invalid, and neither registers or changes
# anything; an interval under 30 seconds is refused; a call from outside a
# thread fails with no_thread; unregistering removes the fleet. Checked from
# the command's own JSON and `fleet status --json`.
# shellcheck source=lib.sh
source "$(dirname "$0")/lib.sh"
drive register
repo=github.example/org/register
manifest_file=$manifests/register.md
t1=$(spawn_manager "drive: register 1")
t2=$(spawn_manager "drive: register 2" "$t1")
say "managers $t1 and $t2"

out=$(register "$t1" "$repo" forge-issues "$manifest_file")
check "a fresh repository registers, its manifest not written yet" eq "$(jq -c '[.outcome, .watched, .notWatched[0].code]' <<< "$out")" '["registered",false,"manifest-missing"]'
check "the reason names the manifest's path" contains "$(jq -r '.notWatched[0].text' <<< "$out")" "$manifest_file"
manifest "$manifest_file" "$repo"
s=$(status "$repo")
check "status: watched, held by the first manager, every 120 s" eq "$(jq -c '[.watched, .manager, .intervalMs]' <<< "$s")" "[true,\"$t1\",120000]"
check "status names the credential it uses" eq "$(jq -c '[.credentials[0].prefix, .credentials[0].service, .credentials[0].auth]' <<< "$s")" '["github.example/org","github","token"]'

out=$(register "$t1" "$repo" forge-issues "$manifest_file" --label-ready ship-it)
check "the same manager registering again with other labels is registered" eq "$(jq -c '[.outcome, .watched]' <<< "$out")" '["registered",true]'

out=$(register "$t2" "$repo" forge-issues "$manifests/other.md")
check "a second live manager is refused, naming the holder" eq "$(jq -c '[.outcome, .holder]' <<< "$out")" "[\"refused\",\"$t1\"]"
check "the first manager's registration is unchanged" eq "$(status "$repo" | jq -c '[.manager, .manifest]')" "[\"$t1\",\"$manifest_file\"]"

archive "$t1"
out=$(register "$t2" "$repo" forge-issues "$manifests/second.md")
check "an archived manager is taken over, with its manifest handed on" eq "$(jq -c '[.outcome, .previousManager, .previousManifest]' <<< "$out")" "[\"taken-over\",\"$t1\",\"$manifest_file\"]"
check "the new manager is not watched until its manifest exists" eq "$(jq -c '[.watched, .notWatched[0].code]' <<< "$out")" '[false,"manifest-missing"]'
check "status names the new manager" eq "$(status "$repo" | jq -r .manager)" "$t2"

other=github.example/org/register-two
out=$(register "$t2" "$other" forge-issues "$manifests/two.md" --contract 2)
check "contract version 2 is unsupported, version 1 supported" eq "$(jq -c '[.outcome, .supported]' <<< "$out")" '["unsupported",[1]]'
check "nothing is registered by it" eq "$(status "$other")" ""
out=$(register "$t2" "$other" forge-issues "$manifests/two.md" --echo-actor olivia)
check "an echo actor equal to the operator is invalid, naming --echo-actor" eq "$(jq -c '[.outcome, (.reason | contains("--echo-actor"))]' <<< "$out")" '["invalid",true]'
check "nothing is registered by it" eq "$(status "$other")" ""
out=$(register "$t2" "$repo" forge-issues "$manifests/third.md" --echo-actor olivia)
check "the same on a held repository is invalid, and its registration stands" eq "$(jq -r .outcome <<< "$out")-$(status "$repo" | jq -r .manifest)" "invalid-$manifests/second.md"
out=$(register "$t2" "$other" bogus-tracker "$manifests/two.md")
check "a tracker none of the forms names is invalid, naming --tracker" eq "$(jq -c '[.outcome, (.reason | contains("--tracker"))]' <<< "$out")" '["invalid",true]'
check "a tracker none of the forms names registers nothing" eq "$(status "$other")" ""

too_short=$(bb unattendish fleet interval "$repo" 10s 2>&1 || true)
check "an interval of 10 seconds is refused, naming the 30-second floor" contains "$too_short" "30"
check "the interval stays" eq "$(status "$repo" | jq .intervalMs)" 120000
bb unattendish fleet interval "$repo" 30s > /dev/null
check "30 seconds is accepted" eq "$(status "$repo" | jq .intervalMs)" 30000

outside=$(env -u BB_THREAD_ID bb unattendish fleet register --contract 1 --repo "$other" --tracker forge-issues --manifest "$manifests/two.md" --operator olivia \
  --label-spec spec --label-ready ready --label-in-progress in-progress --label-needs-input needs-input --marker "$MARKER" --json || true)
check "a call from outside a thread fails with no_thread" eq "$(jq -r '.error.code' <<< "$outside")" no_thread

check "unregistering says so" eq "$(bb unattendish fleet unregister "$repo" --json | jq -r .outcome)" unregistered
check "the fleet is gone" eq "$(status "$repo")" ""
finish
