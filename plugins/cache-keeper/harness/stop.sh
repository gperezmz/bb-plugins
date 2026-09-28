#!/usr/bin/env bash
# Stops everything start.sh started, prints each process it stops, confirms
# that none still runs and that no harness port answers, then removes the run
# directory. It finds the processes by the mark in their environment or the
# throwaway bb's data dir, so it finds the bb server's detached child, Claude
# Code and its background commands too.
#
#   harness/stop.sh           # stop and remove the run directory
#   harness/stop.sh --keep    # stop and keep it, logs and bb's data included
set -uo pipefail
source "$(dirname "$0")/config.sh"
keep=false
[[ ${1:-} == --keep ]] && keep=true

procs=$(harness_procs)
if [[ -z $procs ]]; then
  echo "No harness process runs for $run."
else
  while IFS=$'\t' read -r pid cmd; do
    echo "Stopping $pid: $cmd"
    kill "$pid" 2>/dev/null
  done <<< "$procs"
fi
for _ in $(seq 20); do
  [[ -z $(harness_procs) ]] && break
  sleep 0.5
done
left=$(harness_procs)
if [[ -n $left ]]; then
  while IFS=$'\t' read -r pid cmd; do
    echo "Killing $pid, still running: $cmd"
    kill -9 "$pid" 2>/dev/null
  done <<< "$left"
  sleep 1
  left=$(harness_procs)
fi

status=0
if [[ -n $left ]]; then
  echo "stop.sh: still running:" >&2
  echo "$left" >&2
  status=1
else
  echo "No process of the harness runs."
fi
busy=()
for port in "${ports[@]}"; do
  if port_busy "$port"; then busy+=("$port"); fi
done
if [[ ${#busy[@]} -gt 0 ]]; then
  echo "stop.sh: something still answers on port(s) ${busy[*]}" >&2
  status=1
else
  echo "Ports ${ports[*]} are free."
fi

if [[ -e $run ]]; then
  if $keep; then
    echo "Kept $run."
  elif [[ $status -eq 0 ]]; then
    rm -rf "$run" && echo "Removed $run."
  else
    echo "Kept $run, since something still runs."
  fi
fi
exit $status
