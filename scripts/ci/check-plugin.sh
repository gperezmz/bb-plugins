#!/usr/bin/env bash
# Runs one plugin's CI checks. CI calls this; run it locally to reproduce a
# red job. Needs node, npm, git and the `bb` CLI on PATH.
#
#   scripts/ci/check-plugin.sh <plugin> [check|git-install|npm-install]
#
# check        npm ci, type-check, tests, build, then fails when a generator
#              (third-party notices, and the manifest schema where the plugin
#              has one) would change a committed file.
# git-install  installs and builds the way bb does after cloning the
#              repository: production dependencies only, no install scripts.
# npm-install  packs the npm package the Release workflow publishes, then
#              installs it with `bb plugin install npm:` into a throwaway bb
#              (npm-install-check.sh), which must run it without building.
set -euo pipefail

plugin=${1:?usage: check-plugin.sh <plugin> [check|git-install|npm-install]}
mode=${2:-check}
ci=$(cd "$(dirname "$0")" && pwd)
cd "$ci/../../plugins/$plugin"

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
  npm-install)
    out=$(mktemp -d)
    tarball=$("$ci/pack-npm.sh" "$plugin" "$out" | tail -1)
    run "$ci/npm-install-check.sh" . "$tarball"
    ;;
  *)
    echo "unknown mode: $mode" >&2
    exit 2
    ;;
esac
