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

### Requirements: a simpler toolbar

- The toolbar reads left to right as find, then arrange, then add: search, Filter and Select on the left; **Group by**
  (now one menu), the Table / Cards / Split buttons, the two manage buttons and **New Requirement** on the right.
- Collapse all and Expand all appear only in the Cards layout, where there are cards to fold.

### [MINOR] Requirements: the split view opens an item as a page

- The split view's right-hand pane shows the selected item as a page: its id, kind and title with **Show on diagram**,
  its statement, and a panel each for acceptance criteria, verification, the components it is on and its
  relationships.
- Criteria can be ticked and added in their panel, and verification set in its panel, without opening the editor.
  **Edit** swaps in the full card for everything else. Decisions still open as their card.

### [MINOR] Requirements: a table row opens for reading

- Opening a line in the table shows the item laid out to read rather than as a form: its statement, its acceptance
  criteria as boxes you can tick in place, its relationships, the components linked to it and how it is verified.
  **Edit** swaps in the full card; a new item opens straight into it.
- The table's columns are now ID, title, type, status, components and verification. Verification reads at a glance
  ("Test passing", "Inspection", "Test failing", "No method"). Sprint and assignee moved into the open row.
- Each group's heading shows how much of the group is verified.
- The gap filters are buttons with counts at the right of the coverage line (Not on diagram, Not verified, No
  acceptance criteria, No description); the coverage figures themselves now only report.

### [MINOR] Requirements: verification and acceptance criteria

- Requirements and constraints (and items of your own descriptive types) have a verification control in their header:
  a status (Not verified, Verified, Failing) and how it is checked (Test, Demonstration, Inspection, Analysis).
- Acceptance criteria are the task-list lines in an item's description (`- [ ] ...`, `- [x] ...`). The header shows
  how many are ticked, or flags that there are none.
- The table has a **Verification** column, the split view's outline shows the verification status as its dot, and the
  coverage line gains **Acceptance criteria** and **Verified**, each of which filters to the items still to go.
- The Markdown export writes each requirement's verification beneath its title.
- Existing documents need no change: an item with no verification reads as Not verified.

### Requirements: the split view's outline shows what is on the diagram

- Each requirement, goal or other descriptive item in the split view's outline is marked as linked to a component or
  flagged as not linked, matching the table and the coverage line. Decisions show their status dot as work items do.
  A legend at the foot of the outline explains the marks.

### [MINOR] Diagram: names stay readable when zoomed out

- Below 60% zoom the canvas switches to an overview: each component shows only its name, drawn larger the further out
  you are, and boundary names grow with it. Subtitles, property chips and badges, which can't be read at that size,
  are hidden until you zoom back in. Nodes keep their size, so edges don't move.
- Exported images are always drawn at full detail, whatever the editor's zoom. Presenting is unaffected.

### [MINOR] Palette: rail, search and recently used

- The palette is a narrow rail of buttons (search, System, Cloud, Shapes, Code, Git, Fragments) with the open palette's
  list beside it. Clicking the open palette's button folds the list away and leaves the rail; this replaces the
  dropdown and the separate hide control.
- A search box at the top of the list looks through every palette at once (system, cloud, shapes, code, git,
  boundaries and saved fragments) and shows where each result is filed. Press `/` to jump to it and `Escape` to clear
  it. `Enter` adds the first match to the middle of the canvas; any match can also be dragged.
- The last six things you added to a canvas are listed under **Recently used**, remembered in this browser.
- Palette rows are slightly tighter.

### [MINOR] Inspector: header and sections

- Selecting a component or boundary shows its icon, name and type at the top of the Inspector, with **Open sub-diagram**
  directly beneath instead of two thirds of the way down.
- The rest is grouped into sections that fold: Requirements, Properties, Tags, Linked document, and Appearance and
  order (icon, colour, arrange, lock). Each heading shows how many entries it holds. Appearance and order starts
  folded; which sections you fold is remembered in this browser.

### [MINOR] Diagram: quieter boundaries, minimap toggle, no popup on click

- Boundaries (regions, VPCs, trust boundaries) no longer have a pale grey fill, which came from the canvas library's
  defaults and grew paler where boundaries nest. A boundary's outline now sits on its real edge instead of 10px inside
  it, so it is drawn where it adopts nodes.
- The minimap is off until you turn it on with the new button in the canvas controls. The choice is remembered in this
  browser.
- Clicking a node or edge with a mouse no longer opens the description popup over the diagram: the click selects it and
  the Inspector shows the same details. Hovering still opens the popup, and so does a tap on a touch screen.

### [MINOR] Requirements: table and coverage

- The Requirements view opens as a table: one line per item with its type, status, sprint, assignee, linked components
  and relationship count. Click a line to open the item beneath it. The card list is still there as **Cards**, and
  **Split** is unchanged. A layout you already chose for a document is kept.
- A coverage line above the items counts how many descriptive items are linked to a component, how many items have a
  description, and how much of the work is done. The first two filter to the items that are missing.

### Store: API description

- `store/openapi.json` describes every route the store serves, with the role each needs, its request and its
  reply. A new test checks it against the store: it must list exactly the routes the store has, and every operation
  is called and its reply compared with the description.
- [PATCH] Appending an update and compacting a document now both reply with `{ document: { docId, version,
updatedAt } }`. Compacting used to return the storage layer's whole record, including who placed a legal hold.

### [MINOR] Toolbar: Share, one save status, readable buttons

- **Collaborate** is now **Share**. For a document in a workspace, the panel says which workspace it is in and that
  everyone who can edit it there joins its live session, and **Members of …** opens the workspace to add people.
- [PATCH] The Share panel no longer offers a session link for a workspace document. That link carries the session's
  key, so sending it to someone outside the workspace would have let them watch the document being edited wherever
  the relay does not require tokens. A session you start yourself on a document of your own still has its link.
- The toolbar shows one save status. The separate tick that said work was saved in the browser is removed; the save
  indicator already says where your work is.
- Filled buttons are darker (`--accent-fill`, #4a63e0), so their white text has a contrast of 5.1:1 instead of 3.7:1.
  Links, outlines and marks keep the lighter accent, which is what reads on the dark background.

### Store: storage no longer carries keys

- Documents are created without wrapped keys, and the store no longer keeps sealed metadata or sign-in evidence. This
  finishes the removal of the encrypted workspace.
- A database that held the encrypted workspace upgrades in place: the schema lifts the requirement that every
  document carry a wrapped key, and leaves the old columns, tables and documents untouched. A new test builds such a
  database and upgrades it. `docs/trusted-store.md` lists the columns that can be dropped afterwards.

### Documentation and example deployments

- The guides describe workspaces as they now work. **Deployment with Workspaces** no longer has a recovery-key step
  and ends with creating a workspace and giving a group a role. **Automatic Access from Groups** is replaced by
  **Groups and Roles**. **Administering a Workspace** is now **Administering Workspaces** and is done from the editor,
  with the API as an alternative. **Workspaces** and **How your work is protected** are rewritten for people using
  the editor, and say plainly that the server and its administrators can read workspace documents.
- The example deployments are updated to match: no recovery key or `keys` folder, `ADMIN_GROUPS` set so the first
  person in can create a workspace, and `WORKSPACE_CREATION` and `OIDC_GROUPS_CLAIM` shown. The Keycloak realms
  create a `notebook-admins` group, and in `docker/store` the `demo` account is in it.
- [PATCH] Store: a group is now named in the request body (`PUT /v2/workspaces/:id/groups`) or the query (`DELETE
…/groups?group=`) instead of the address. A name with a slash in it, which is every group Keycloak reports by full
  path, was rewritten by a reverse proxy serving the store under a prefix and stored under the wrong name.

### [MAJOR] The encrypted workspace is removed from the store

- The store no longer serves the encrypted workspace: the `/v1` routes for documents, the workspace index, keys,
  devices, recovery, join requests, access rules and administration answer 404. Workspaces and documents are served
  under `/v2`. `/v1/health`, `/v1/auth/...` and `/v1/rooms/:room/token` are unchanged in address.
- `/v1/health` no longer reports `cryptoMode` or `escrow`. `/v1/auth/providers` no longer reports `providerDetails`
  or `autoAccess`, and `/v1/auth/session` no longer reports `hasEvidence` or `evidenceIat`.
- `CRYPTO_MODE`, `RECOVERY_PUBLIC_KEY`, `RECOVERY_PUBLIC_KEY_FILE`, `AUTO_ACCESS` and `JOIN_EVIDENCE_RETENTION` are no
  longer read. A store that still sets them starts normally and lists them at startup as safe to remove.
- The retention sweep still runs on its timer. `POST /v1/admin/purge-due`, which ran it on demand, is removed;
  administrators remove a single deleted document from the workspace panel.
- **An existing database is not changed.** The tables and documents of the encrypted workspace are left as they are
  and are no longer created in a new database. `docs/trusted-store.md` has the statements to remove them once nothing
  in them is needed.
- The store image no longer includes `src/crypto`. `store/openapi.yaml`, which described only the removed routes, is
  deleted; the routes are listed in `docs/trusted-store.md`.

### [MAJOR] The encrypted workspace is removed from the editor

- The editor no longer works with a store from before workspaces. Documents in such a store were encrypted in the
  browser with keys held by enrolled devices; none of that remains: no device enrolment, comparison codes, recovery
  codes, key rotation, access requests or automatic access.
- **Before upgrading**, open each document you want to keep in the previous release and save it to a file (File >
  Save), then import it into a workspace on the upgraded store. There is no migration tool, and this release cannot
  read the old store.
- An editor pointed at an outdated store says so in File > Documents and keeps working with documents in the browser.
  A store that is merely unreachable is not reported as outdated.
- The save indicator's "Save to workspace" is now "Add to a workspace...", which opens the workspace panel.
- The "Linked document" picker lists the documents of every workspace you can see.
- `scripts/recover-document.ts` and `scripts/generate-recovery-key.ts` are removed with the recovery feature.

### [MINOR] Workspaces on a trusted store

- When the store it points at serves the workspace API, the editor shows **Workspaces** in the document manager: sign
  in, pick a workspace, create one if you are allowed to, add a copy of the open document to it, and open or delete its
  documents. A workspace document saves to the store as you edit and picks up other people's changes. There are no
  keys, devices or approvals: your role comes from the workspace's members and your identity-provider groups.
- Adding a document to a workspace makes a copy under a new id and opens the copy; the original stays in your browser.
- Viewers see a workspace document and cannot change it. The toolbar shows **View only**, the title cannot be typed
  into, nodes cannot be dragged or connected, and every other edit - from any view, the keyboard, or loading a file
  over the document - is refused before it is made, with a notice saying why. A viewer's copy is always exactly what
  the workspace holds.
- **Members** in the workspace panel shows who is in a workspace and which identity-provider groups are mapped to a
  role. Owners can add someone by name, map a group, change a role, remove either, and rename the workspace. People
  can be found once they have signed in to the store for the first time. Everyone in a mapped group gets its role when
  they sign in; no one approves them.
- You are asked to confirm a change that would remove your own access or your ability to manage the workspace, or
  that would leave it with no owner.
- Store administrators can archive a workspace, which hides it from its members without deleting anything, and
  restore it. Archived workspaces stay in an administrator's list, marked.
- **Store** in File > Documents shows which store this browser uses and lets you point the editor at one by its
  address. The address is checked before it is saved, and the page reloads once the store answers. A store chosen in
  the browser is used in place of the one the site was set up with, and can be removed to go back. The store must list
  the editor's origin in `ALLOWED_ORIGINS`.
- After signing in you return to the page and document you were on, instead of the store's configured address. The
  store accepts a `returnTo` address on its own origin or an allowed one and refuses any other.
- **Deleted** in the workspace panel lists the documents deleted from a workspace and how long each is kept. Editors
  and owners can restore one. Store administrators can place a hold with a reason, which keeps a document until the
  hold is released, and remove a deleted document for good.
- A document that comes back to a workspace while you have it open resumes saving when you return to the tab or open
  the workspace panel.
- [PATCH] Store: every reply now carries `Cache-Control: no-store`. A browser could keep an error reply, such as "that
  document is deleted", and go on showing it after the document was restored.
- Opening a workspace document puts everyone who can edit it in one live session, so you see each other's cursors
  and changes as they happen, without sharing a link. Viewers are not in the session; changes reach them through the
  store a few seconds later.
- Store: `GET /v2/documents/:id/session` gives a document's relay room and key to people who may edit it, with a relay
  token where `RELAY_TOKEN_SECRET` is set. The general room-token route refuses a document's room. Set
  `RELAY_TOKEN_SECRET` on the store and the relay so that someone removed from a workspace cannot rejoin a session
  they remember.
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
