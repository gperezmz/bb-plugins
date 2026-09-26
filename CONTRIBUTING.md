# Contributing

## Pull requests

Branch from `main` and open a pull request against it. It merges when the **CI ok** check is green: that check passes when every other job in the CI workflow passed or was skipped. A plugin's jobs run only when the pull request touches its folder or the CI files. [Run CI's checks](docs/how-to/develop-plugins.md#run-cis-checks) says how to run the same checks from your checkout.

Change a plugin's dependencies with `npm install` in its folder, and commit `package-lock.json` and the regenerated `THIRD_PARTY_NOTICES.md` with it. Leave `@get-bb/plugin-sdk`, React and the other packages bb provides at runtime to `bb plugin types`, which pins them to the bb release the plugin targets.

## The compatibility run

CI tests a pull request against the bb it pins in `.github/actions/setup/action.yml`. The Compatibility workflow tests `main` against newer bb: every 6 hours, and when started by hand from the Actions tab, it resolves the `latest` and `nightly` releases of `bb-app` on npm to exact versions and runs every plugin's `check` and `npm-install` checks and `bb plugin types --check` against each.

Each channel keeps one issue open while it fails, and each failing run comments on it with the bb version, the failing plugins and checks, and the run. A `bb nightly warning` issue means a nightly build breaks a plugin before bb releases it; a `bb latest broken` issue means a released bb already does. The first passing run closes the issue. A plugin whose SDK pin differs from the SDK the tested bb ships is listed in the issue but fails nothing; `bb plugin types` repins it.

## Commit messages

Every commit's first line is a [Conventional Commit](https://www.conventionalcommits.org/en/v1.0.0/), scoped to the plugin it changes: `fix(thread-usage): count cached tokens once`. A change to the repository itself takes no scope, or `ci`, `docs` and so on as the type. The [commit hooks](docs/how-to/develop-plugins.md#turn-on-the-commit-hooks) check the form before the commit is made.

## Release a plugin

Each plugin is released on its own, from a tag named `<plugin>/v<version>`:

1. Set the new version in the plugin's `package.json`, and in its `package-lock.json` with `npm version <version> --no-git-tag-version` in its folder. Merge that to `main`.
2. Tag the merged commit and push the tag:

   ```sh
   git tag -a thread-glance/v0.2.0 -m "Thread Glance 0.2.0"
   git push origin thread-glance/v0.2.0
   ```

The Release workflow then checks that the tag names a plugin whose `package.json` has that version, runs the plugin's CI checks, publishes the plugin's npm package, and publishes a GitHub Release whose notes list the commits that touched the plugin since its previous tag. A tag that fails those checks gets no release; delete it, fix the cause and tag again. A version already on npm is never replaced, so a fix takes a new version.

### The npm package

Each plugin is published as `@gperezmz/bb-plugin-<name>`, the `name` in its `package.json`; the scope and the `bb-plugin-` prefix drop out of the plugin's id, so it stays `<name>`. `files` in `package.json` picks what the package holds: the `dist/` bundles, the sources, `skills/` and the notices. Its `dependencies` keep only the packages the server source imports, read from the server bundle's source map: the bundles inline every dependency, but bb loads `server.ts` from source instead of `dist/server.js` when `dist/server.meta.json` names an SDK version other than the running one, as after a bb upgrade. `scripts/ci/pack-npm.sh <plugin> [out-dir]` builds the package from the committed files and fails when it leaves out a bundle bb needs; the workflow publishes what it writes.

The workflow publishes with a provenance attestation, through [npm trusted publishing](https://docs.npmjs.com/trusted-publishers): the `npm` job gets a short-lived token from GitHub, so once a package exists no npm token is kept in the repository. It publishes only while the repository variable `NPM_PUBLISH` is `true`. npm trusts a workflow only for a package that already exists, so a new package takes an owner of the `@gperezmz` npm scope, once:

1. Add a granular npm access token that can publish to the scope as the repository secret `NPM_TOKEN`, and release the plugin. The `npm` job publishes with the token when the secret is set.
2. Trust the workflow: `npm trust github @gperezmz/bb-plugin-<name> --file release.yml --repo gperezmz/bb-plugins --environment npm`.
3. Delete the `NPM_TOKEN` secret and revoke the token. On the package's settings page, set publishing access to require two-factor authentication and disallow tokens.

To publish a tag again, for example one pushed before its package was set up, run the Release workflow by hand with the tag as input.
