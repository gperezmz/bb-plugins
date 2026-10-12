# shellcheck shell=bash
# shellcheck source=../config.sh
# What every drive shares. A drive sources this, names itself with `drive`,
# makes its manager threads with `spawn_manager`, registers fleets as a manager
# does with `register`, scripts the fake services with `fake_state`, waits for
# wakes with `wait_wakes`, checks with `check`, and ends with `finish`, which
# unregisters its fleets, archives its threads, prints PASS or FAIL with its
# wall time, and fails past 2 minutes.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/../config.sh"
if [[ ! -f $run/env.sh ]]; then
  echo "No harness runs at $run: start it with harness/start.sh" >&2
  exit 1
fi
# shellcheck disable=SC1091
source "$run/env.sh"

LIMIT_S=120
MARKER='🤖 unattendish agent'
drive_name=
drive_start=
manifests=
failures=0
# Every thread and fleet a drive made, "drive id" per line: spawn runs in a subshell.
threads_file=$run/drive-threads
repos_file=$run/drive-repos

now_s() { date +%s.%N; }
elapsed() { awk -v a="$drive_start" -v b="$(now_s)" 'BEGIN { printf "%.1f", b - a }'; }
say() { printf '[%s %5ss] %s\n' "$drive_name" "$(elapsed)" "$*"; }

drive() {
  drive_name=$1
  drive_start=$(now_s)
  trap 'say "FAIL: stopped at line $LINENO"; failures=$((failures + 1)); finish' ERR
  # Nothing of an earlier drive is left to answer: no fleet is registered, the fakes start empty, and the manifests are the drive's own.
  local leftover
  while read -r leftover; do bb unattendish fleet unregister "$leftover" > /dev/null; done < <(bb unattendish fleet status --json | jq -r '.fleets[].repo')
  manifests=$run/manifests/$drive_name
  rm -rf "$manifests"
  mkdir -p "$manifests"
  fakes_empty
}

# check <description> <command...>: runs the command; a non-zero exit is a failure.
check() {
  local what=$1
  shift
  if "$@"; then
    say "ok: $what"
  else
    say "FAILED: $what"
    failures=$((failures + 1))
  fi
}

# eq <actual> <expected>: equality, printing both when they differ.
eq() {
  [[ $1 == "$2" ]] && return 0
  echo "    expected '$2', got '$1'" >&2
  return 1
}

# contains <text> <fragment>: the text holds the fragment.
contains() {
  [[ $1 == *"$2"* ]] && return 0
  echo "    '$2' is not in: $1" >&2
  return 1
}

# lacks <text> <fragment>: the text does not hold the fragment.
lacks() {
  [[ $1 != *"$2"* ]] && return 0
  echo "    '$2' is in: $1" >&2
  return 1
}

# iso [date -d expression]: a UTC time as the fakes write them; `iso '+3 seconds'`
# is a little ahead of now, so a change dated with it is later than a
# registration made a moment before it.
iso() { date -u -d "${1:-now}" +%Y-%m-%dT%H:%M:%SZ; }

# ---- threads -----------------------------------------------------------

# spawn_manager <title> [sibling thread]: a Claude Code thread on the harness's
# project, which the fake Anthropic API answers, in the sibling's environment
# when there is one (two threads cannot each check out the project at once).
# Prints its id once its first turn has ended.
spawn_manager() {
  local args id
  args=(--project "$UD_HARNESS_PROJECT" --provider claude-code --model "claude-opus-5-5[1m]" --title "$1" --json --prompt "Hello")
  if [[ -n ${2:-} ]]; then
    args+=(--environment "$(bb thread show "$2" --json | jq -r .environment.id)")
  else
    args+=(--machine "$UD_HARNESS_HOST" --environment-provider project-checkout)
  fi
  id=$(bb thread spawn "${args[@]}" | jq -r '.id // .thread.id')
  [[ $id == thr_* ]] || return 1
  echo "$drive_name $id" >> "$threads_file"
  bb thread wait "$id" --status idle --timeout 60s > /dev/null
  echo "$id"
}

# archive <thread>: archives it, failing when bb does not.
archive() {
  bb thread archive "$1" > /dev/null
  [[ $(bb thread show "$1" --json | jq '.thread.archivedAt != null') == true ]]
}

# messages <thread>: every user message bb recorded for the thread, oldest
# first, as JSON lines {seq, text}, from bb's own event history.
messages() {
  local after=0 page
  while :; do
    page=$(curl -fsS "$BB_SERVER_URL/api/v1/threads/$1/events?order=asc&limit=100&afterSeq=$after&types=client/turn/requested")
    jq -c '.[] | {seq, text: ((.data.input // []) | map(.text // "") | join(""))}' <<< "$page"
    [[ $(jq length <<< "$page") -lt 100 ]] && break
    after=$(jq '.[-1].seq' <<< "$page")
  done
}

# wakes <thread>: the text of each wake the manager received, one JSON string per line.
wakes() { messages "$1" | jq -c 'select(.text | startswith("From Unattendish Fleet:")) | .text'; }
# wake_count <thread>
wake_count() { wakes "$1" | wc -l; }
# wake_text <thread> <n>: the nth wake's text, as written.
wake_text() { wakes "$1" | sed -n "${2}p" | jq -r .; }

# wait_until <seconds> <command...>: polls the command once a second until it succeeds.
wait_until() {
  local limit=$1
  shift
  for _ in $(seq "$limit"); do
    if "$@"; then return 0; fi
    sleep 1
  done
  return 1
}

# wakes_at_least <thread> <count>
wakes_at_least() { [[ $(wake_count "$1") -ge $2 ]]; }
# wait_wakes <thread> <count> [seconds]: waits for that many wakes (default 50 s).
wait_wakes() { wait_until "${3:-50}" wakes_at_least "$1" "$2"; }

# ---- the plugin's command line ----------------------------------------------

# register <thread> <repo> <tracker> <manifest> [register arguments]: runs `bb
# unattendish fleet register` as the manager thread does, which bb is told by
# BB_THREAD_ID, and prints the one JSON object it answers. The drives' contract
# version, operator, labels and marker are the defaults; an argument given
# after the manifest replaces the default of the same name.
register() {
  local thread=$1 repo=$2 tracker=$3 manifest=$4 args=() name value
  shift 4
  local -A defaults=([contract]=1 [operator]=olivia [label-spec]=spec [label-ready]=ready [label-in-progress]=in-progress [label-needs-input]=needs-input [marker]=$MARKER)
  for name in "${!defaults[@]}"; do
    value=${defaults[$name]}
    [[ " $* " == *" --$name "* ]] || args+=("--$name" "$value")
  done
  echo "$drive_name $repo" >> "$repos_file"
  BB_THREAD_ID=$thread bb unattendish fleet register --repo "$repo" --tracker "$tracker" --manifest "$manifest" "${args[@]}" "$@" --json
}

# status <repo>: the fleet's entry of `fleet status --json`.
status() { bb unattendish fleet status --json | jq -c --arg repo "$1" '.fleets[] | select(.repo == $repo)'; }

# polled <repo>: the fleet has been polled at least once.
polled() { [[ $(status "$1" | jq -r '.lastPolledAt // empty') != "" ]]; }

# ledger <repo> [fleet ledger options]: every entry, as JSON lines.
ledger() {
  local repo=$1
  shift
  bb unattendish fleet ledger "$repo" --json --limit 5000 "$@" | jq -c '.entries[]'
}
# ledger_rows <repo> [options]: the changes in the ledger, as JSON lines.
ledger_rows() { ledger "$@" | jq -c 'select(.type == "change") | .row'; }
# ledger_has <repo> [options]: the ledger holds a change under those options.
ledger_has() { [[ -n $(ledger_rows "$@") ]]; }
# polls <repo>: how many polls of a source the ledger holds.
polls() { ledger "$1" | jq -c 'select(.type == "poll")' | wc -l; }

# polls_over <repo> <count>
polls_over() { [[ $(polls "$1") -gt $2 ]]; }
# wait_poll <repo> <polls before> [seconds]: waits for a poll after that count.
wait_poll() { wait_until "${3:-50}" polls_over "$1" "$2"; }

# manifest <file> <repo> [ref link [in-flight rows]]: a manifest whose Inbox names one parked
# question (#7, at the repo's issue 7, unless given) and whose In flight table holds the rows given.
manifest() {
  local file=$1 repo=$2 ref=${3:-#7} link=${4:-https://$2/issues/7}
  {
    printf '# Fleet: %s\n\n## Inbox\n\n' "$repo"
    printf '| Ref | What | Waits for | Since | Link |\n| --- | --- | --- | --- | --- |\n'
    printf '| %s | A parked question | answer | 2026-10-12T09:00:00Z | %s |\n' "$ref" "$link"
    if (($# > 4)); then
      printf '\n## In flight\n\n| Ref | Work | Stage | Since | Builder | Link |\n| --- | --- | --- | --- | --- | --- |\n'
      printf '%s\n' "${@:5}"
    fi
  } > "$file"
}

# ---- the fake services -----------------------------------------------------

# fake_url <github|gitlab|linear|jira>
fake_url() {
  case $1 in
    github) echo "$UD_HARNESS_GITHUB" ;;
    gitlab) echo "$UD_HARNESS_GITLAB" ;;
    linear) echo "$UD_HARNESS_LINEAR" ;;
    jira) echo "$UD_HARNESS_JIRA" ;;
    *) return 1 ;;
  esac
}

# fake_state <service> <json>: loads the state a service answers from.
fake_state() { curl -fsS -X POST --data-binary "$2" "$(fake_url "$1")/__admin/state" > /dev/null; }
# fake_requests <service>: every request it was sent, as a JSON array.
fake_requests() { curl -fsS "$(fake_url "$1")/__admin/requests"; }

# fakes_empty: every fake with no state, and an empty request log.
fakes_empty() {
  local service
  for service in github gitlab linear jira; do
    curl -fsS -X POST "$(fake_url "$service")/__admin/reset" > /dev/null
    fake_state "$service" '{}'
  done
}

# gh_issue <number> <creator> [labels as a JSON list]: an open issue of the fake GitHub, updated a moment from now.
gh_issue() {
  jq -nc --argjson number "$1" --arg creator "$2" --argjson labels "${3:-[]}" --arg at "$(iso '+3 seconds')" \
    '{number: $number, state: "open", labels: $labels, assignees: [], creator: $creator, createdAt: $at, updatedAt: $at}'
}
# gh_comment <id> <issue> <user> <body>: a comment on one, made a moment from now.
gh_comment() {
  jq -nc --argjson id "$1" --argjson issue "$2" --arg user "$3" --arg body "$4" --arg at "$(iso '+3 seconds')" \
    '{id: $id, issue: $issue, user: $user, body: $body, createdAt: $at, updatedAt: $at}'
}
# gh_labelled <id> <issue> <actor> <label>: the event of the actor adding the label, a moment from now.
gh_labelled() {
  jq -nc --argjson id "$1" --argjson issue "$2" --arg actor "$3" --arg label "$4" --arg at "$(iso '+3 seconds')" \
    '{id: $id, issue: $issue, event: "labeled", actor: $actor, createdAt: $at, label: $label}'
}
# gh_state <repo path, owner/name> <issues, as JSON lines> [comments, as JSON lines] [events, as JSON lines]: loads them as that repository.
gh_state() {
  fake_state github "$(jq -nc --arg repo "$1" --argjson issues "$(jq -sc . <<< "$2")" --argjson comments "$(jq -sc . <<< "${3:-}")" --argjson events "$(jq -sc . <<< "${4:-}")" \
    '{repos: {($repo): {issues: $issues, comments: $comments, events: $events}}}')"
}

# fakes_read_only: every request the four fakes were sent was a read: a GET, or
# a GraphQL query to Linear that holds no mutation.
fakes_read_only() {
  local service bad
  for service in github gitlab jira; do
    bad=$(fake_requests "$service" | jq -c '[.[] | select(.method != "GET")] | length')
    [[ $bad == 0 ]] || { echo "    $bad non-GET request(s) reached the fake $service" >&2; return 1; }
  done
  bad=$(fake_requests linear | jq -c '[.[] | select(.method != "POST" or ((.body | fromjson | .query) | test("(^|[\\s}])mutation\\b")))] | length')
  [[ $bad == 0 ]] || { echo "    $bad request(s) to the fake Linear were not a query" >&2; return 1; }
}

# none_in <text>: none of the harness's fake tokens is in the text.
none_in() {
  local token
  for token in ghp_harness_fake_token glpat-harness-fake-token lin_api_harness_fake_token harness-fake-token; do
    lacks "$1" "$token" || return 1
  done
}

finish() {
  trap - ERR
  local t repo
  # A fleet left registered would be polled against the next drive's fakes.
  while read -r repo; do
    bb unattendish fleet unregister "$repo" > /dev/null 2>&1 || true
  done < <(awk -v d="$drive_name" '$1 == d { print $2 }' "$repos_file" 2>/dev/null)
  while read -r t; do
    if ! archive "$t"; then
      say "FAILED: could not archive $t"
      failures=$((failures + 1))
    fi
  done < <(awk -v d="$drive_name" '$1 == d { print $2 }' "$threads_file" 2>/dev/null)
  local secs
  secs=$(elapsed)
  if awk -v s="$secs" -v l="$LIMIT_S" 'BEGIN { exit !(s >= l) }'; then
    say "FAILED: took ${secs}s, over the ${LIMIT_S}s limit"
    failures=$((failures + 1))
  fi
  if ((failures == 0)); then
    echo "PASS $drive_name ${secs}s"
    exit 0
  fi
  echo "FAIL $drive_name ${secs}s ($failures check(s) failed)"
  exit 1
}
