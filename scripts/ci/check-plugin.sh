#!/usr/bin/env bash
# Runs one plugin's CI checks. CI calls this; run it locally to reproduce a
# red job. Needs node, npm, git and the `bb` CLI on PATH.
#
#   scripts/ci/check-plugin.sh <plugin> [check|git-install]
#
# check        npm ci, type-check, tests, build, then fails when a generator
#              (third-party notices, and the manifest schema where the plugin
#              has one) would change a committed file.
# git-install  installs and builds the way bb does after cloning the
#              repository: production dependencies only, no install scripts.
set -euo pipefail

plugin=${1:?usage: check-plugin.sh <plugin> [check|git-install]}
mode=${2:-check}
cd "$(dirname "$0")/../../plugins/$plugin"

run() {
  if [[ -n ${GITHUB_ACTIONS:-} ]]; then echo "::group::$*"; else echo "+ $*"; fi
  "$@"
  if [[ -n ${GITHUB_ACTIONS:-} ]]; then echo "::endgroup::"; fi
}

case $mode in
  check)
    run npm ci --no-audit --no-fund
    run npx tsc --noEmit
    run npx vitest run
    run bb plugin build
    run npm run notices
    if [[ $(npm pkg get scripts.schema) != "{}" ]]; then run npm run schema; fi
    if [[ -n $(git status --porcelain -- .) ]]; then
      git status --short -- .
      git --no-pager diff --stat -- .
      echo "::error::$plugin: generated files are out of date; run the generators above and commit the result" >&2
      exit 1
    fi
    ;;
  git-install)
    run npm ci --omit=dev --omit=optional --ignore-scripts --no-audit --no-fund
    run bb plugin build
    ;;
  *)
    echo "unknown mode: $mode" >&2
    exit 2
    ;;
esac
