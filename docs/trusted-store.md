# Trusted store: design and progress

This is the working design for the store's next access model. It records what was decided and why, what is built, and what is left, so the work can be picked up from the repository alone.

## Why

The store was built so the server could not read documents: every document was encrypted in the browser, and access meant holding a wrapped key. That protected against the server itself. It also meant:

- a new member waited until an existing member's browser was online to hand them the key,
- an administrator could not see or manage what the store held,
- every person on a store shared one workspace and one key, so teams could not be separated,
- each person had device enrolment and a recovery code to manage.

The teams using the store run it themselves, inside their own network, for one organization. For them the threat is traffic being read in transit, which TLS covers. The server is theirs, and they want it to behave like one.

## The model

The server is trusted. It stores documents as they are and decides every request from the signed-in person's role. Protection comes from TLS, the network boundary, disk and database encryption, and the audit trail.

- **Workspaces** hold documents. A store has as many as it needs.
- **Roles** are per workspace: `viewer`, `editor`, `owner`. Each may do everything the one before it may.
- **People get a role two ways:** individually, or because an identity-provider group they are in is mapped to a role in that workspace. Group membership is read from each sign-in and never stored, so access through a group needs nobody's approval and ends when the group membership does.
- **A person's role is the highest** of their individual role, their groups' roles, and `owner` if they are a store administrator. A role is a grant, never a restriction.
- **Store administrators** can do everything in every workspace, and are the only ones who can archive workspaces, purge documents, and place legal holds.

| Action                                          | Viewer | Editor | Owner | Administrator |
| ----------------------------------------------- | :----: | :----: | :---: | :-----------: |
| See the workspace, its members, its documents   |   ✓    |   ✓    |   ✓   |       ✓       |
| Create and edit documents                       |        |   ✓    |   ✓   |       ✓       |
| Delete documents, restore retained ones         |        |   ✓    |   ✓   |       ✓       |
| Rename the workspace, manage members and groups |        |        |   ✓   |       ✓       |
| Archive or restore a workspace                  |        |        |       |       ✓       |
| Purge documents, place legal holds              |        |        |       |       ✓       |

An archived workspace is hidden from its members and cannot be changed. Administrators can still read it, to decide whether to restore it.

Moving a document between workspaces needs the right to delete in the source and to write in the destination.

Access is per workspace only. There is no per-document sharing; if two groups need different documents, they need different workspaces.

## What this gives up

- A stolen database backup is readable unless disk or database encryption covers it.
- Store administrators can read documents.
- Tampering with stored documents is not detected by the client; the database's access controls and the audit trail are what guard against it.

## Where the rules live

| File                                    | What it is                                                              |
| --------------------------------------- | ----------------------------------------------------------------------- |
| `store/src/permissions.ts`              | The rules above. Pure: no I/O, no dependencies.                         |
| `store/src/permissions.verify.ts`       | Every role against every action, with the expected answers written out. |
| `store/src/workspaces.ts`               | The storage contract, and the in-memory implementation.                 |
| `store/src/postgresWorkspaces.ts`       | The PostgreSQL implementation.                                          |
| `scripts/verify-workspaces-contract.ts` | One suite run against both implementations.                             |
| `store/schema.sql`                      | `workspaces`, `workspace_members`, `workspace_group_roles`.             |

Route handlers must not decide access themselves. They load the grants with `grantsFor` and ask `canInWorkspace`.

## The API

Served under `/v2`, beside the existing API, which is unchanged. Sign-in still goes through `/v1/auth/...`; both APIs share one session.

| Route                                              | Needs         | What it does                                                                                                                                                                                  |
| -------------------------------------------------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /v2/health`                                   | nothing       | Says the store is in trusted mode. No sign-in needed.                                                                                                                                         |
| `GET /v2/me`                                       | signed in     | The caller, their groups, and what they may do store-wide                                                                                                                                     |
| `GET /v2/workspaces`                               | signed in     | The caller's workspaces, each with their role                                                                                                                                                 |
| `POST /v2/workspaces`                              | administrator | Create one. The creator becomes its first owner.                                                                                                                                              |
| `GET /v2/workspaces/:id`                           | viewer        | One workspace                                                                                                                                                                                 |
| `PATCH /v2/workspaces/:id`                         | owner         | Rename it                                                                                                                                                                                     |
| `POST /v2/workspaces/:id/archive`, `/restore`      | administrator | Hide it from its members, or bring it back                                                                                                                                                    |
| `GET /v2/workspaces/:id/members`                   | viewer        | Members and group mappings                                                                                                                                                                    |
| `PUT`, `DELETE /v2/workspaces/:id/members/:user`   | owner         | Add someone, change their role, remove them                                                                                                                                                   |
| `PUT /v2/workspaces/:id/groups`, `DELETE …?group=` | owner         | Map a group to a role, change it, remove it. The group is named in the body or the query, never the path: a proxy serving the store under a prefix would rewrite a name that contains a slash |
| `GET /v2/workspaces/:id/people?query=`             | owner         | Find people to add, by name                                                                                                                                                                   |
| `GET /v2/workspaces/:id/documents`                 | viewer        | List documents (`?deleted=true` needs editor)                                                                                                                                                 |
| `POST /v2/workspaces/:id/documents`                | editor        | Create a document                                                                                                                                                                             |
| `GET /v2/documents/:doc`                           | viewer        | The document and every update                                                                                                                                                                 |
| `PATCH /v2/documents/:doc`                         | editor        | Retitle it, or move it to another workspace                                                                                                                                                   |
| `DELETE /v2/documents/:doc`, `POST .../restore`    | editor        | Soft-delete it; restore it while it is retained                                                                                                                                               |
| `GET /v2/documents/:doc/updates?since=`            | viewer        | Updates after a version                                                                                                                                                                       |
| `POST /v2/documents/:doc/updates`, `.../compact`   | editor        | Append an update; replace the log with a snapshot                                                                                                                                             |
| `PUT`, `DELETE /v2/documents/:doc/hold`            | administrator | Place or release a legal hold                                                                                                                                                                 |
| `POST /v2/documents/:doc/purge`                    | administrator | Remove a document for good                                                                                                                                                                    |

With `WORKSPACE_CREATION=anyone`, any signed-in person may create a workspace.

**Refusals.** Someone with no role in a workspace gets 404 for it and for its documents, the same reply as for something that does not exist. Someone in the workspace whose role is not enough gets 403 with the reason. Store-wide actions are 403 for everyone but administrators.

**Where a request comes from.** A request that changes something must carry no `Origin`, the store's own origin, or one of `ALLOWED_ORIGINS`, and any body must be `application/json`. A page on another site therefore cannot spend a signed-in person's session.

**Administrators** are the people listed in `ADMIN_SUBJECTS` and the members of any group in `ADMIN_GROUPS`.

**Without sign-in** (development only) every request is the same local administrator.

A document's workspace comes from the store's catalog (`store/src/documentCatalog.ts`), never from the request. Document ids are chosen by the editor and are unique across the whole store.

| File                              | What it is                                                          |
| --------------------------------- | ------------------------------------------------------------------- |
| `store/src/v2/api.ts`             | Entry point: origin check, who is asking, routing                   |
| `store/src/v2/context.ts`         | `workspaceFor` and `documentFor`: the only places access is decided |
| `store/src/v2/workspaceRoutes.ts` | Workspaces, members, group mappings                                 |
| `store/src/v2/documentRoutes.ts`  | Documents                                                           |
| `store/src/documentCatalog.ts`    | Which workspace a document is in, and its title                     |
| `scripts/verify-store-v2.ts`      | Every route refused to everyone below its minimum, then exercised   |

## Progress

1. **Done: rules and storage.** Permissions, workspaces, members, group mappings, with both storage implementations.
2. **Done: the API.** The routes above, with a refusal test for every one, against memory and PostgreSQL. Administrators can come from an identity-provider group. Documents have a workspace and a plain title. Not yet done: tokens for live sessions through the relay, and an OpenAPI description.
3. **In progress: the editor.**
   - **Done: opening and saving.** The editor asks the store which API it serves (`/v2/health`) before it first renders, and remembers the answer. Against a trusted store it shows a workspace panel in the document manager: sign in, choose a workspace, create one, add a copy of the open document, open and delete documents. A workspace document saves to the store as it is edited and picks up other people's changes; a viewer's copy follows along and sends nothing. Against a store without `/v2` the editor behaves as before.
   - **Done: managing a workspace.** In the same panel, everyone in a workspace can see its members and mapped groups. Owners add people by name, map groups, change roles, remove either, and rename the workspace. Administrators archive and restore, and see archived workspaces in the list. A change that would cost the person making it their own access, or leave the workspace with no owner, is confirmed first (`src/collab/trusted/accessChanges.ts`).
   - **Done: choosing a store.** File > Documents shows which store the browser uses and lets someone point the editor at one. The address is checked before it is remembered, and the choice made in a browser wins over the one a deployment built in. Signing in returns to the page it started from.
   - **Done: deleted documents.** Editors and owners see what a workspace has deleted and how long it is kept, and can restore it. Administrators can place and release a hold, and remove a document for good.
   - **Done: live sessions.** Opening a workspace document puts everyone who may edit it in one session through the relay, so they see each other's cursors and changes as they happen. Viewers are not in it and follow through the store.
   - **Next:** nothing the encrypted mode did is now missing. What remains is the editor shell (one save status, Share in place of Collaborate, a canvas that is locked for viewers) and an OpenAPI description of `/v2`.
4. **In progress: removal.**
   - **Done: the editor.** The encrypted mode is gone from the editor: `src/crypto` (except what the store still imports until the next step), device enrolment, the comparison code, recovery, key rotation, automatic access, the key-based store client, and their panels and tests. An editor pointed at a store without `/v2` works on its own and says the store needs upgrading.
   - **Done: the store's API.** The `/v1` document, index, key, device, recovery, join-request, access-rule and administration routes are gone, with the modules behind them. What `/v1` still serves is about the person, not their documents: health, sign-in, and relay tokens for sessions started by link. `CRYPTO_MODE`, `RECOVERY_PUBLIC_KEY`, `RECOVERY_PUBLIC_KEY_FILE`, `AUTO_ACCESS` and `JOIN_EVIDENCE_RETENTION` are no longer read; a store that still sets them starts, and names them at startup.
   - **Done: the store's storage.** Documents carry no keys or sealed metadata, and sign-in keeps no evidence. A database from the encrypted workspace required a wrapped key on every document; the schema lifts that requirement where it finds it, and `scripts/verify-store-upgrade.ts` upgrades such a database and checks the old data is untouched.

The removal is complete. Nothing in the editor, the store or the documentation refers to the encrypted workspace except to say that it existed and how to move on from it.

- **Done: the documentation and the example deployments.** The guides under `docs-site/` describe workspaces as they are now; the example deployments no longer create a recovery key and name administrators by group, so the first person in can create a workspace. `scripts/verify-deployment-example.ts` checks both examples.

## An editor hosted somewhere else

An editor does not have to be served by the organization that runs the store: the public build can be pointed at a store from File > Documents. Three things must be true, and the store's startup checks already enforce the last two:

- The editor's origin is in the store's `ALLOWED_ORIGINS`. Without it the browser blocks every request, and the editor can only report that no store answered, naming the origin to add.
- The store is served over HTTPS, because a session cookie sent from another site must be `SameSite=None; Secure`.
- The browser allows that cookie. Browsers that block third-party cookies will sign in and then appear signed out. Serving the editor and the store under one site avoids this, and is the arrangement to prefer.

After signing in, the store sends the browser back to the page that started the sign-in (`returnTo`), if that page is on the store's own origin or an allowed one. Anything else is refused before the sign-in begins.

## Live sessions

A session needs two things: the name of a room on the relay, and a key that encrypts what passes through it. `GET /v2/documents/:id/session` gives both to someone who may edit the document, and refuses anyone else. A peer in a session can send changes straight to the others, so being able to read a document is not enough to be in its session.

- Both are derived from a random secret kept with the document (`workspace_documents.session_secret`), made the first time anyone asks. Everyone is given the same room, and the store keeps no record of who is in it.
- Where the relay requires tokens (`RELAY_TOKEN_SECRET` on the store and the relay), the reply includes one for that room and that person. The general route for room tokens refuses a document's room, so remembering a room's name is not a way back in.
- **Set `RELAY_TOKEN_SECRET` in a trusted deployment.** Without it the relay admits anyone who knows a room and its key, and someone removed from a workspace who kept both could rejoin the live session. They could not read or change what the store holds, but they would see edits as they were made. With it, they are refused at the relay. The secret is not rotated when membership changes: doing so would split people already in the session.
- A relay token lasts ten minutes and is used when the connection is made. A browser that loses its connection for longer reconnects with the token it had, and is refused until the document is reopened. The encrypted mode behaves the same way.

## Things the editor relies on

- **A browser's first document is never a workspace document.** Its id is `local` in every browser, so the store refuses that id and the editor never looks it up. Adding the open document to a workspace makes a copy under a new id and opens the copy.
- **Compaction names the version it read.** Replacing a document's update log with one snapshot is refused with a conflict if anything was appended since, so a concurrent edit is never erased. The encrypted API's compaction does not have this check.
- **No reply is cacheable.** Every response carries `Cache-Control: no-store`. Browsers may otherwise reuse an error such as "that document is deleted" after it stops being true, which is how this was found.
- **A tab that is not syncing looks again when someone returns to it.** Whether a document is in a workspace can change elsewhere (restored by a colleague, or access granted), and nothing pushes that to the browser.
- **Viewers are read-only in the store, not yet in the editor.** A viewer can still change their own copy on screen; nothing they change is sent, and the store would refuse it. Locking the canvas for viewers comes with the editor shell work.

## Upgrading a database that held an encrypted workspace

The schema is applied at every startup and only ever adds. It no longer creates the encrypted workspace's tables, and it does not drop them from a database that has them: dropping is not something a service should do to data on its own, and until every team has exported what it needs, those tables and the old documents are the only copy.

Left in place they cost nothing but space. The documents of the encrypted workspace stay in `documents` and `blobs`, unreachable through the API because no workspace lists them, and are not swept by retention unless they had already been deleted.

When nothing in the old workspace is needed any more, an administrator of the database can remove what is left:

```sql
BEGIN;
-- Documents that are in no workspace: everything the encrypted workspace held.
DELETE FROM documents d
 WHERE NOT EXISTS (SELECT 1 FROM workspace_documents w WHERE w.doc_id = d.doc_id);
DROP TABLE IF EXISTS join_requests, workspace_memberships, workspace_access_rules,
                     workspace_index, workspace_keys, user_recovery, devices;
ALTER TABLE users DROP COLUMN IF EXISTS user_public_key,
                  DROP COLUMN IF EXISTS last_groups,
                  DROP COLUMN IF EXISTS last_groups_at;
ALTER TABLE documents DROP COLUMN IF EXISTS wrapped_for_workspace,
                      DROP COLUMN IF EXISTS wrapped_for_recovery,
                      DROP COLUMN IF EXISTS sealed_meta;
ALTER TABLE sessions DROP COLUMN IF EXISTS id_token,
                     DROP COLUMN IF EXISTS commitment,
                     DROP COLUMN IF EXISTS evidence_iat;
ALTER TABLE pending_logins DROP COLUMN IF EXISTS has_commitment;
COMMIT;
```

Take a backup first. The `DELETE` cannot be undone, and it removes legal holds on those documents with them.

## Moving from an encrypted store

There is no migration tool. Before upgrading, each team opens its documents in the current editor and saves them to files, then imports them into a workspace on the new store. Once the editor no longer speaks the encrypted protocol, the only way back into an old store is to run the old release.

## Open questions

- **Group changes during a session.** Groups are read at sign-in, so a change takes effect at the next sign-in. The session lifetime (eight hours by default) is therefore the longest someone keeps access after being removed from a group.
- **The last owner.** The store does not stop a workspace's only owner being removed, because an administrator can always manage it. The editor warns before it happens. If deployments run without administrators, the store needs a guard too.
