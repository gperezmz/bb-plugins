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

The first installs, type-checks, tests, builds, reruns the plugin's generators and fails when one changes a committed file. The second installs the way bb does after cloning from GitHub, without dev dependencies, optional dependencies or install scripts, then builds; it fails when the build needs a package that only a dev install brings in. The third packs the [npm package](../../CONTRIBUTING.md#the-npm-package), publishes it to a local registry, and installs it into a throwaway bb server on a temporary data directory, with a host daemon as its primary machine; it fails unless the plugin runs and bb built nothing, and unless it runs again when bb loads its `server.ts` from source, as bb does after an upgrade that changes the plugin SDK. Where the plugin has a fixture, `test/npm-install-fixture.sh`, it then configures the plugin and checks what the plugin registered: OpenAI-compatible inference's fixture points an Endpoint at a stub server and runs each AI task through it; Pocket Navigation's checks that bb serves its app bundle, that the bundle registers the sidebar navigation, and that bb takes it as its navigation. Cache Keeper's checks that its app bundle registers the composer chip and banner, the sidebar script, the nav page and the Agent tools settings section, that bb serves its timer, flame and crossed-out flame icons as SVG, that bb holds its four settings with check-ins off, that `bb cache-keeper --help` lists `compact-now` and no `now`, and that `bb cache-keeper` answers and that `bb cache-keeper on` and `bb cache-keeper keep-warm on` refuse a thread bb does not list. UI Tweaks' checks that its app bundle registers the settings section, the overlay and the content script, that the tweaks read Medium on a fresh install, and that `setTweaks` keeps a change and refuses a choice outside the segments. Last, it fails when `bb plugin logs` holds a warning or an error, and prints them. It needs `bb-server` and `bb-host-daemon` on your `PATH` too, and leaves your own bb alone.

A plugin that pins Playwright, as Thread Glance does, has tests named `*.browser.test.tsx` that run in Chromium, and the first check downloads Playwright's headless Chromium for them. Where that download cannot run, as on NixOS, point `CHROMIUM_PATH` at a system Chromium:

```sh
CHROMIUM_PATH=$(command -v chromium) scripts/ci/check-plugin.sh thread-glance
```

The npm-install check listens on fixed ports. To run two at once, give one of them others with `REGISTRY_PORT`, `BB_TEST_SERVER_PORT` and `BB_TEST_DAEMON_PORT`.

CI also proves the npm-install check fails when bb refuses what a plugin registers, whenever OpenAI-compatible inference or the check changes:

```sh
scripts/ci/npm-install-refusal-check.sh
```

It builds OpenAI-compatible inference with a registration bb refuses, and fails unless the npm-install check fails on it and prints bb's refusal.

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
| `npm run perf` | After changing how the list renders, and before opening a pull request of the list rewrite. It mounts the list over generated lists of 50, 300 and 1,500 threads, in jsdom and in headless Chromium, prints a table per list and the reading of every row of the budget ledger (`perf/ledger.ts`), writes the same numbers to `perf/results/perf.json`, and fails when an enforcing row is missed. It needs no bb running and takes several minutes. `PERF_THREADS` and `PERF_PROJECTS` add a snapshot of your own threads; the commands that take one are in the header of `perf/list-render.perf.tsx`. The ledger's deterministic rows also run in `npm test`. |

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

### Cache Keeper

| Script | When to run it |
|---|---|
| `npm run prices` | To refresh the price list bundled in `prices/`, the same one Thread Usage bundles. The plugin fetches current prices daily while Fetch current prices daily is on; the bundled list is its last fallback. |
| `npm run bench` | After changing the engine, the store or the host entry, to measure the plugin's CPU, bb calls, host calls and transcript bytes read at 50, 500 and 5,000 threads, on a restart, learning a 1, 10 and 35 MiB transcript, and for the page's overview, each next to its target. It runs the real server against a fake bb and the real host entry in about 5 minutes and writes `bench/out/results.md`; `node bench/run.mjs steady 500` runs one size. Its header comment lists every option. |
| `harness/start.sh`, `harness/drives/run-all.sh`, `harness/stop.sh` | To drive a change against real Claude Code threads on a throwaway bb with the plugin installed from your checkout, on a clock the harness moves forward, so a compaction, a tree keep-warm, the cost stop, a check-in, Skip and Undo and a reinstall are each reached in under 2 minutes. It needs Linux, `node`, `jq`, `curl`, `git`, `rsync`, `bb-server` and `bb-host-daemon`, and `npm install` in the plugin; it never touches your own bb. The [harness README](../../plugins/cache-keeper/harness/README.md) has the drives, the fake Anthropic API and the ports. |

## Third-party notices

Each plugin lists the code it bundles in its `THIRD_PARTY_NOTICES.md`, and CI fails when the committed file differs from what the script writes. After a dependency change, build, then regenerate it:

```sh
npm run build
npm run notices
```
