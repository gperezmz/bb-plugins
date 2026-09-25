#!/usr/bin/env bash
# Installs a packed plugin the way a bb server installs an npm: source, into a
# throwaway bb: publishes the tarball to a local registry (Verdaccio, which
# proxies every other package to registry.npmjs.org), starts a bb server on a
# temporary data directory, runs `bb plugin install npm:<name>@<version>`,
# then fails unless the plugin is running and bb downloaded no build
# toolchain, which it would only do to build the plugin itself.
# check-plugin.sh calls this; it needs node, npm and bb-app's `bb` and
# `bb-server` on PATH, and touches no other bb.
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
pids=()
cleanup() {
  for pid in "${pids[@]}"; do kill "$pid" 2>/dev/null || true; done
  # bb-server hands the server to a detached child; find it by its data dir.
  local proc
  for proc in /proc/[0-9]*; do
    if grep -qzx "BB_DATA_DIR=$work/bb" "$proc/environ" 2>/dev/null; then
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
mkdir -p "$HOME"
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

env -u BB_SERVER_URL -u BB_THREAD_ID -u BB_PROJECT_ID -u BB_ENVIRONMENT_ID \
  BB_HOST_DAEMON_PORT="$daemon_port" BB_TELEMETRY=0 \
  bb-server --data-dir "$work/bb" --server-bind-host 127.0.0.1 --server-port "$server_port" \
  > "$work/server.log" 2>&1 &
pids+=("$!")
export BB_SERVER_URL=http://127.0.0.1:$server_port
if ! wait_for "bb server" "$BB_SERVER_URL/health"; then
  tail -50 "$work/server.log" "$work/bb/logs/server-stdio.log" >&2 || true
  exit 1
fi

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
