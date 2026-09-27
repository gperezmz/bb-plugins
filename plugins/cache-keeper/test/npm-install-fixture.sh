#!/usr/bin/env bash
# The npm-install check's fixture for Cache Keeper (see
# scripts/ci/npm-install-check.sh). The throwaway bb has no Claude Code
# thread, so this checks what it can reach without one: bb serves an app
# bundle it calls compatible that registers the composer chip and banner, the
# sidebar script and the nav page; bb holds the plugin's four settings; its
# CLI answers from the server with nothing switched on; and it refuses to
# switch on, or keep warm, a thread that does not exist.
set -euo pipefail

app=$(bb plugin list --json | jq -c --arg id "$PLUGIN_ID" '.plugins[] | select(.id == $id) | .app')
if [[ $(jq -r '.hasApp and .bundle.compatible' <<< "$app") != true ]]; then
  echo "::error::bb does not serve $PLUGIN_ID's app bundle as compatible: $app" >&2
  exit 1
fi
curl -fsS -o "$FIXTURE_DIR/app.js" "$BB_SERVER_URL$(jq -r .bundle.jsUrl <<< "$app")"
for registration in 'composer.customize(' 'contentScripts.register(' 'slots.navPanel(' 'id:"cache-keeper"'; do
  if ! grep -qF "$registration" "$FIXTURE_DIR/app.js"; then
    echo "::error::the app bundle bb serves lacks $registration" >&2
    exit 1
  fi
done
echo "The app bundle registers the composer chip and banner, the sidebar script and the nav page"

config=$(bb plugin config "$PLUGIN_ID" --json)
keys=$(jq -c '[(.settings // .values // .) | keys[]] | sort' <<< "$config")
if [[ $keys != '["fetchPrices","keepWarm","noOutputWait","stalledCheckIns"]' ]]; then
  echo "::error::$PLUGIN_ID's settings are $keys, not the four it declares" >&2
  echo "$config" >&2
  exit 1
fi
echo "bb holds the four settings"

status=$(bb cache-keeper status)
if ! grep -qF "No thread has compact-when-idle on." <<< "$status" || ! grep -qF "Last 30 days:" <<< "$status"; then
  echo "::error::bb cache-keeper status printed something else:" >&2
  echo "$status" >&2
  exit 1
fi
echo "bb cache-keeper status answers"

if out=$(bb cache-keeper on thr_doesnotexist 2>&1); then
  echo "::error::bb cache-keeper on accepted a thread that does not exist: $out" >&2
  exit 1
fi
echo "bb cache-keeper on refuses a thread bb does not list"

if out=$(bb cache-keeper keep-warm on thr_doesnotexist 2>&1); then
  echo "::error::bb cache-keeper keep-warm on accepted a thread that does not exist: $out" >&2
  exit 1
fi
echo "bb cache-keeper keep-warm on refuses a thread bb does not list"
