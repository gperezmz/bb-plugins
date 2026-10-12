#!/usr/bin/env bash
# The npm-install check's fixture for Unattendish (see
# scripts/ci/npm-install-check.sh). The throwaway bb has no manager thread and
# no forge, so this checks what the plugin registers and answers without
# either: bb lists its two settings, with the tokens setting secret; `bb
# unattendish` lists the fleet commands; `fleet status` and `fleet ledger`
# answer with nothing registered; `fleet register` refuses a call from outside
# a thread with no_thread (the call runs without the caller's BB_THREAD_ID); and `fleet interval` refuses an interval under 30
# seconds and a repository no fleet holds. No command takes a token.
set -euo pipefail

schema=$(bb plugin config "$PLUGIN_ID" --json | jq -c '.schema // {}')
for key in credentials tokens; do
  if [[ $(jq --arg key "$key" 'has($key)' <<< "$schema") != true ]]; then
    echo "::error::bb holds no $key setting for $PLUGIN_ID: $schema" >&2
    exit 1
  fi
done
if [[ $(jq '.tokens.secret // false' <<< "$schema") != true ]]; then
  echo "::error::the tokens setting of $PLUGIN_ID is not secret: $schema" >&2
  exit 1
fi
echo "The plugin holds the credentials and tokens settings, tokens secret"

help=$(bb unattendish --help)
for command in 'fleet register' 'fleet unregister' 'fleet status' 'fleet ledger' 'fleet interval'; do
  if ! grep -qF "$command" <<< "$help"; then
    echo "::error::bb unattendish --help does not list $command:" >&2
    echo "$help" >&2
    exit 1
  fi
done
if grep -qiE -- '--token|--password|--secret' <<< "$(bb unattendish fleet register --help)"; then
  echo "::error::a register option takes a token" >&2
  exit 1
fi
echo "bb unattendish lists the fleet commands, and none takes a token"

if [[ $(bb unattendish fleet status --json | jq -c .) != '{"fleets":[]}' ]]; then
  echo "::error::fleet status does not answer an empty list on a fresh install" >&2
  exit 1
fi
if ! bb unattendish fleet ledger github.com/org/repo --json | jq -e '.entries == []' > /dev/null; then
  echo "::error::fleet ledger does not answer an empty ledger for a repository no fleet holds" >&2
  exit 1
fi
echo "fleet status and fleet ledger answer with nothing registered"

out=$(env -u BB_THREAD_ID bb unattendish fleet register --contract 1 --repo github.com/org/repo --tracker forge-issues \
  --manifest /tmp/manifest.md --operator olivia --label-spec spec --label-ready ready \
  --label-in-progress in-progress --label-needs-input needs-input --marker marker --json || true)
if [[ $(jq -r '.error.code // empty' <<< "$out") != no_thread ]]; then
  echo "::error::fleet register from outside a thread did not refuse with no_thread: $out" >&2
  exit 1
fi
echo "fleet register refuses a call from outside a thread"

out=$(bb unattendish fleet interval github.com/org/repo 10s --json || true)
if [[ $(jq -r '.error.code // empty' <<< "$out") != interval_too_short ]] || ! grep -qF '30' <<< "$out"; then
  echo "::error::fleet interval did not refuse 10s naming the 30-second floor: $out" >&2
  exit 1
fi
out=$(bb unattendish fleet interval github.com/org/repo 45s --json || true)
if [[ $(jq -r '.error.code // empty' <<< "$out") != not_registered ]]; then
  echo "::error::fleet interval did not refuse a repository no fleet holds: $out" >&2
  exit 1
fi
echo "fleet interval refuses 10s, and a repository no fleet holds"
