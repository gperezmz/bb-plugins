#!/usr/bin/env bash
# Starts a throwaway bb with Cache Keeper installed from this checkout, for the
# drives: a fake Anthropic API, a bb server and a host daemon on a data dir
# under the run directory, with CACHE_KEEPER_DRIVE_CLOCK=1 so the drives can
# move the plugin's clock. Claude Code in it talks to the fake API, with HOME
# in the run directory, so it reads none of your own configuration.
#
# Refuses to start, changing nothing, when any of its ports answers, when the
# run directory exists, or when a process of an earlier start is still
# running. Touches no other bb: every variable that names one is unset for
# every command. Needs node, jq, curl, git, rsync and bb-app's `bb`,
# `bb-server` and `bb-host-daemon` on PATH. See config.sh for the ports.
#
#   harness/start.sh
#   source "$CK_HARNESS_DIR/env.sh"   # or /tmp/ck-harness/env.sh; then bb talks to the throwaway
#   harness/stop.sh
set -euo pipefail
source "$(dirname "$0")/config.sh"

for tool in node jq curl git rsync bb bb-server bb-host-daemon; do
  command -v "$tool" > /dev/null || { echo "start.sh: $tool is not on PATH" >&2; exit 1; }
done
refuse=()
for port in "${ports[@]}"; do
  if port_busy "$port"; then refuse+=("port $port is in use"); fi
done
if [[ -e $run ]]; then refuse+=("$run exists (stop.sh removes it, or set CK_HARNESS_DIR)"); fi
left=$(harness_procs)
if [[ -n $left ]]; then refuse+=("$(wc -l <<< "$left") process(es) of an earlier start still run (stop.sh stops them), such as:"$'\n'"$(head -5 <<< "$left")"); fi
if [[ ${#refuse[@]} -gt 0 ]]; then
  printf 'start.sh: refusing to start: %s\n' "${refuse[@]}" >&2
  exit 1
fi

mkdir -p "$run/home" "$run/tmp" "$run/plugin" "$run/work/demo"
started=$SECONDS
fail() {
  echo "start.sh: $1" >&2
  for log in "$run/fake-anthropic.log" "$run/server.log" "$run/bb/logs/server-stdio.log" "$run/host-daemon.log"; do
    [[ -f $log ]] && { echo "--- $log" >&2; tail -30 "$log" >&2; }
  done
  echo "start.sh: stop what started with harness/stop.sh" >&2
  exit 1
}
wait_for() {
  local what=$1 url=$2
  for _ in $(seq 60); do
    if curl -fs -o /dev/null "$url"; then return 0; fi
    sleep 1
  done
  fail "$what did not answer at $url"
}

# Every command from here runs with the run directory's HOME and none of the
# user's bb variables.
base=(env "${unset_bb[@]}" "$mark" HOME="$run/home" TMPDIR="$run/tmp" BB_TELEMETRY=0
  GIT_AUTHOR_NAME=harness GIT_AUTHOR_EMAIL=harness@example.invalid GIT_COMMITTER_NAME=harness GIT_COMMITTER_EMAIL=harness@example.invalid)
server_url=http://127.0.0.1:$server_port
tb() { "${base[@]}" BB_SERVER_URL="$server_url" "$@"; }

# A copy of the plugin as the checkout has it now, without its build output,
# so bb builds what is checked out and writes nothing into the checkout.
rsync -a --exclude node_modules --exclude dist --exclude harness "$plugin_src/" "$run/plugin/cache-keeper/"
ln -s "$plugin_src/node_modules" "$run/plugin/cache-keeper/node_modules"

"${base[@]}" PORT="$api_port" REQUEST_LOG="$run/requests.jsonl" node "$harness/fake-anthropic.mjs" > "$run/fake-anthropic.log" 2>&1 &
wait_for "the fake Anthropic API" "http://127.0.0.1:$api_port/_control"

"${base[@]}" CACHE_KEEPER_DRIVE_CLOCK=1 BB_HOST_DAEMON_PORT="$daemon_port" \
  bb-server --data-dir "$run/bb" --server-bind-host 127.0.0.1 --server-port "$server_port" > "$run/server.log" 2>&1 &
wait_for "the bb server" "$server_url/health"

enroll=$(curl -fsS -X POST -H 'Content-Type: application/json' -d '{}' "$server_url/internal/hosts/enroll-key") || fail "the bb server gave no host enroll key"
host_id=$(jq -r .hostId <<< "$enroll")
"${base[@]}" CACHE_KEEPER_DRIVE_CLOCK=1 BB_DATA_DIR="$run/bb" BB_HOST_DAEMON_PORT="$daemon_port" \
  BB_HOST_ENROLL_KEY="$(jq -r .enrollKey <<< "$enroll")" BB_HOST_ID="$host_id" \
  ANTHROPIC_BASE_URL="http://127.0.0.1:$api_port" ANTHROPIC_API_KEY=sk-ant-harness-fake \
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 DISABLE_AUTOUPDATER=1 \
  bb-host-daemon --server-url "$server_url" --host-daemon-port "$daemon_port" > "$run/host-daemon.log" 2>&1 &
connected() { [[ $(tb bb machine list --json | jq --arg id "$host_id" '[.[] | select(.id == $id and .status == "connected")] | length') -gt 0 ]]; }
for _ in $(seq 60); do
  if connected; then break; fi
  sleep 1
done
connected || fail "the host daemon did not connect to the bb server"

# A project for the drives' threads, in a git checkout under the run directory.
git -C "$run/work/demo" init -q
"${base[@]}" git -C "$run/work/demo" commit -q --allow-empty -m "harness"
project=$(tb bb project create --name cache-keeper-drives --root "$run/work/demo" --machine "$host_id" --json | jq -r '.id // .project.id')
[[ $project == proj_* ]] || fail "could not create the drives' project"

tb bb plugin install "path:$run/plugin/cache-keeper" --yes > "$run/install.log" 2>&1 || { cat "$run/install.log" >&2; fail "could not install the plugin"; }
status=$(tb bb plugin list --json | jq -r '.plugins[] | select(.id == "cache-keeper") | .status')
[[ $status == running ]] || fail "the plugin's status is '$status', not running"
# The bundled price list: the drives fetch nothing from the network.
tb bb plugin config cache-keeper set fetchPrices false > /dev/null
tb bb cache-keeper drive now > /dev/null || fail "the plugin has no drive commands: CACHE_KEEPER_DRIVE_CLOCK did not reach it"

cat > "$run/env.sh" <<ENV
# Points bb at the harness's throwaway bb and nothing else. Source it.
unset BB_THREAD_ID BB_PROJECT_ID BB_ENVIRONMENT_ID BB_CLI BB_HOST_DAEMON_PORT BB_THREAD_STORAGE BB_DATA_DIR
export BB_SERVER_URL=$server_url
export HOME=$run/home TMPDIR=$run/tmp
export CK_HARNESS_DIR=$run CK_HARNESS_PROJECT=$project CK_HARNESS_HOST=$host_id CK_HARNESS_API=http://127.0.0.1:$api_port
ENV

echo "Throwaway bb up in $((SECONDS - started))s, Cache Keeper installed from $plugin_src (copied to $run/plugin)."
echo "  bb server        $server_url   (data dir $run/bb)"
echo "  host daemon      port $daemon_port, machine $host_id"
echo "  fake Anthropic   http://127.0.0.1:$api_port"
echo "  project          $project ($run/work/demo)"
echo
echo "Point bb at it, and only at it, with:"
echo "  source $run/env.sh"
echo "which sets:"
sed -n 's/^export /  /p' "$run/env.sh"
