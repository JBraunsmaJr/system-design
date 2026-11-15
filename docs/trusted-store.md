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

## Progress

1. **Done: rules and storage.** Permissions, workspaces, members, group mappings, with both storage implementations. Additive: nothing calls them yet and the existing API is untouched.
2. **Next: the API.** Routes under `/v2` for workspaces, members, group mappings, and documents within a workspace, served beside the existing API. Every route gets a test that someone outside the workspace is refused. Administrators come from an identity-provider group or role, replacing the `ADMIN_SUBJECTS` list. Documents gain a workspace and a plain title.
3. **Then: the editor.** A store client without keys, a workspace list and switcher, members and group mappings, an administration page, and the store address in settings.
4. **Last: removal.** The encrypted API, its tables, `src/crypto`, device enrolment, recovery, rotation, and their tests and documentation. The last release with encryption is tagged first.

## Moving from an encrypted store

There is no migration tool. Before upgrading, each team opens its documents in the current editor and saves them to files, then imports them into a workspace on the new store. Once the editor no longer speaks the encrypted protocol, the only way back into an old store is to run the old release.

## Open questions

- **Who may create workspaces.** `permissions.ts` supports "administrators only" and "anyone signed in". The default will be administrators only unless teams say otherwise.
- **Group changes during a session.** Groups are read at sign-in, so a change takes effect at the next sign-in. The session lifetime (eight hours by default) is therefore the longest someone keeps access after being removed from a group.
- **The last owner.** Nothing stops a workspace's only owner being removed, because an administrator can always manage it. If deployments run without administrators, this needs a guard.
