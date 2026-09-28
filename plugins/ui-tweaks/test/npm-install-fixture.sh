#!/usr/bin/env bash
# The npm-install check's fixture for UI Tweaks (see
# scripts/ci/npm-install-check.sh). The tweaks apply in a browser, so this
# checks what the server can answer for them: bb serves an app bundle it
# calls compatible that registers the settings section, the listener overlay
# and the content script; the tweaks read Medium on a fresh install; and a
# change is kept while a choice that is not a segment is refused.
set -euo pipefail

app=$(bb plugin list --json | jq -c --arg id "$PLUGIN_ID" '.plugins[] | select(.id == $id) | .app')
if [[ $(jq -r '.hasApp and .bundle.compatible' <<< "$app") != true ]]; then
  echo "::error::bb does not serve $PLUGIN_ID's app bundle as compatible: $app" >&2
  exit 1
fi
curl -fsS -o "$FIXTURE_DIR/app.js" "$BB_SERVER_URL$(jq -r .bundle.jsUrl <<< "$app")"
for registration in 'slots.settingsSection(' 'slots.experimental_appOverlay(' 'contentScripts.register(' 'id:"ui-tweaks"' 'id:"sync"' 'id:"tweaks"'; do
  if ! grep -qF "$registration" "$FIXTURE_DIR/app.js"; then
    echo "::error::the app bundle bb serves lacks $registration" >&2
    exit 1
  fi
done
echo "The app bundle registers the settings section, the overlay and the content script"

tweaks=$(bb plugin rpc call "$PLUGIN_ID" getTweaks --json | jq -c '.result // .')
if [[ $tweaks != '{"textSize":"medium","width":"medium"}' ]]; then
  echo "::error::$PLUGIN_ID's tweaks are $tweaks on a fresh install, not Medium and Medium" >&2
  exit 1
fi
echo "The tweaks are Medium on a fresh install"

echo '{"textSize":"large","width":"narrow"}' > "$FIXTURE_DIR/set.json"
bb plugin rpc call "$PLUGIN_ID" setTweaks --input-file "$FIXTURE_DIR/set.json" --json > /dev/null
tweaks=$(bb plugin rpc call "$PLUGIN_ID" getTweaks --json | jq -c '.result // .')
if [[ $tweaks != '{"textSize":"large","width":"narrow"}' ]]; then
  echo "::error::$PLUGIN_ID kept $tweaks after setting Large and Narrow" >&2
  exit 1
fi
echo "A change is kept"

echo '{"width":"huge"}' > "$FIXTURE_DIR/bad.json"
if bb plugin rpc call "$PLUGIN_ID" setTweaks --input-file "$FIXTURE_DIR/bad.json" --json > /dev/null 2>&1; then
  echo "::error::$PLUGIN_ID took a width that is not a segment" >&2
  exit 1
fi
echo "A choice that is not a segment is refused"
