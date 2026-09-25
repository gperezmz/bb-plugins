# Develop a plugin from this repository

Run a plugin from a clone of this repository, test it, and build it. Commands use Thread Glance; the others work the same way.

## Run a plugin from your checkout

Install the plugin from the checkout instead of from GitHub, then let bb rebuild and reload it on every change:

```sh
cd /path/to/bb-plugins
bb plugin install path:$PWD --plugin thread-glance
bb plugin dev plugins/thread-glance
```

A path install reads the files in place, so `bb plugin uninstall` leaves them on disk.

## Test, type-check and build

Every plugin has the same scripts. Run them in its folder:

```sh
cd plugins/thread-glance
npm install
npm test
npm run typecheck
npm run build
```

`bb plugin types --check` reports whether the plugin's SDK dependency matches the running bb; `bb plugin types` repins it.

## Run CI's checks

CI runs one script per plugin, and the same script runs from a checkout. It needs `bb` on your `PATH`. From the repository root:

```sh
scripts/ci/check-plugin.sh thread-glance
scripts/ci/check-plugin.sh thread-glance git-install
scripts/ci/check-plugin.sh thread-glance npm-install
```

The first installs, type-checks, tests, builds, reruns the plugin's generators and fails when one changes a committed file. The second installs the way bb does after cloning from GitHub, without dev dependencies, optional dependencies or install scripts, then builds; it fails when the build needs a package that only a dev install brings in. The third packs the [npm package](../../CONTRIBUTING.md#the-npm-package), publishes it to a local registry, and installs it into a throwaway bb server on a temporary data directory; it fails unless the plugin runs and bb built nothing. It needs `bb-server` on your `PATH` too, and leaves your own bb alone.

The repository-wide checks:

```sh
gitleaks git --redact .
lychee --offline --include-fragments '*.md' 'docs/**/*.md' 'plugins/*/*.md'
npm ci --prefix scripts/ci && node scripts/ci/check-mermaid.mjs
```

`lychee --offline` checks links to files in the repository and their `#` anchors, and skips web addresses.

## Turn on the commit hooks

Two hooks in `.githooks/` are off until you point git at them:

```sh
git config core.hooksPath .githooks
```

`pre-commit` scans the staged changes with [gitleaks](https://github.com/gitleaks/gitleaks) and blocks the commit when it finds a secret; without `gitleaks` on your `PATH` it warns and lets the commit through. `commit-msg` rejects a first line that is not a [Conventional Commit](https://www.conventionalcommits.org/en/v1.0.0/). `git config --unset core.hooksPath` turns both off.

## Scripts only one plugin has

### Thread Glance

| Script | When to run it |
|---|---|
| `npm run perf` | After changing how the list renders. It mounts the list over a snapshot of your own threads and reports render time and rows rendered per event. Without a snapshot it skips; the commands that take one are in the header of `perf/list-render.perf.tsx`. |

### Thread Usage

| Script | When to run it |
|---|---|
| `npm run prices` | To refresh the price snapshot bundled in `prices/`. The plugin fetches current prices at run time; the snapshot is only its [fallback](../reference/thread-usage-cost-sources.md#price-freshness). |
| `node test/fake-litellm.mjs --port 4455 --key sk-test` | To try gateway features without a gateway. Point the plugin at `http://127.0.0.1:4455`; it prints its `/__admin/*` routes for adding rows and failures when it starts. |

### Team Onboarding

| Script | When to run it |
|---|---|
| `npm run schema` | After changing `src/core/manifest.ts`, to regenerate [`schema/onboarding.schema.json`](../../plugins/team-onboarding/schema/onboarding.schema.json). |
| `npm run refresh-keys` | Before a release, to re-pin GitHub's SSH host keys from `api.github.com/meta`. |

## Third-party notices

Each plugin lists the code it bundles in its `THIRD_PARTY_NOTICES.md`, and CI fails when the committed file differs from what the script writes. After a dependency change, build, then regenerate it:

```sh
npm run build
npm run notices
```
