#!/usr/bin/env bash
# Packs a plugin as the npm package bb installs without building: the
# committed files at HEAD, plus the dist/ bundles `bb plugin build` writes,
# as `npm pack` selects them through the plugin's `files`, with only the
# dependencies the server source needs. Builds in a temporary copy, so the
# checkout and its node_modules are left alone. The Release workflow
# publishes this tarball; run it to make the same one.
# Needs node, npm, git and the `bb` CLI on PATH.
#
#   scripts/ci/pack-npm.sh <plugin> [out-dir]
#
# Prints the tarball's path last.
set -euo pipefail

plugin=${1:?usage: pack-npm.sh <plugin> [out-dir]}
out=$(mkdir -p "${2:-.}" && cd "${2:-.}" && pwd)
repo=$(cd "$(dirname "$0")/../.." && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

run() {
  if [[ -n ${GITHUB_ACTIONS:-} ]]; then echo "::group::$*" >&2; else echo "+ $*" >&2; fi
  "$@" >&2
  if [[ -n ${GITHUB_ACTIONS:-} ]]; then echo "::endgroup::" >&2; fi
}

git -C "$repo" archive "HEAD:plugins/$plugin" | tar -x -C "$work"
cd "$work"

# The build needs only what bb itself installs from git, which CI's
# git-install check proves.
run npm ci --omit=dev --omit=optional --ignore-scripts --no-audit --no-fund
run bb plugin build

# bb refuses an npm plugin without these, so fail here rather than on
# someone's install.
required=(dist/server.js dist/server.meta.json)
if [[ $(jq -r '.bb.app // empty' package.json) ]]; then required+=(dist/app.js dist/app.meta.json); fi
if [[ $(jq -r '.bb.host // empty' package.json) ]]; then required+=(dist/host.js dist/host.meta.json); fi
packed=$(npm pack --ignore-scripts --dry-run --json | jq -r '.[0].files[].path')
for file in "${required[@]}"; do
  if ! grep -qx "$file" <<< "$packed"; then
    echo "::error::$plugin: the npm package leaves out $file; add it to \"files\" in package.json" >&2
    exit 1
  fi
done

# The bundles inline the plugin's dependencies, so npm would only download
# them again. Kept are those the server source imports: bb loads server.ts
# instead of dist/server.js once dist/server.meta.json no longer names the
# running SDK version, as after a bb upgrade that changes it. The server
# bundle's source map lists every module the server source reaches.
if [[ ! -f dist/server.js.map ]]; then
  echo "::error::$plugin: bb plugin build wrote no dist/server.js.map to read the server's packages from" >&2
  exit 1
fi
server_packages=$(jq -r '.sources[]' dist/server.js.map \
  | sed -nE 's#.*node_modules/((@[^/]+/)?[^/]+)/.*#\1#p' | sort -u | jq -Rn '[inputs]')
jq --argjson keep "$server_packages" \
  'if .dependencies then .dependencies |= with_entries(select(.key as $name | $keep | any(.[]; . == $name))) else . end' \
  package.json > package.json.tmp
mv package.json.tmp package.json
echo "$plugin: the package keeps dependencies $(jq -c '.dependencies // {} | keys' package.json)" >&2

tarball=$(npm pack --ignore-scripts --pack-destination "$out" --json | jq -r '.[0].filename')
echo "$out/$tarball"
