#!/usr/bin/env bash
# Proves the npm-install check catches a registration bb refuses: builds
# OpenAI-compatible inference from HEAD with its AI service registered with
# `kinds` in place of `complete`, which bb refuses and the plugin logs as a
# warning, then requires `check-plugin.sh openai-inference npm-install` to
# fail on it and to print bb's refusal. Runs in a detached worktree of HEAD
# in a temporary directory, removed at the end. CI runs it beside the plugin's
# own checks; it needs what check-plugin.sh needs.
#
#   scripts/ci/npm-install-refusal-check.sh
set -euo pipefail

repo=$(cd "$(dirname "$0")/../.." && pwd)
refusal='must declare complete, transcribe, or both'
work=$(mktemp -d)
cleanup() {
  git -C "$repo" worktree remove --force "$work/repo" 2>/dev/null || true
  rm -rf "$work"
}
trap cleanup EXIT

git -C "$repo" worktree add --quiet --detach "$work/repo" HEAD
server=$work/repo/plugins/openai-inference/server.ts
sed -i 's|^\( *\)complete: async (prompt, { signal }) => {|\1kinds: ["complete"],\n\1run: async (prompt, { signal }) => {|' "$server"
if ! grep -q 'kinds: \["complete"\]' "$server"; then
  echo "::error::server.ts no longer registers complete where this script expects it; update the sed above" >&2
  exit 1
fi
# pack-npm.sh packs the committed files.
git -C "$work/repo" -c user.name=ci -c user.email=ci@localhost commit --quiet --no-verify -am \
  "test: register the AI service with kinds in place of complete"

status=0
"$work/repo/scripts/ci/check-plugin.sh" openai-inference npm-install 2>&1 | tee "$work/check.log" || status=$?
if [[ $status -eq 0 ]]; then
  echo "::error::the npm-install check passed a build whose AI service bb refuses" >&2
  exit 1
fi
if ! grep -F "$refusal" "$work/check.log" | grep -qF '"level":"warn"'; then
  echo "::error::the npm-install check failed, but its output holds no plugin warning carrying bb's refusal ('$refusal')" >&2
  exit 1
fi
echo "The npm-install check failed on the refused registration, printing the plugin's warning:"
grep -F "$refusal" "$work/check.log"
