#!/usr/bin/env bash
# The npm-install check's fixture for Cache Keeper (see
# scripts/ci/npm-install-check.sh). The throwaway bb has no Claude Code
# thread, so this checks what it can reach without one: bb serves an app
# bundle it calls compatible that registers the composer chip and banner, the
# sidebar script, the nav page and the Agent tools settings section; bb serves
# the timer and the flame as the plugin's icons; bb holds
# the plugin's four settings, with check-ins off; its CLI answers from the
# server with nothing switched on, names compact-now and no `now`; and it
# refuses to switch on, or keep warm, a thread that does not exist.
set -euo pipefail

app=$(bb plugin list --json | jq -c --arg id "$PLUGIN_ID" '.plugins[] | select(.id == $id) | .app')
if [[ $(jq -r '.hasApp and .bundle.compatible' <<< "$app") != true ]]; then
  echo "::error::bb does not serve $PLUGIN_ID's app bundle as compatible: $app" >&2
  exit 1
fi
curl -fsS -o "$FIXTURE_DIR/app.js" "$BB_SERVER_URL$(jq -r .bundle.jsUrl <<< "$app")"
for registration in 'composer.customize(' 'contentScripts.register(' 'slots.navPanel(' 'slots.settingsSection(' 'id:"cache-keeper"' 'id:"agent-tools"'; do
  if ! grep -qF "$registration" "$FIXTURE_DIR/app.js"; then
    echo "::error::the app bundle bb serves lacks $registration" >&2
    exit 1
  fi
done
echo "The app bundle registers the composer chip and banner, the sidebar script, the nav page and the Agent tools section"

icons=$(bb plugin list --json | jq -c --arg id "$PLUGIN_ID" '.plugins[] | select(.id == $id) | .icons')
for name in cache-keeper flame; do
  url=$(jq -r --arg name "$name" '.[$name] // empty' <<< "$icons")
  if [[ -z $url ]]; then
    echo "::error::bb registers no $name icon for $PLUGIN_ID: $icons" >&2
    exit 1
  fi
  if ! curl -fsS "$BB_SERVER_URL$url" | grep -qF 'viewBox="0 0 24 24"'; then
    echo "::error::bb does not serve $PLUGIN_ID's $name icon as an SVG at $url" >&2
    exit 1
  fi
done
echo "bb serves the timer and the flame"

config=$(bb plugin config "$PLUGIN_ID" --json)
keys=$(jq -c '[(.settings // .values // .) | keys[]] | sort' <<< "$config")
if [[ $keys != '["fetchPrices","keepWarm","noOutputWait","stalledCheckIns"]' ]]; then
  echo "::error::$PLUGIN_ID's settings are $keys, not the four it declares" >&2
  echo "$config" >&2
  exit 1
fi
echo "bb holds the four settings"

check_ins=$(jq -r '(.values // .settings // .).stalledCheckIns' <<< "$config")
if [[ $check_ins != false ]]; then
  echo "::error::$PLUGIN_ID's \"Check in on stalled background work\" is $check_ins on a fresh install, not off" >&2
  exit 1
fi
echo "Check-ins are off on a fresh install"

help=$(bb cache-keeper --help)
if ! grep -qE '^\s+bb cache-keeper compact-now\s' <<< "$help" || grep -qE '^\s+bb cache-keeper now\s' <<< "$help"; then
  echo "::error::bb cache-keeper --help does not list compact-now alone:" >&2
  echo "$help" >&2
  exit 1
fi
echo "bb cache-keeper --help lists compact-now and no now"

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
