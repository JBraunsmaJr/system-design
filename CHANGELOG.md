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

This file becomes the GitHub release notes, so write it for people who use or
deploy the notebook: what changed for them, in a line or two, grouped under a
few headings per release. Tests, refactoring, tooling and fixes to things that
were never released do not belong here; the commit history has those. One
entry describes a feature as it ships, not each step that led to it. Use
American English.

## [Unreleased]

- Fixed CSS issue

## [1.0.0] - 2026-11-17

### Workspaces replace the encrypted workspace

- **Workspaces.** When the editor points at a store, **Workspaces** in the document manager lets you sign in, pick or
  create a workspace, add a copy of the open document to it, and open or delete its documents. A workspace document
  saves to the store as you edit. There are no keys, devices or approvals.
- **Roles.** Each person is a viewer, an editor or an owner, set by the workspace's members and by identity-provider
  groups mapped to a role. Owners manage both under **Members**. Viewers see a document and cannot change it; the
  toolbar shows **View only**.
- **Live editing without a link.** Everyone who can edit a workspace document is in one live session when they open
  it, with each other's cursors and changes.
- **Deleted documents.** **Deleted** in the workspace panel lists what was deleted and how long it is kept. Editors
  and owners can restore a document; store administrators can hold one or remove it for good.
- **Administration.** Store administrators get an **Administration** page: every workspace with its people, groups,
  documents, last activity and status; a side panel to manage the selected one; who has access to what across the
  store; and every deleted document still being kept.
- **Choosing a store.** **Store** in File > Documents shows which store this browser uses and lets you point the
  editor at another by its address.
- **The encrypted workspace is removed**, along with device enrollment, comparison codes, recovery codes, key rotation
  and access requests. The store and its administrators can now read workspace documents.
- **Before upgrading**, open each document you want to keep in the previous release and save it to a file (File >
  Save), then import it into a workspace on the upgraded store. There is no migration tool, and this release cannot
  read the old store.
- **If you run a store:**
  - Workspaces and documents are served under `/v2`. The `/v1` routes of the encrypted workspace answer 404; health,
    sign-in and room tokens keep their addresses. `store/openapi.json` describes every route.
  - `CRYPTO_MODE`, `RECOVERY_PUBLIC_KEY`, `RECOVERY_PUBLIC_KEY_FILE`, `AUTO_ACCESS` and `JOIN_EVIDENCE_RETENTION` are no
    longer read. `ADMIN_GROUPS` names the group whose members administer the store, and `WORKSPACE_CREATION` sets who
    may create workspaces.
  - Set `RELAY_TOKEN_SECRET` on the store and the relay, so that someone removed from a workspace cannot rejoin a live
    session.
  - An existing database is upgraded in place and nothing in it is deleted. `docs/trusted-store.md` lists what can be
    dropped afterward.
  - The deployment guides and example deployments are rewritten for workspaces.

### Requirements: a table, verification and requirement details

- **Table.** The Requirements view opens as a table, one line per item. Click a line to open the item beneath it.
  **Cards** and **Split** are still there, and a layout you already chose for a document is kept.
- **Edit in place.** An open item, in the table or as a page in the split view, has no edit mode: change the title,
  type, tags, description, criteria and relationships where they stand.
- **Verification.** Requirements and constraints have a verification status (Not verified, Verified, Failing), a
  method (Test, Demonstration, Inspection, Analysis) and a short note.
- **Acceptance criteria.** Task-list lines in an item's description (`- [ ] ...`) are its acceptance criteria. Check,
  add and remove them from the open item.
- **Priority, status, owner and target.** Requirements have a priority (Must, Should, Could), a status of their own
  (Draft, In review, Approved, Implemented), an owner (the accountable stakeholder: a team member or a typed name) and
  a target milestone.
- **Coverage.** A line above the items shows how many are on the diagram, described, covered by acceptance criteria
  and verified, with buttons that filter to the ones that are not.
- **Who is editing.** In a live session, a table line shows a dot when someone else is working in that item, and the
  open item shows who.
- The toolbar is rearranged as find, arrange, add, and every menu in the view has the same look.
- The Markdown export includes all of the above. Existing documents need no change.

### Diagram: palette, Inspector and zooming out

- **Palette.** The palette is a rail of buttons with the open palette's list beside it. A search box looks through
  every palette at once (`/` jumps to it, `Enter` adds the first match), and the last six things you added are listed
  under **Recently used**.
- **Inspector.** A selected component shows its icon, name and type at the top with **Open sub-diagram** directly
  beneath. The rest is in sections that fold and remember whether you folded them.
- **Zoomed out.** Below 60% zoom each component shows only its name, drawn larger the further out you are. Exported
  images are always drawn at full detail.
- **Boundaries** no longer have a pale gray fill that grew paler where they nest, and their outline sits on their real
  edge.
- **Minimap.** Off until you turn it on from the canvas controls.
- Clicking a node or edge with a mouse selects it without opening the description popup. Hovering, or a tap on a
  touch screen, still opens it.

### Plan tab

- Timeline, Team and Skill Tree are one **Plan** tab with four sections: **Board**, **Gantt**, **Dependencies**
  (formerly Skill Tree) and **Team**.
- The backlog is a column on the left of the board that folds to a rail. Drop a card on it to unschedule the card.
- **Show** narrows the board to one program increment and to any of its sprints.
- Capacity reads as one line and one bar per sprint and per program increment. Click a sprint's capacity for the
  breakdown by person.
- Markers are a strip of chips above the board.
- In the Gantt chart, each blocked or at-risk item says why on its own row.

### Toolbar: Share and one save status

- **Collaborate** is now **Share**. For a workspace document it says which workspace the document is in and opens its
  members; it no longer offers a session link, which could have let someone outside the workspace watch the document.
- The toolbar shows one save status, which says where your work is.
- Filled buttons are darker, so their white text is easier to read.

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
  - Only checked items that are currently shown are changed

## [0.97.0] - 2026-10-12

- Baseline for this changelog. Earlier release notes are on the
  [GitHub Releases](https://github.com/JBraunsmaJr/system-design/releases) page.
