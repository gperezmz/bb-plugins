#!/usr/bin/env bash
# The npm-install check's fixture for Pocket Navigation (see
# scripts/ci/npm-install-check.sh). The plugin registers only a frontend slot,
# which runs in a browser, so this checks what the server can answer for it:
# bb serves an app bundle it calls compatible, the bundle registers the
# sidebar navigation as pocket-navigation, and bb takes that registration as
# its navigation.
set -euo pipefail

provider=$PLUGIN_ID/pocket-navigation

app=$(bb plugin list --json | jq -c --arg id "$PLUGIN_ID" '.plugins[] | select(.id == $id) | .app')
echo "App bundle: $app"
if [[ $(jq -r '.hasApp and .bundle.compatible' <<< "$app") != true ]]; then
  echo "::error::bb does not serve $PLUGIN_ID's app bundle as compatible" >&2
  exit 1
fi

curl -fsS -o "$FIXTURE_DIR/app.js" "$BB_SERVER_URL$(jq -r .bundle.jsUrl <<< "$app")"
for registration in 'slots.experimental_sidebarNavigation(' 'id:"pocket-navigation"'; do
  if ! grep -qF "$registration" "$FIXTURE_DIR/app.js"; then
    echo "::error::the app bundle bb serves lacks $registration" >&2
    exit 1
  fi
done
echo "The app bundle registers the sidebar navigation $provider"

bb settings ui set sidebar.navigationProvider "$provider"
chosen=$(bb settings ui get sidebar.navigationProvider | jq -r .)
if [[ $chosen != "$provider" ]]; then
  echo "::error::bb's navigation is '$chosen' after choosing $provider" >&2
  exit 1
fi
bb settings ui reset sidebar.navigationProvider
echo "bb took $provider as its navigation"
