# Releasing

Releases are cut from [`CHANGELOG.md`](../CHANGELOG.md) by the **Release** workflow (`.github/workflows/release.yml`).

## While developing

Add a line item under `## [Unreleased]` for each change. Prefix it with a marker when
it should move the version:

```markdown
## [Unreleased]

- [MINOR] Timeline supports sprint markers
- [PATCH] Fix PDF font fallback
- Tidy the deployment docs
```

| Highest marker present | 0.97.3 becomes |
|------------------------|----------------|
| `[MAJOR]`              | 1.0.0          |
| `[MINOR]`              | 0.98.0         |
| `[PATCH]`              | 0.97.4         |

Markers can also go on a subheading (`###` or deeper) to cover the items grouped under it:

```markdown
## [Unreleased]

### [MAJOR] Breaking changes

- Remove the v1 store API

### [PATCH]

- Fix PDF font fallback
```

When released, the marker is removed and the heading keeps its text (`### Breaking changes`).
A heading that was only a marker is named after it instead (`### [PATCH]` becomes `### Patch`).

Markers must be upper case and come right after the list bullet or the `###`. Items without a
marker are still published; a release is refused only when no item has one.

## Cutting a release

Run **Actions → Release → Run workflow** on `main`. Tick **dry_run** first to see the
version and notes in the run summary without changing anything.

A real run:

1. Sets the new version in every `package.json` and lockfile, and renames
   `[Unreleased]` to `[x.y.z] - date` (UTC) with the markers removed.
2. Commits that to `main` and tags it `vx.y.z`.
3. Publishes a GitHub release for the tag, with that section as its notes.
4. Starts the workflows that run on a release (deploy, image publishing, perf, tests)
   against the tag. A release created by the workflow's own token does not trigger
   them by itself, so they are listed in `DOWNSTREAM_WORKFLOWS` in `release.yml`; add
   any new release-triggered workflow there (`npm test` fails until you do).
5. Commits a new, empty `[Unreleased]` section to `main`.

Publishing a release by hand on GitHub still works as before and triggers the same
workflows through their `release` trigger, but it does not update the changelog or
versions.

To preview locally: `npx tsx scripts/release.ts prepare --notes-file notes.md --dry-run`.
