---
name: release
description: Cutting an Axis release - choosing the version, running scripts/release.mjs, tagging, and what the tag-triggered release workflow does. Use when asked to release, publish, bump or set the version, write the changelog for a release, or decide whether a change is breaking.
---

# Releasing Axis

Every package is released together, at one version, and `CHANGELOG.md` covers
all of them. A pull request never changes a version: it adds a line under
**Unreleased**. The version is set once, when a release is cut, by the
maintainer.

## Choosing the version

- **Major** - a file that compiled before now errors or draws a different
  graph, or an export was removed or changed shape.
- **Minor** - a new function, property, statement or diagnostic; a renamed
  export that keeps its old name as a deprecated alias.
- **Patch** - a fix, or a change only to docs or the editor's behaviour.

Prefer deprecating to breaking: keep the old name as an alias marked
`@deprecated`, note it under **Deprecated**, and remove it in the next major.
A prerelease is `2.2.0-rc.0` or `2.2.0-beta.1`.

## Cutting one

Only from an up-to-date `main`, with CI green on it and something under
**Unreleased**:

```sh
git switch main && git pull
node scripts/release.mjs 2.2.0   # sets every version, dates the changelog
git diff                         # read it
git commit -am "Release 2.2.0"
git tag v2.2.0
git push origin main v2.2.0
```

`scripts/release.mjs` refuses when **Unreleased** is empty or the version
already has a section, before writing anything. It commits and tags nothing, so
the diff can be read first. Pushing the release commit straight to `main` works
for a repository admin, who bypasses the pull request rule.

Do not push the tag without being asked to: it is what publishes, and a version
on npm cannot be taken back.

## What the tag does

`.github/workflows/release.yml`, in the `release` environment, which waits for
the maintainer's approval:

1. checks the tag is on `main` and `CHANGELOG.md` has a section for it
2. runs `format:check`, `typecheck` and `pnpm test`, harness included
3. publishes every public package to npm by trusted publishing, with
   provenance, through `scripts/publish.mjs` - a prerelease under `next`, a
   release under `latest`
4. creates a GitHub release carrying that changelog section and the
   extension's `.vsix`
5. publishes the extension to the Marketplace once a `VSCE_PAT` secret exists,
   except for a prerelease, which the Marketplace does not take

`scripts/publish.mjs` skips a version already on npm, so a run that failed
part-way can be re-run. A failure that needs a code change is fixed on `main`
and released as the next version (`-rc.1`): a tag runs the workflow as it was
in the tagged commit.
