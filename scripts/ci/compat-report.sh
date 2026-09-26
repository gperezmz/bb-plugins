#!/usr/bin/env bash
# Reports one channel of the compatibility run (the Compatibility workflow) as
# a GitHub issue: opens one when the channel fails and none is open, comments
# on the open one when it fails again, and closes it when the channel passes.
# The channel's label finds its open issue, so each channel has at most one.
# Needs gh and jq, and a GH_TOKEN that can write issues.
#
#   scripts/ci/compat-report.sh <channel> <results-dir>
#
# Environment:
#   BB_VERSION  the exact bb-app version the channel resolved to; empty when
#               it did not resolve.
#   PLUGINS     JSON array of the plugin folders the run found; empty when it
#               did not list them.
#   RUN_URL     the workflow run, linked from every issue and comment.
#   DRY_RUN     when set, prints the issue commands instead of running them.
#
# <results-dir> holds one <plugin>.<mode>.json per check job, written by the
# workflow: {"failed": [step, ...], "pin": "...", "host": "..."}.
set -euo pipefail

channel=${1:?usage: compat-report.sh <channel> <results-dir>}
results=${2:?usage: compat-report.sh <channel> <results-dir>}
version=${BB_VERSION:-}
run_url=${RUN_URL:?RUN_URL is not set}
modes=(check npm-install)

case $channel in
  latest)
    label="bb latest broken"
    color=d73a4a
    description="Compatibility run: a released bb (npm latest) breaks a plugin"
    title="Released bb breaks plugins (bb-app@latest)"
    stakes="This bb is released, so anyone on it is affected."
    ;;
  nightly)
    label="bb nightly warning"
    color=fbca04
    description="Compatibility run: a bb nightly breaks a plugin; not released yet"
    title="Warning: bb nightly breaks plugins, not released yet (bb-app@nightly)"
    stakes="Warning: bb has not released this build yet. A release that carries it would fail as below."
    ;;
  *)
    echo "unknown channel: $channel" >&2
    exit 2
    ;;
esac

gh_write() {
  if [[ -n ${DRY_RUN:-} ]]; then
    printf 'DRY_RUN: gh'
    printf ' %q' "$@"
    printf '\n'
  else
    gh "$@"
  fi
}

failures=()
mismatches=()
if [[ -z $version ]]; then
  failures+=("Resolve \`bb-app@$channel\` on npm: no version")
fi
if [[ -z ${PLUGINS:-} ]] || ! jq -e 'type == "array" and length > 0' <<< "$PLUGINS" > /dev/null 2>&1; then
  failures+=("List the plugins under \`plugins/\`: none found")
  PLUGINS='[]'
fi
if [[ -n $version ]]; then
  while IFS= read -r plugin; do
    for mode in "${modes[@]}"; do
      result=$results/$plugin.$mode.json
      if [[ ! -f $result ]]; then
        failures+=("\`$plugin\` ($mode): the check job reported no result, so its checks did not all run")
        continue
      fi
      while IFS= read -r step; do
        failures+=("\`$plugin\` ($mode): $step")
      done < <(jq -r '.failed[]' "$result")
      pin=$(jq -r '.pin // ""' "$result")
      host=$(jq -r '.host // ""' "$result")
      if [[ -n $pin && -n $host && $pin != "$host" ]]; then
        mismatches+=("| \`$plugin\` | $pin | $host |")
      fi
    done
  done < <(jq -r '.[]' <<< "$PLUGINS")
fi

report=$(mktemp)
trap 'rm -f "$report"' EXIT
{
  if [[ ${#failures[@]} -gt 0 ]]; then
    echo "**\`bb-app@$channel\` ${version:-(unresolved)}** fails the compatibility run."
    echo
    echo "$stakes"
    echo
    echo "Failing:"
    echo
    printf -- '- %s\n' "${failures[@]}"
  else
    echo "**\`bb-app@$channel\` $version** passes the compatibility run."
  fi
  if [[ ${#mismatches[@]} -gt 0 ]]; then
    echo
    echo "SDK pins that differ from the one this bb ships. Reported only, they fail nothing; \`bb plugin types\` repins them:"
    echo
    echo "| Plugin | \`@get-bb/plugin-sdk\` pin | bb ships |"
    echo "|---|---|---|"
    printf '%s\n' "${mismatches[@]}"
  fi
  echo
  echo "Run: $run_url"
} > "$report"

cat "$report"
if [[ -n ${GITHUB_STEP_SUMMARY:-} ]]; then cat "$report" >> "$GITHUB_STEP_SUMMARY"; fi

open=$(gh issue list --label "$label" --state open --json number --jq 'sort_by(.number) | .[0].number // empty')

if [[ ${#failures[@]} -gt 0 ]]; then
  if [[ -n $open ]]; then
    gh_write issue comment "$open" --body-file "$report"
  else
    gh_write label create "$label" --color "$color" --description "$description" --force
    gh_write issue create --title "$title" --label "$label" --body-file "$report"
  fi
elif [[ -n $open ]]; then
  gh_write issue close "$open" --comment "$(cat "$report")"
fi
