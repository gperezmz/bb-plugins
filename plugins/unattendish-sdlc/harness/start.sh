#!/usr/bin/env bash
# Starts a throwaway bb with Unattendish installed from this checkout, for the
# drives: a fake Anthropic API (Cache Keeper's, so a Claude Code thread runs
# without spending tokens), the fake GitHub, GitLab, Linear and Jira of
# fake-services.ts, a bb server and a host daemon on a data dir under the run
# directory, one project, and one account for each of the four fakes, added through the
# plugin's RPC method `connect`. Claude Code in it talks to the fake API, with HOME
# in the run directory, so it reads none of your own configuration.
#
# Refuses to start, changing nothing, when any of its ports answers, when the
# run directory exists, or when a process of an earlier start is still
# running. Touches no other bb and hands the run no credential: every process
# of the run starts from an empty environment holding the passed list in
# ../../cache-keeper/harness/run-env.sh and what this script sets, and start
# fails, naming the variable and never its value, when a process it started
# holds a leak: a variable of yours, same name and value, outside the passed
# list and the names run-env.sh lists as set by the run. Writes nothing inside
# the checkout. Needs node 24, jq, curl, git, rsync and bb-app's `bb`,
# `bb-server` and `bb-host-daemon` on PATH. See config.sh for the ports.
#
#   harness/start.sh
#   source "$UD_HARNESS_DIR/env.sh"   # or /tmp/ud-harness/env.sh; then bb talks to the throwaway
#   harness/stop.sh
set -euo pipefail
# shellcheck source=config.sh
source "$(dirname "$0")/config.sh"

for tool in node jq curl git rsync bb bb-server bb-host-daemon; do
  command -v "$tool" > /dev/null || { echo "start.sh: $tool is not on PATH" >&2; exit 1; }
done
[[ -d $plugin_src/node_modules ]] || { echo "start.sh: run npm install in $plugin_src first" >&2; exit 1; }
[[ -f $fake_anthropic ]] || { echo "start.sh: $fake_anthropic is missing" >&2; exit 1; }
refuse=()
for port in "${ports[@]}"; do
  if port_busy "$port"; then refuse+=("port $port is in use"); fi
done
if [[ -e $run ]]; then refuse+=("$run exists (stop.sh removes it, or set UD_HARNESS_DIR)"); fi
left=$(harness_procs)
if [[ -n $left ]]; then refuse+=("$(wc -l <<< "$left") process(es) of an earlier start still run (stop.sh stops them), such as:"$'\n'"$(head -5 <<< "$left")"); fi
if [[ ${#refuse[@]} -gt 0 ]]; then
  printf 'start.sh: refusing to start: %s\n' "${refuse[@]}" >&2
  exit 1
fi

mkdir -p "$run/home" "$run/tmp" "$run/plugin" "$run/work/demo" "$run/manifests"
# What you hold, by name and salted hash, so the check below knows a leak.
run_env_record "$run/caller-env"
started=$SECONDS
fail() {
  echo "start.sh: $1" >&2
  for log in "$run/fake-anthropic.log" "$run/fake-services.log" "$run/server.log" "$run/bb/logs/server-stdio.log" "$run/host-daemon.log"; do
    [[ -f $log ]] && { echo "--- $log" >&2; tail -30 "$log" >&2; }
  done
  echo "start.sh: $(run_env_note)" >&2
  echo "start.sh: stop what started with harness/stop.sh" >&2
  exit 1
}
wait_for() {
  local what=$1 url=$2
  for _ in $(seq 60); do
    if "${base[@]}" curl -fs -o /dev/null "$url"; then return 0; fi
    sleep 1
  done
  fail "$what did not answer at $url"
}

# Every command from here that starts a process of the run, or reaches one,
# runs with the passed list, the mark and the run directory's HOME, and
# nothing else of the caller's environment.
base=(env -i "${run_env[@]}" "$mark" HOME="$run/home" TMPDIR="$run/tmp" BB_TELEMETRY=0
  GIT_AUTHOR_NAME=harness GIT_AUTHOR_EMAIL=harness@example.invalid GIT_COMMITTER_NAME=harness GIT_COMMITTER_EMAIL=harness@example.invalid)
server_url=http://127.0.0.1:$server_port
tb() { "${base[@]}" BB_SERVER_URL="$server_url" "$@"; }

# A copy of the plugin as the checkout has it now, without its build output,
# so bb builds what is checked out and writes nothing into the checkout.
"${base[@]}" rsync -a --exclude node_modules --exclude dist --exclude harness "$plugin_src/" "$run/plugin/unattendish-sdlc/"
"${base[@]}" ln -s "$plugin_src/node_modules" "$run/plugin/unattendish-sdlc/node_modules"

"${base[@]}" PORT="$api_port" REQUEST_LOG="$run/requests.jsonl" node "$fake_anthropic" > "$run/fake-anthropic.log" 2>&1 &
wait_for "the fake Anthropic API" "http://127.0.0.1:$api_port/_control"

"${base[@]}" GITHUB_PORT="$github_port" GITLAB_PORT="$gitlab_port" LINEAR_PORT="$linear_port" JIRA_PORT="$jira_port" \
  node "$harness/fake-services.ts" > "$run/fake-services.log" 2>&1 &
for service in "$github_port" "$gitlab_port" "$linear_port" "$jira_port"; do
  wait_for "a fake service" "http://127.0.0.1:$service/__admin/state"
done

"${base[@]}" BB_HOST_DAEMON_PORT="$daemon_port" \
  bb-server --data-dir "$run/bb" --server-bind-host 127.0.0.1 --server-port "$server_port" > "$run/server.log" 2>&1 &
wait_for "the bb server" "$server_url/health"

enroll=$("${base[@]}" curl -fsS -X POST -H 'Content-Type: application/json' -d '{}' "$server_url/internal/hosts/enroll-key") || fail "the bb server gave no host enroll key"
host_id=$(jq -r .hostId <<< "$enroll")
"${base[@]}" BB_DATA_DIR="$run/bb" BB_HOST_DAEMON_PORT="$daemon_port" \
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
"${base[@]}" git -C "$run/work/demo" init -q
"${base[@]}" git -C "$run/work/demo" commit -q --allow-empty -m "harness"
project=$(tb bb project create --name unattendish-drives --root "$run/work/demo" --machine "$host_id" --json | jq -r '.id // .project.id')
[[ $project == proj_* ]] || fail "could not create the drives' project"

tb bb plugin install "path:$run/plugin/unattendish-sdlc" --yes > "$run/install.log" 2>&1 || { cat "$run/install.log" >&2; fail "could not install the plugin"; }
status=$(tb bb plugin list --json | jq -r '.plugins[] | select(.id == "unattendish-sdlc") | .status')
[[ $status == running ]] || fail "the plugin's status is '$status', not running"

# One account for each fake, added through the plugin's RPC method `connect`
# as the dashboard's popup adds one: a loopback API address and a fake token.
# The fake answers the probe with its default login, `operator`, and
# `confirm: true` adds that login at once. The first account on a host or
# service becomes its default, so the drives' fleets (github.example/org/repo,
# gitlab.example/group/proj, tracker linear:ENG or jira:acme.atlassian.net/PROJ)
# read as them; the fakes' item URLs are on those hosts, which are never reached.
# A GitHub token is for one owner (`org`); GitLab's is for the host; Linear and
# Jira take one key. The Jira token is `email:api-token`.
connect() {
  local what=$1 input=$2 answer
  printf '%s' "$input" > "$run/tmp/connect.json"
  answer=$(tb bb plugin rpc call unattendish-sdlc connect --input-file "$run/tmp/connect.json" --json) || fail "could not call connect for $what"
  [[ $(jq -r '.result.outcome // .outcome' <<< "$answer") == saved ]] || fail "connect did not save the $what account: $(jq -c . <<< "$answer" | cut -c1-300)"
}
connect "GitHub" "$(jq -nc --arg api "http://127.0.0.1:$github_port" \
  '{account: {service: "github", place: "github.example", apiUrl: $api}, owner: "org", secret: {kind: "token", token: "ghp_harness_fake_token"}, confirm: true}')"
connect "GitLab" "$(jq -nc --arg api "http://127.0.0.1:$gitlab_port/api/v4" \
  '{account: {service: "gitlab", place: "gitlab.example", apiUrl: $api}, secret: {kind: "token", token: "glpat-harness-fake-token"}, confirm: true}')"
connect "Linear" "$(jq -nc --arg api "http://127.0.0.1:$linear_port/graphql" \
  '{account: {service: "linear", place: "linear.app", apiUrl: $api}, secret: {kind: "token", token: "lin_api_harness_fake_token"}, confirm: true}')"
connect "Jira" "$(jq -nc --arg api "http://127.0.0.1:$jira_port" \
  '{account: {service: "jira", place: "acme.atlassian.net", apiUrl: $api}, secret: {kind: "jira", email: "drive@example.invalid", token: "harness-fake-token"}, confirm: true}')"
rm -f "$run/tmp/connect.json"
[[ $(tb bb plugin rpc call unattendish-sdlc settings --json | jq -c '[(.result // .).accounts[] | .service] | sort') == '["github","gitlab","jira","linear"]' ]] || fail "the plugin does not list the four accounts"
[[ $(tb bb unattendish fleet status --json | jq -c .) == '{"fleets":[]}' ]] || fail "the plugin's fleet status is not empty on a fresh install"

# Every process the run holds now, checked for a leak, and gh inside the run
# for a token bb would hand its threads.
# shellcheck disable=SC2046 # one PID per word
run_env_start_check start.sh "$run/caller-env" "${base[@]}" -- $(harness_procs | cut -f1)

{
  echo "# Points bb at the harness's throwaway bb and nothing else. Source it."
  run_env_script
} > "$run/env.sh"
cat >> "$run/env.sh" <<ENV
unset BB_THREAD_ID BB_PROJECT_ID BB_ENVIRONMENT_ID BB_CLI BB_HOST_DAEMON_PORT BB_THREAD_STORAGE BB_DATA_DIR
# The run's mark, so stop.sh finds what this shell starts.
export $mark
export BB_SERVER_URL=$server_url
export HOME=$run/home TMPDIR=$run/tmp
export UD_HARNESS_DIR=$run UD_HARNESS_PROJECT=$project UD_HARNESS_HOST=$host_id UD_HARNESS_API=http://127.0.0.1:$api_port
export UD_HARNESS_GITHUB=http://127.0.0.1:$github_port UD_HARNESS_GITLAB=http://127.0.0.1:$gitlab_port
export UD_HARNESS_LINEAR=http://127.0.0.1:$linear_port UD_HARNESS_JIRA=http://127.0.0.1:$jira_port
ENV

echo "Throwaway bb up in $((SECONDS - started))s, Unattendish installed from $plugin_src (copied to $run/plugin)."
echo "  bb server        $server_url   (data dir $run/bb)"
echo "  host daemon      port $daemon_port, machine $host_id"
echo "  fake Anthropic   http://127.0.0.1:$api_port"
echo "  fake GitHub      http://127.0.0.1:$github_port"
echo "  fake GitLab      http://127.0.0.1:$gitlab_port"
echo "  fake Linear      http://127.0.0.1:$linear_port"
echo "  fake Jira        http://127.0.0.1:$jira_port"
echo "  project          $project ($run/work/demo)"
echo
echo "Point bb at it, and only at it, with:"
echo "  source $run/env.sh"
echo "which sets:"
sed -n 's/^export /  /p' "$run/env.sh"
