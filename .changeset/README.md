# Changesets

Each change that should reach users gets a changeset: run `npm run changeset`, pick the bump, write one line about the change. On push to `main` the release workflow opens a version PR; merging it bumps `package.json` and `.claude-plugin/plugin.json`, rebuilds `bin/jig.mjs` and tags the release.

Docs: https://github.com/changesets/changesets
