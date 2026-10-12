#!/usr/bin/env bash
# The npm-install check's fixture for Unattendish (see
# scripts/ci/npm-install-check.sh). The throwaway bb has no manager thread and
# no forge, so this checks what the plugin registers and answers without
# either: it declares no setting (accounts and their tokens live in the plugin's
# own database, never in bb's settings); its RPC answers `settings` with no
# account; its RPC method `connect` refuses an API address off the account's own
# host, before any request is made, and stores nothing; `bb unattendish` lists
# the fleet commands; `fleet status` and `fleet ledger` answer with nothing
# registered; `fleet register` refuses a call from outside a thread with
# no_thread (the call runs without the caller's BB_THREAD_ID); and `fleet
# interval` refuses an interval under 30 seconds and a repository no fleet
# holds. No command takes a token.
set -euo pipefail

schema=$(bb plugin config "$PLUGIN_ID" --json | jq -c '.schema // {}')
if [[ $schema != '{}' ]]; then
  echo "::error::$PLUGIN_ID declares settings, but keeps accounts in its own database: $schema" >&2
  exit 1
fi
echo "The plugin declares no setting"

# `bb plugin rpc call` prints the method's result.
rpc() { bb plugin rpc call "$PLUGIN_ID" "$1" ${2:+--input-file "$2"} --json; }
if [[ $(rpc settings | jq -c '.accounts') != '[]' ]]; then
  echo "::error::the plugin's settings RPC lists an account on a fresh install: $(rpc settings)" >&2
  exit 1
fi
echo "The plugin's RPC answers settings with no account"

input="$FIXTURE_DIR/connect.json"
jq -nc '{account: {service: "github", place: "github.com", apiUrl: "https://api.elsewhere.example"}, secret: {kind: "token", token: "ghp_fixture_token"}}' > "$input"
out=$(rpc connect "$input")
if [[ $(jq -r .outcome <<< "$out") != invalid ]] || grep -qF ghp_fixture_token <<< "$out"; then
  echo "::error::connect did not refuse an API address off the account's own host, without the token: $out" >&2
  exit 1
fi
if [[ $(rpc settings | jq -c '.accounts') != '[]' ]]; then
  echo "::error::a refused connect stored an account" >&2
  exit 1
fi
echo "connect refuses an API address off the account's host, and stores nothing"

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
