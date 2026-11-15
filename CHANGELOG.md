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

## [Unreleased]

### Development

- CI now checks formatting, lint and types on every push. The 17 existing lint errors are fixed.
- `TeamView` is split: the member card and the sprint capacity table are their own components.
- Groundwork for the trusted store (see `docs/trusted-store.md`): workspace roles and permission rules, and storage
  for workspaces, members and group mappings. Nothing uses them yet; the store's API is unchanged.
- `npm test` now runs the store's own suites in `store/src`, which it had been skipping.

### [MINOR] Store: workspace API

- The store serves a second API under `/v2`, beside the existing one, in which the server decides access: workspaces,
  members with viewer, editor and owner roles, identity-provider groups mapped to roles, and documents inside a
  workspace. The editor does not use it yet. See `docs/trusted-store.md`.
- `ADMIN_GROUPS` makes the members of an identity-provider group store administrators in that API.
  `WORKSPACE_CREATION` sets who may create workspaces there.

### [MINOR] Workspaces on a trusted store

- When the store it points at serves the workspace API, the editor shows **Workspaces** in the document manager: sign
  in, pick a workspace, create one if you are allowed to, add a copy of the open document to it, and open or delete its
  documents. A workspace document saves to the store as you edit and picks up other people's changes. There are no
  keys, devices or approvals: your role comes from the workspace's members and your identity-provider groups.
- Adding a document to a workspace makes a copy under a new id and opens the copy; the original stays in your browser.
- Viewers receive changes and send none. The canvas is not locked for them yet, so a viewer's own edits stay on their
  screen only.
- Against a store without the workspace API, nothing changes.
- Store: compacting a document through `/v2` must name the version it read, and is refused if the document has moved
  on, so a concurrent edit can no longer be erased by a compaction. The id `local` is refused for workspace documents.

### [MINOR] Plan tab

- Timeline, Team and Skill Tree are now one **Plan** tab with four sections: **Board**, **Gantt**, **Dependencies** and
  **Team**. The Board/Gantt toggle that used to sit in the Timeline toolbar is two of those sections. The Plan tab
  reopens on the section you last used.
- **Skill Tree** is renamed **Dependencies**, which is what it shows.
- The backlog is a column on the left of the board instead of a strip above it, so cards are dragged a short distance
  rather than up and down the page. Its header arrow folds it to a narrow rail; dropping a card on it, folded or not,
  unschedules the card. It is shown even when empty, so there is always somewhere to drop a card to unschedule it.
- **Show** in the board toolbar narrows the board to one program increment, and then to any sprints within it: one
  sprint, several side by side, or all. Only the board's columns change; capacity totals and the Gantt chart still
  cover every sprint.
- Sprint names and dates are folded under **Edit sprints** on each program increment by default, so the board starts
  higher on the page.
- The sprint selection and whether the backlog is folded are remembered per document in your browser and are not
  shared with collaborators.
- Capacity reads as one line and one bar. Each sprint shows "8 of 45 pts", then what is reserved and how many working
  days it has; each program increment shows what is planned, reserved and left. Click a sprint's capacity for the
  breakdown by person, as before. It is now a real button, so it works from the keyboard.
- Markers are a strip of chips above the board instead of a block of cards. Click a chip to open the marker.
- In the Gantt chart, each blocked or at-risk item says why on its own row, under its title. The list of warnings
  above the chart is folded to its count by default; click it for the full sentences. The item column is wider, so
  fewer titles are cut off.
- The Team section's heading and four summary cards are one line: people, points a day, and how holidays are counted.

## [0.98.2] - 2026-10-13

- Fixed duplicate ports in sub-diagrams when a node had multiple edges to the same node.

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
