# What every drive shares. A drive sources this, names itself with `drive`,
# makes its own threads with `spawn`, moves the clock with `advance_to`, checks
# bb's own records with `check`, and ends with `finish`, which archives its
# threads, prints PASS or FAIL with its wall time, and fails past 2 minutes.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/../config.sh"
if [[ ! -f $run/env.sh ]]; then
  echo "No harness runs at $run: start it with harness/start.sh" >&2
  exit 1
fi
source "$run/env.sh"

LIMIT_S=120
drive_name=
drive_start=
failures=0
# Every thread a drive made, "drive id" per line: spawn runs in a subshell.
threads_file=$run/drive-threads

now_s() { date +%s.%N; }
elapsed() { awk -v a="$drive_start" -v b="$(now_s)" 'BEGIN { printf "%.1f", b - a }'; }
say() { printf '[%s %5ss] %s\n' "$drive_name" "$(elapsed)" "$*"; }

drive() {
  drive_name=$1
  drive_start=$(now_s)
  trap 'say "FAIL: stopped at line $LINENO"; failures=$((failures + 1)); finish' ERR
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

# spawn <title> <prompt> [parent-id]: a Claude Code thread on the harness's
# project, in the parent's environment when there is one. Prints its id once
# its first turn has ended and Cache Keeper has read it.
spawn() {
  local title=$1 prompt=$2 parent=${3:-} args id
  args=(--project "$CK_HARNESS_PROJECT" --provider claude-code --model "claude-opus-5-5[1m]" --title "$title" --json)
  if [[ -n $parent ]]; then
    args+=(--parent-thread "$parent" --environment "$(bb thread show "$parent" --json | jq -r .environment.id)")
  else
    args+=(--machine "$CK_HARNESS_HOST" --environment-provider project-checkout)
  fi
  id=$(bb thread spawn "${args[@]}" --prompt "$prompt" | jq -r '.id // .thread.id')
  [[ $id == thr_* ]] || return 1
  echo "$drive_name $id" >> "$threads_file"
  settle "$id"
  echo "$id"
}

# tell <thread> <message>: a user message, then waits for the turn to end.
tell() {
  bb thread tell "$1" "$2" > /dev/null
  sleep 1
  settle "$1"
}

# archive <thread>: archives it, failing when bb does not.
archive() {
  bb thread archive "$1" > /dev/null
  [[ $(bb thread show "$1" --json | jq '.thread.archivedAt != null') == true ]]
}

# settle <thread>: waits for the thread to be idle, then for Cache Keeper to
# have handled every event so far.
settle() {
  bb thread wait "$1" --status idle --timeout 60s > /dev/null
  sleep 1
  bb cache-keeper drive now > /dev/null
}

# The plugin's clock, in epoch ms.
clock_now() { bb cache-keeper drive now | jq .now; }
# How far ahead of the wall the plugin's clock is now, in ms.
clock_offset() { bb cache-keeper drive now | jq .offsetAtNow; }

# advance_to <epoch ms>: moves the plugin's clock to that time, if it is ahead.
advance_to() {
  local ms=$(($1 - $(clock_now)))
  if ((ms > 0)); then bb cache-keeper drive advance "${ms}ms" > /dev/null; fi
}

# advance <duration>: moves the plugin's clock forward, e.g. 9m.
advance() { bb cache-keeper drive advance "$1" > /dev/null; }

# view <thread>: `bb cache-keeper status <thread> --json`.
view() { bb cache-keeper status "$1" --json; }

# requests <thread>: every turn bb recorded a request for, oldest first, as
# JSON lines {seq, at (wall ms), initiator, kind, text}, from bb's own event history.
requests() {
  local after=0 page
  while :; do
    page=$(curl -fsS "$BB_SERVER_URL/api/v1/threads/$1/events?order=asc&limit=100&afterSeq=$after&types=client/turn/requested")
    jq -c '.[] | {seq, at: .createdAt, initiator: .data.initiator, kind: .data.systemMessageKind, text: ((.data.input // []) | map(.text // "") | join(""))}' <<< "$page"
    [[ $(jq length <<< "$page") -lt 100 ]] && break
    after=$(jq '.[-1].seq' <<< "$page")
  done
}

# count_sent <thread> <regex>: how many requests bb recorded whose text matches.
count_sent() { requests "$1" | jq -s --arg re "$2" '[.[] | select(.text | test($re))] | length'; }

# sent_at <thread> <regex> <n>: when bb recorded the nth such request, on
# the plugin's clock; right for a request recorded after the last move.
sent_at() {
  local at
  at=$(requests "$1" | jq -s --arg re "$2" --argjson n "$3" '[.[] | select(.text | test($re))][$n - 1].at')
  echo $((at + $(clock_offset)))
}

# wait_sent <thread> <regex> <count>: waits up to 30 s for that many such
# requests, then for the thread to settle.
wait_sent() {
  for _ in $(seq 60); do
    if [[ $(count_sent "$1" "$2") -ge $3 ]]; then
      settle "$1"
      return 0
    fi
    sleep 0.5
  done
  return 1
}

# rpc <method> [json input]: calls one of Cache Keeper's RPC methods, as its
# chip, banner and Settings do, and prints the answer.
rpc() {
  local input=$run/tmp/rpc-input.$$.json
  printf '%s' "${2:-null}" > "$input"
  bb plugin rpc call cache-keeper "$1" --input-file "$input" --json
  rm -f "$input"
}

# config <key> <value>: sets one of Cache Keeper's settings.
config() { bb plugin config cache-keeper set "$1" "$2" > /dev/null; }

# eq <actual> <expected>: equality, printing both when they differ.
eq() {
  [[ $1 == "$2" ]] && return 0
  echo "    expected '$2', got '$1'" >&2
  return 1
}

# within <value> <low> <high>: a number within bounds, inclusive.
within() {
  if (($1 >= $2 && $1 <= $3)); then return 0; fi
  echo "    $1 is not within $2..$3" >&2
  return 1
}

KEEP_WARM='^Still waiting on '
COMPACT='^/compact '
CHECK_IN="Don't wait for me either way\\.$"

finish() {
  trap - ERR
  local t
  # Archived, a drive's threads are nothing later drives' clock moves may serve.
  for t in $(awk -v d="$drive_name" '$1 == d { print $2 }' "$threads_file" 2>/dev/null); do
    if ! archive "$t"; then
      say "FAILED: could not archive $t"
      failures=$((failures + 1))
    fi
  done
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
