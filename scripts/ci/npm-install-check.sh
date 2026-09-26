#!/usr/bin/env bash
# Installs a packed plugin the way a bb server installs an npm: source, into a
# throwaway bb: publishes the tarball to a local registry (Verdaccio, which
# proxies every other package to registry.npmjs.org), starts a bb server on a
# temporary data directory with a host daemon enrolled as its primary machine,
# runs `bb plugin install npm:<name>@<version>`, then fails unless the plugin
# is running and bb downloaded no build toolchain, which it would only do to
# build the plugin itself. Then loads the plugin from server.ts, as bb does
# after an upgrade, which must run too. Then applies the plugin's fixture,
# where it has one. Last, fails when the plugin's own log (`bb plugin logs`)
# holds a warning or an error from any of these, and prints them.
#
# A fixture is an executable <plugin-dir>/test/npm-install-fixture.sh, for a
# plugin that registers something only once it is configured: it sets the
# plugin's configuration with `bb`, then checks from outside that what the
# plugin registered works, and exits non-zero when it does not. It runs in the
# plugin's directory with BB_SERVER_URL naming the throwaway bb, HOME and
# TMPDIR inside the check's temporary directory, PLUGIN_ID, and FIXTURE_DIR, an
# empty directory there for its own files. Every process it starts is stopped
# when the check ends, pass or fail.
#
# check-plugin.sh calls this; it needs node, npm, jq and bb-app's `bb`,
# `bb-server` and `bb-host-daemon` on PATH, and touches no other bb. Set
# REGISTRY_PORT, BB_TEST_SERVER_PORT and BB_TEST_DAEMON_PORT to run two at
# once.
#
#   scripts/ci/npm-install-check.sh <plugin-dir> <tarball>
set -euo pipefail

plugin_dir=$(cd "${1:?usage: npm-install-check.sh <plugin-dir> <tarball>}" && pwd)
tarball=$(cd "$(dirname "${2:?usage: npm-install-check.sh <plugin-dir> <tarball>}")" && pwd)/$(basename "$2")
registry_port=${REGISTRY_PORT:-4873}
server_port=${BB_TEST_SERVER_PORT:-39886}
daemon_port=${BB_TEST_DAEMON_PORT:-39887}
registry=http://127.0.0.1:$registry_port/
name=$(jq -r .name "$plugin_dir/package.json")
version=$(jq -r .version "$plugin_dir/package.json")
id=${name#*/}
id=${id#bb-plugin-}

work=$(mktemp -d)
# Every process this starts inherits the mark, the bb server's detached child
# and whatever a fixture starts included, so cleanup finds them all.
export NPM_INSTALL_CHECK=$work
pids=()
cleanup() {
  for pid in "${pids[@]}"; do kill "$pid" 2>/dev/null || true; done
  # bb-server hands the server to a detached child; find it by its data dir.
  local proc
  for proc in /proc/[0-9]*; do
    if [[ ${proc#/proc/} == "$$" ]]; then continue; fi
    if grep -qzxE "BB_DATA_DIR=$work/bb|NPM_INSTALL_CHECK=$work" "$proc/environ" 2>/dev/null; then
      echo "Stopping ${proc#/proc/}: $(tr '\0' ' ' < "$proc/cmdline")"
      kill "${proc#/proc/}" 2>/dev/null || true
    fi
  done
  wait 2>/dev/null || true
  rm -rf "$work"
}
trap cleanup EXIT

wait_for() {
  local what=$1 url=$2
  for _ in $(seq 60); do
    if curl -fs -o /dev/null "$url"; then return 0; fi
    sleep 1
  done
  echo "::error::$what did not answer at $url" >&2
  return 1
}

# Every command below reads this npmrc, the bb server's own npm included, and
# none reads the user's.
export HOME=$work/home
export TMPDIR=$work/tmp
mkdir -p "$HOME" "$TMPDIR"
export npm_config_userconfig=$HOME/.npmrc
export npm_config_registry=$registry

mkdir -p "$work/registry"
cat > "$work/registry/config.yaml" <<YAML
storage: ./storage
auth:
  htpasswd:
    file: ./htpasswd
uplinks:
  npmjs:
    url: https://registry.npmjs.org/
packages:
  '$name':
    access: \$all
    publish: \$authenticated
  '**':
    access: \$all
    proxy: npmjs
log: { type: stdout, format: pretty, level: warn }
YAML
npm install --prefix "$work/registry" --registry https://registry.npmjs.org/ \
  --no-audit --no-fund --silent verdaccio@6.10.4
"$work/registry/node_modules/.bin/verdaccio" --config "$work/registry/config.yaml" \
  --listen "127.0.0.1:$registry_port" > "$work/registry.log" 2>&1 &
pids+=("$!")
wait_for Verdaccio "${registry}-/ping"

token=$(curl -fsS -X PUT -H 'Content-Type: application/json' \
  -d '{"name":"ci","password":"ci-throwaway"}' \
  "${registry}-/user/org.couchdb.user:ci" | jq -r .token)
echo "//127.0.0.1:$registry_port/:_authToken=$token" > "$npm_config_userconfig"
npm publish "$tarball" --ignore-scripts --provenance=false --access public

unset_bb=(-u BB_SERVER_URL -u BB_THREAD_ID -u BB_PROJECT_ID -u BB_ENVIRONMENT_ID -u BB_CLI)
env "${unset_bb[@]}" BB_HOST_DAEMON_PORT="$daemon_port" BB_TELEMETRY=0 \
  bb-server --data-dir "$work/bb" --server-bind-host 127.0.0.1 --server-port "$server_port" \
  > "$work/server.log" 2>&1 &
pids+=("$!")
export BB_SERVER_URL=http://127.0.0.1:$server_port
if ! wait_for "bb server" "$BB_SERVER_URL/health"; then
  tail -50 "$work/server.log" "$work/bb/logs/server-stdio.log" >&2 || true
  exit 1
fi

# A primary machine, which a plugin's host entry and bb's AI services need:
# the key the server hands a daemon on its own machine, as bb-app asks for it.
enroll=$(curl -fsS -X POST -H 'Content-Type: application/json' -d '{}' "$BB_SERVER_URL/internal/hosts/enroll-key")
env "${unset_bb[@]}" BB_DATA_DIR="$work/bb" BB_HOST_DAEMON_PORT="$daemon_port" BB_TELEMETRY=0 \
  BB_HOST_ENROLL_KEY="$(jq -r .enrollKey <<< "$enroll")" BB_HOST_ID="$(jq -r .hostId <<< "$enroll")" \
  bb-host-daemon --server-url "$BB_SERVER_URL" --host-daemon-port "$daemon_port" \
  > "$work/host-daemon.log" 2>&1 &
pids+=("$!")
for _ in $(seq 60); do
  if [[ $(bb machine list --json | jq '[.[] | select(.status == "connected")] | length') -gt 0 ]]; then break; fi
  sleep 1
done
if [[ $(bb machine list --json | jq '[.[] | select(.status == "connected")] | length') -eq 0 ]]; then
  echo "::error::the host daemon did not connect to the bb server" >&2
  tail -50 "$work/host-daemon.log" >&2 || true
  exit 1
fi

# Fails with every warning and error in the plugin's own log.
check_log() {
  local lines
  lines=$(bb plugin logs "$id" -n 100000 | jq -Rc 'fromjson? | select(.level == "warn" or .level == "error")')
  if [[ -n $lines ]]; then
    echo "::error::$id logged a warning or an error:" >&2
    echo "$lines" >&2
    return 1
  fi
}

start=$SECONDS
bb plugin install "npm:$name@$version" --yes
echo "Installed npm:$name@$version in $((SECONDS - start))s"
bb plugin source "$id"
plugin_status() {
  bb plugin list --json | jq -r --arg id "$id" '.plugins[] | select(.id == $id) | .status'
}
# The first load must succeed: no reload, so a plugin that outlasts bb's
# 30-second load limit on a server that has just started fails here.
status=$(plugin_status)
if [[ $status != running ]]; then
  echo "::error::$id: installed from npm but its status is '$status', not running" >&2
  bb plugin logs "$id" -n 50 >&2 || true
  grep -F "$id" "$work/bb/logs/server-stdio.log" | tail -50 >&2 || true
  exit 1
fi
echo "$id: running"

shopt -s nullglob
toolchains=("$work/bb/plugins/toolchain-"*)
if [[ ${#toolchains[@]} -gt 0 ]]; then
  echo "::error::$id: bb downloaded a build toolchain, so it built the plugin instead of using the published dist/" >&2
  exit 1
fi

# After a bb upgrade that changes the plugin SDK version, bb ignores
# dist/server.js and loads server.ts from source, which needs the packages
# the server source imports. pack-npm.sh keeps only those in
# `dependencies`, so load the plugin that way too: stamp another SDK version
# on the installed bundle, then disable and enable the plugin.
root=$(bb plugin list --json | jq -r --arg id "$id" '.plugins[] | select(.id == $id) | .rootDir')
jq '.sdkVersion = "0.0.1" | .builtWith.pluginSdkVersion = "0.0.1"' "$root/dist/server.meta.json" > "$work/server.meta.json"
cp "$work/server.meta.json" "$root/dist/server.meta.json"
bb plugin disable "$id"
bb plugin enable "$id"
# bb writes its log a moment after `enable` returns.
fallback="plugin $id: ignoring prebuilt dist/server.js (built with SDK 0.0.1,"
for _ in $(seq 15); do
  if grep -qF "$fallback" "$work/bb/logs/server-stdio.log"; then break; fi
  sleep 1
done
if ! grep -qF "$fallback" "$work/bb/logs/server-stdio.log"; then
  echo "::error::$id: bb did not fall back to server.ts, so the source load went untested" >&2
  exit 1
fi
status=$(plugin_status)
if [[ $status != running ]]; then
  echo "::error::$id: loaded from server.ts, as after a bb upgrade, its status is '$status', not running; the npm package lacks a dependency the server source imports" >&2
  bb plugin logs "$id" -n 50 >&2 || true
  grep -F "$id" "$work/bb/logs/server-stdio.log" | tail -50 >&2 || true
  exit 1
fi
echo "$id: running from server.ts"

fixture=$plugin_dir/test/npm-install-fixture.sh
if [[ -e $fixture ]]; then
  mkdir -p "$work/fixture"
  if ! (cd "$plugin_dir" && PLUGIN_ID=$id FIXTURE_DIR=$work/fixture "$fixture"); then
    echo "::error::$id: its fixture failed ($fixture)" >&2
    check_log || true
    exit 1
  fi
  echo "$id: fixture passed"
fi

check_log
echo "$id: logged no warning or error"
