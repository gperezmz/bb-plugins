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

`bb plugin types --check` reports whether the plugin's SDK dependency, and each devDependency bb shims at runtime, matches the running bb; `bb plugin types` repins them.

## Run CI's checks

CI runs one script per plugin, and the same script runs from a checkout, apart from one command it runs after the script's `check` mode. It needs `bb` on your `PATH`. From the repository root:

```sh
scripts/ci/check-plugin.sh thread-glance
(cd plugins/thread-glance && bb plugin types --check)
scripts/ci/check-plugin.sh thread-glance git-install
scripts/ci/check-plugin.sh thread-glance npm-install
```

The first installs, type-checks, tests, builds, reruns the plugin's generators and fails when one changes a committed file. The next line is the command CI's `check` job runs after it, in the plugin's folder: it fails when the SDK pin or a devDependency that bb shims differs from the bb in use, naming the package. It stays out of the script because the [compatibility run](../../CONTRIBUTING.md#the-compatibility-run) calls the script against newer bb releases, where an SDK pin that trails bb is only a warning. The second installs the way bb does after cloning from GitHub, without dev dependencies, optional dependencies or install scripts, then builds; it fails when the build needs a package that only a dev install brings in. The third packs the [npm package](../../CONTRIBUTING.md#the-npm-package), publishes it to a local registry, and installs it into a throwaway bb server on a temporary data directory, with a host daemon as its primary machine; it fails unless the plugin runs and bb built nothing, and unless it runs again when bb loads its `server.ts` from source, as bb does after an upgrade that changes the plugin SDK. Where the plugin has a fixture, `test/npm-install-fixture.sh`, it then configures the plugin and checks what the plugin registered: OpenAI-compatible inference's fixture points an Endpoint at a stub server and runs each AI task through it. UI Tweaks' checks that its app bundle registers the settings section, the overlay and the content script, that the tweaks read Medium on a fresh install, and that `setTweaks` keeps a change and refuses a choice outside the segments. Last, it fails when `bb plugin logs` holds a warning or an error, and prints them. It needs `bb-server` and `bb-host-daemon` on your `PATH` too, and leaves your own bb alone.

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

### Thread Usage

| Script | When to run it |
|---|---|
| `npm run prices` | To refresh the models.dev snapshot bundled in `prices/`. It needs Node 22.18 or later, which runs the TypeScript the script shares with the server. The plugin fetches current prices at run time; the snapshot is only its [fallback](../reference/thread-usage-cost-sources.md#price-freshness). |

## Third-party notices

Each plugin lists the code it bundles in its `THIRD_PARTY_NOTICES.md`, and CI fails when the committed file differs from what the script writes. After a dependency change, build, then regenerate it:

```sh
npm run build
npm run notices
```
