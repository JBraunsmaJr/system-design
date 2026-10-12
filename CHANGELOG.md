# Changelog

All notable changes to this project are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow
[Semantic Versioning](https://semver.org/).

Add each change under `[Unreleased]`. Start a line, list item or `###`
subheading with `[MAJOR]`, `[MINOR]` or `[PATCH]` when it should move the
version; the release takes the highest marker present (resetting the lower
parts) and fails if there is none. Lines without a marker are still published. The
markers are removed when the section becomes a release. See
[docs/releasing.md](docs/releasing.md).

## [0.98.1] - 2026-10-12

Tweak to release pipeline

## [0.98.0] - 2026-10-12

### Duplicate scenarios and steps

- In the **Scenarios** panel, a new copy button next to **Present** and **Export** copies the whole scenario (every
  step, its narration, levels, and highlights) as "Title (copy)" and opens the copy
- Each step row has its own copy button, which inserts the copy right after that step and opens it.
- Copying a copy is named "(copy 2") and so on, not "(copy) (copy)". The copy shares nothing with the original, so
  editing one never changes the other.

### Reusable diagram fragments

- Select some nodes, right-click and choose **Save as fragment**, then give it a name.
- The palette has a new **Fragments** tab. Drag a fragment onto any diagram in any document: it lands with fresh ids,
  its top-left corner at the drop point.
  - It brings its connections, boundary contents and sub-diagrams with it.
  - You can rename fragments (double click) or delete them (click the bin twice)
- Saving removes things that only make sense in the source document: requirement links, document links, locks, internal
  level data and edge bends
- Fragments are stored in this browser, are checked when loaded, are copied at 1MB each, and stay in sync across tabs

### Filters and bulk edit (Requirements)

- Tags: these didn't exist on requirement items before. Each card has a tag editor that suggests tags already in the
  document, and tags match ignoring case. Search and the Markdown export include them.
- Filter: the toolbar has a filter button that opens Status, Assignee, Sprint and Tag menus
  - Choices within one menu are alternatives, different menus must all match
  - Unassigned, backlog, and untagged options find unplanned work
  - It works with search, every grouping and both layouts, and is remembered per document for each person
- Select: the toolbar's select button adds checkboxes to cards and to the rows in the split view's outline. Shift-click
  selects a range.
  - A bar appears to set status, sprint, category, or assignee, or to add or remove a tag
  - Each change is a single undo step, and in a shared session the whole change arrives together
  - Status, sprint, and assignee only apply to work items, matching what the cards show
  - Only ticked items that are currently shown are changed

## [0.97.0] - 2026-10-12

- Baseline for this changelog. Earlier release notes are on the
  [GitHub Releases](https://github.com/JBraunsmaJr/system-design/releases) page.
