# Administering Workspaces

Most of what happens in a workspace needs no administrator. Owners add and
remove people, map groups, and rename their workspace; editors create,
delete and restore documents. A few things are reserved for **store
administrators**, because they reach across workspaces or override
retention:

- creating workspaces (unless the store lets anyone);
- seeing and managing every workspace, as an owner of each;
- archiving a workspace and bringing it back;
- placing and releasing legal holds;
- removing a deleted document before its retention ends.

All of it is done in the editor. The same actions are available over the
store's API for scripts; see [The API](#the-api).

## The Administration page

Sign in as an administrator and open **File → Documents**. Beside your name
is a **Store admin** badge and an **Administration** button, which opens a
page covering the whole store:

- **Workspaces** lists every workspace with how many people and groups are
  in it, how many documents it holds, when it was last changed, and whether
  it is active or archived. **New workspace** creates one. Click a line to
  open the workspace beside the table, where you rename it, give groups and
  people a role, and archive or restore it.
- **People and groups** shows each identity-provider group and each person
  added by name, with every workspace they reach and their role there.
- **Deleted documents** shows what is being kept in each workspace, to
  restore, hold or remove for good.

Someone who is not an administrator does not see the button. If they are in
no workspace, the Workspaces panel tells them so and lists the groups their
sign-in reported, which is the first thing to check when a group mapping
does not seem to work.

::: warning What an administrator can see
An administrator can open every workspace and read every document. So can
anyone with access to the store's database or its backups. Keep the list of
administrators short, and treat the database as you would the documents in
it. [How your work is protected](/guide/security) says this to your users.
:::

## Who is an administrator

Two settings on the store name them. Either is enough; both can be used.

**By group**, which is the one to prefer. Members of these groups are
administrators, decided each time they sign in, so you add and remove
administrators at your identity provider:

```yaml
ADMIN_GROUPS: /notebook-admins
```

Spell each group exactly as it appears in the groups claim. With Keycloak's
full group paths that includes the leading slash.
[Groups and Roles](/deployment/group-access) covers getting groups into the
token.

**By person**, as `issuer#subject`, comma separated. Useful where sign-in
has no groups (GitHub), or to name one person regardless of their groups:

```yaml
ADMIN_SUBJECTS: https://keycloak.example.gov/realms/design#9b1f3c52-6a1e-4c3a-9d2e-1f0a7b5c4e21
```

The subject is your provider's identifier for the person - for Keycloak, a
UUID - not their username. To find yours, sign in to the editor and open
`https://store.example.gov/v1/auth/session`.

Restart the store after changing either setting. To check, open
`https://store.example.gov/v2/me` while signed in: `isAdmin` should be
`true`. With neither setting, there are no administrators, and with the
default `WORKSPACE_CREATION=admins` nobody can create a workspace.

## Workspaces

**Create one** with **New workspace** in the Workspaces panel. Name it for
the team that will use it; names must be unique. Then open **Members** and
give the team's group a role, or add people by name.

**Who creates workspaces** is the store's `WORKSPACE_CREATION` setting:
`admins` (the default) or `anyone`, meaning anyone signed in. Whoever creates
a workspace is its first owner.

**Rename** a workspace from the panel. Its documents and members are
unaffected.

**Archive** a workspace when a team is finished with it. Its members no
longer see it or its documents; nothing is deleted. It stays in your list,
marked _(archived)_, where **Restore** brings it back exactly as it was.
Nothing in an archived workspace can be changed until then.

There is no way to delete a workspace. Archive it, and let retention deal
with any documents deleted from it beforehand.

## Members

Open a workspace and choose **Members**. As an administrator you are an
owner of every workspace, so you can do everything an owner can:

- add someone by name, once they have signed in to the store at least once;
- give a group a role;
- change or remove either.

The editor asks before a change that would leave a workspace with no owner.
The store allows it, because an administrator can always put it right.

## Deleted documents

Deleting a document from a workspace keeps it for the store's
`RETENTION_PERIOD`, so it can be brought back. Open a workspace and choose
**Deleted** to see what is being kept and for how long.

| `RETENTION_PERIOD`       | A deleted document is                                    |
| :----------------------- | :------------------------------------------------------- |
| `immediate`              | Removed at once. Nothing is kept.                        |
| a duration, such as `7y` | Restorable for that long, then removed. Default `30d`.   |
| `indefinite`             | Kept until an administrator removes it, however long ago |

Editors and owners can **Restore** a document. Two more actions are yours
alone.

### Legal hold

**Hold** keeps a deleted document past its retention until you **Release**
it. You give a reason, which is recorded with the hold and in the audit
trail. A held document cannot be removed, by retention or by you, until the
hold is released.

Holds are placed on deleted documents, from the **Deleted** list. A document
that is still live is not at risk of being removed; if it must not be
deleted either, that is a matter for the workspace's roles.

### Removing a document for good

The bin icon beside a deleted document removes it now, without waiting for
its retention. The editor asks first. **This cannot be undone**, by anyone:
the document and its history are gone from the store. Copies in people's
browsers and in your backups are unaffected.

## Reading the audit trail

The store records every request - who, what, which document, and whether it
was allowed - in PostgreSQL's `audit_log` table. There is no screen for it;
read it with SQL:

```sql
-- Everything that happened to one document, newest first.
SELECT at, subject, operation, outcome, detail
FROM audit_log
WHERE doc_id = '3f6e2b1c-…'
ORDER BY at DESC;

-- Everything one person did in the last week.
SELECT at, operation, doc_id, outcome, detail
FROM audit_log
WHERE subject = 'https://keycloak.example.gov/realms/design#9b1f3c52-…'
  AND at > now() - interval '7 days'
ORDER BY at DESC;

-- Changes to who is in which workspace.
SELECT at, subject, operation, detail
FROM audit_log
WHERE operation LIKE 'workspace.%' AND outcome = 'ok'
  AND operation NOT IN ('workspace.list', 'workspace.read', 'workspace.members')
ORDER BY at DESC;

-- Holds placed and released, and documents removed for good.
SELECT at, subject, operation, doc_id, detail
FROM audit_log
WHERE operation IN ('document.hold', 'document.release', 'document.purge')
ORDER BY at DESC;

-- Refusals, which are where problems and probing both show up.
SELECT at, subject, operation, detail
FROM audit_log
WHERE outcome = 'denied'
ORDER BY at DESC
LIMIT 100;
```

`subject` is `issuer#subject`, as in `ADMIN_SUBJECTS`. Operations are named
for what was done: `workspace.create`, `workspace.member.put`,
`workspace.group.put`, `document.append`, `document.delete`,
`document.restore` and so on.

Worth knowing: the log is append-only **by convention** - the store never
updates or deletes a row - not by database permissions. If your assessment
requires tamper resistance, grant the store's database role `INSERT` and
`SELECT` on `audit_log` only, and ship the table to your log platform.

## The API

Everything above is a call to the store, under `/v2`. Scripts can make the
same calls with the session a browser holds after signing in.

::: code-group

```js [From the editor's console]
// Sign in to the editor, open the browser's developer tools on the
// editor's page, and paste this. It sends your session with each call.
const store = 'https://store.example.gov';
const api = (method, path, body) =>
  fetch(store + '/v2' + path, {
    method,
    credentials: 'include',
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  }).then(async (r) => ({
    status: r.status,
    body: await r.text().then((t) => (t ? JSON.parse(t) : null)),
  }));

await api('GET', '/me');
```

```bash [With curl]
# In the browser's developer tools, under Application → Cookies for the
# store's address, copy the value of sd_session.
export STORE=https://store.example.gov
export SESSION='sd_session=<value>'

curl -s -H "Cookie: $SESSION" "$STORE/v2/me"
```

:::

Sessions last eight hours. A `401` means sign in again.

The calls an administrator is most likely to script are below. Every route,
with its request and reply, is described in `store/openapi.json` in the
repository, which is checked against the store on every change.

| Call                                                         | Does                                     |
| :----------------------------------------------------------- | :--------------------------------------- |
| `GET /workspaces?archived=true`                              | Every workspace, archived ones included. |
| `POST /workspaces` `{ "name": "…" }`                         | Creates one.                             |
| `PATCH /workspaces/:id` `{ "name": "…" }`                    | Renames it.                              |
| `POST /workspaces/:id/archive`, `…/restore`                  | Archives it, or brings it back.          |
| `GET /workspaces/:id/members`                                | Its members and mapped groups.           |
| `PUT /workspaces/:id/members/:userId` `{ "role": "…" }`      | Adds someone, or changes their role.     |
| `DELETE /workspaces/:id/members/:userId`                     | Removes them.                            |
| `PUT /workspaces/:id/groups` `{ "group": "…", "role": "…" }` | Gives a group a role, or changes it.     |
| `DELETE /workspaces/:id/groups?group=…`                      | Removes the group's role.                |
| `GET /workspaces/:id/documents?deleted=true`                 | Its documents, deleted ones included.    |
| `POST /documents/:docId/restore`                             | Restores a deleted document.             |
| `PUT /documents/:docId/hold` `{ "reason": "…" }`             | Places a legal hold.                     |
| `DELETE /documents/:docId/hold`                              | Releases it.                             |
| `POST /documents/:docId/purge`                               | Removes a deleted document for good.     |
| `PATCH /documents/:docId` `{ "workspaceId": "…" }`           | Moves a document to another workspace.   |

Roles are `viewer`, `editor` and `owner`. A group is named in the body, or
in the query when removing it, where `/platform-eng` is written
`?group=%2Fplatform-eng`.

```js
// Give a group the editor role in a workspace.
const { body } = await api('GET', '/workspaces');
const workspace = body.workspaces.find((w) => w.name === 'Platform Team');
await api('PUT', `/workspaces/${workspace.workspaceId}/groups`, {
  group: '/platform-eng',
  role: 'editor',
});
```

### Responses

| Status                | Meaning                                                                                        |
| :-------------------- | :--------------------------------------------------------------------------------------------- |
| `200`, `201`          | Done.                                                                                          |
| `401 unauthenticated` | Your session has expired. Sign in again.                                                       |
| `403 forbidden`       | You are signed in, but your role does not allow it - or the action is for administrators only. |
| `404 not-found`       | No such workspace, document or person - or one you have no role in. The two look the same.     |
| `409 conflict`        | Refused for a reason in the message - most often, removing a document that is under hold.      |
| `410 deleted`         | The document is deleted. Restore it first.                                                     |
