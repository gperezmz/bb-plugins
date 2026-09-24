# Contributing

## Pull requests

Branch from `main` and open a pull request against it. It merges when the **CI ok** check is green: that check passes when every other job in the CI workflow passed or was skipped. A plugin's jobs run only when the pull request touches its folder or the CI files. [Run CI's checks](docs/how-to/develop-plugins.md#run-cis-checks) says how to run the same checks from your checkout.

Change a plugin's dependencies with `npm install` in its folder, and commit `package-lock.json` and the regenerated `THIRD_PARTY_NOTICES.md` with it. Leave `@get-bb/plugin-sdk`, React and the other packages bb provides at runtime to `bb plugin types`, which pins them to the bb release the plugin targets.

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

The Release workflow then checks that the tag names a plugin whose `package.json` has that version, runs the plugin's CI checks, and publishes a GitHub Release whose notes list the commits that touched the plugin since its previous tag. A tag that fails those checks gets no release; delete it, fix the cause and tag again.
