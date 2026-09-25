#!/usr/bin/env bash
# Prints the release notes for a plugin tag: the commits touching the plugin
# since its previous tag (all of them for its first tag), then how to install
# the release. Needs the full history and tags.
#
#   [NPM_PACKAGE=<name>] scripts/ci/release-notes.sh <plugin>/v<version>
#
# With NPM_PACKAGE, the notes also give the install from npm.
set -euo pipefail

tag=${1:?usage: release-notes.sh <plugin>/v<version>}
plugin=${tag%%/v*}
version=${tag#*/v}

previous=$(git tag --list "$plugin/v*" --sort=-v:refname | grep -A1 -Fx "$tag" | sed -n 2p)
range=${previous:+$previous..}$tag

echo "## Changes"
echo
git log --no-merges --format='- %s (%h)' "$range" -- "plugins/$plugin"
if [[ -n $previous ]]; then
  echo
  echo "Since [\`$previous\`](https://github.com/${GITHUB_REPOSITORY:-gperezmz/bb-plugins}/compare/$previous...$tag)."
fi
cat <<NOTES

## Install

\`\`\`sh
bb plugin install git:https://github.com/${GITHUB_REPOSITORY:-gperezmz/bb-plugins}.git@$tag --plugin $plugin
\`\`\`
NOTES
if [[ -n ${NPM_PACKAGE:-} ]]; then
  cat <<NOTES

or, prebuilt, from [npm](https://www.npmjs.com/package/$NPM_PACKAGE/v/$version):

\`\`\`sh
bb plugin install npm:$NPM_PACKAGE@$version
\`\`\`
NOTES
fi
