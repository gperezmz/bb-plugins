# Develop a plugin from this repository

Run a plugin from a clone of this repository, test it, and build it. Commands use Thread Glance; the other two work the same way.

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

Each plugin lists the code it bundles in its `THIRD_PARTY_NOTICES.md`. After a dependency change, build, then regenerate it:

```sh
npm run build
npm run notices
```
