# Administering a Workspace

Most of what happens in a workspace needs no administrator: people sign in,
approve their own browsers, let each other in, and rotate keys themselves. A
few actions are deliberately reserved — legal holds, purging, and restoring
access for someone who has lost everything — because they override retention
or someone's keys.

These are **API actions** in this release. There is no administration screen
yet; this page shows how to perform each one.

::: info What an administrator cannot do
An administrator cannot read documents, see their titles, or recover anyone's
keys. The workspace store holds only ciphertext and wrapped keys, and being an
administrator does not change that. What they can do is decide what is kept,
and let someone back in so that a member can give them access again.
:::

## Becoming an administrator

Administrators are listed in the store's `ADMIN_SUBJECTS`, as
`issuer#subject`, comma separated:

```yaml
ADMIN_SUBJECTS: https://keycloak.example.gov/realms/design#9b1f3c52-6a1e-4c3a-9d2e-1f0a7b5c4e21
```

The subject is your identity provider's identifier for you — for Keycloak, a
UUID — not your username. To find yours, sign in to the editor, then open:

```
https://store.example.gov/v1/auth/session
```

and copy `issuer` and `subject` from the response, joined with `#`. Restart
the store after changing the setting. With no administrators configured,
every action on this page is refused to everyone, rather than allowed to
anyone.

## Calling the API

Every call needs the session your browser holds after signing in. Two ways to
use it:

::: code-group

```js [From the editor's console]
// Sign in to the editor, open the browser's developer tools on the
// editor's page, and paste this. It sends your session with each call.
const store = 'https://store.example.gov';
const api = (method, path, body) =>
  fetch(store + path, {
    method,
    credentials: 'include',
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  }).then(async (r) => ({
    status: r.status,
    body: await r.text().then((t) => (t ? JSON.parse(t) : null)),
  }));

await api('GET', '/v1/auth/session');
```

```bash [With curl]
# In the browser's developer tools, under Application → Cookies for the
# store's address, copy the value of sd_session.
export STORE=https://store.example.gov
export SESSION='sd_session=<value>'

curl -s -H "Cookie: $SESSION" "$STORE/v1/auth/session"
```

:::

The examples below use the console form. Each has an exact curl equivalent:
the same method and path, with `-H "Cookie: $SESSION"` and, where there is a
body, `-H 'content-type: application/json' -d '…'`.

Sessions last eight hours. A `401` means sign in again.

## Finding a document

The store identifies documents by id and never knows their titles — that is
the point of encrypting them. To act on a particular document you need its
id, which is in the editor's address bar while it is open:

```
https://design.example.gov/?doc=3f6e2b1c-…
                              ^ this
```

Ask someone who can open it, or find it in the audit trail by who touched it
and when (see _Reading the audit trail_).

## Deleted documents

Deleting a document hides it and, depending on `RETENTION_PERIOD`, keeps it
restorable for a time. Any signed-in member can see and restore deleted
documents; this is not an administrator action.

```js
// Everything, including documents that are deleted but still retained.
await api('GET', '/v1/docs?includeDeleted=true');

// Bring one back.
await api('POST', '/v1/docs/3f6e2b1c-…/restore');
```

A deleted document shows a `deletedAt` time, and `purgeAfter` when retention
will remove it.

## Legal hold

A hold stops a document being purged — by retention, by the sweep, or by an
explicit purge — until it is released. It applies whether or not the
document is deleted, and in every retention mode, including `immediate`.

```js
// Place a hold. The reason is recorded with it and in the audit trail.
await api('PUT', '/v1/docs/3f6e2b1c-…/hold', { reason: 'FOIA request 2026-114' });

// Release it. If the document is deleted, its purge date is restored.
await api('DELETE', '/v1/docs/3f6e2b1c-…/hold');
```

Place holds before anything else when a records request arrives. A hold is
cheap and reversible; a purge is neither.

## Purging

Purging removes a document and its history permanently. It cannot be undone,
and nobody — including the organization's offline recovery key — can bring a
purged document back.

```js
// One document, now. Refused while it is under a hold.
await api('POST', '/v1/docs/3f6e2b1c-…/purge');

// Everything whose retention has ended. The store runs this on its own every
// PURGE_INTERVAL_MINUTES; this is for running it now.
await api('POST', '/v1/admin/purge-due');
// → { purged: ['…', '…'] }
```

## Restoring someone's access

For someone who has lost every browser **and** their recovery code. If they
still have either, they do not need an administrator: another browser can
approve a new one, or the recovery code can.

It takes two people, and that is deliberate — no single step lets anyone read
the workspace.

**1. The administrator resets their keys.**

```js
// Find them.
await api('GET', '/v1/admin/users');
// → { users: [ { userId, displayName, publicKey, workspaceKeyGenerations }, … ] }

// Reset.
await api('POST', '/v1/admin/users/<userId>/regrant');
```

This revokes every browser they had, discards their recovery code and their
copy of the workspace key, and forgets their old public key. Anything wrapped
to their lost keys goes with them.

**2. A member lets them back in.** They sign in on a new browser, which
publishes a fresh key and tells them they are waiting for access. Anyone
already in the workspace sees a notice over their document and presses
**Give access** — exactly as for a new colleague.

Consider [rotating the workspace key](/guide/workspaces#losing-a-laptop)
afterwards if the lost browsers might be in someone else's hands.

## Reading the audit trail

The store records every request — who, what, which document, and whether it
was allowed — in PostgreSQL's `audit_log` table. There is no API for it in
this release; read it with SQL:

```sql
-- Everything that happened to one document, newest first.
SELECT at, subject, operation, outcome, detail
FROM audit_log
WHERE doc_id = '3f6e2b1c-…'
ORDER BY at DESC;

-- Everything one person did in the last week.
SELECT at, operation, doc_id, outcome
FROM audit_log
WHERE subject = 'https://keycloak.example.gov/realms/design#9b1f3c52-…'
  AND at > now() - interval '7 days'
ORDER BY at DESC;

-- Refusals, which are where problems and probing both show up.
SELECT at, subject, operation, detail
FROM audit_log
WHERE outcome = 'denied'
ORDER BY at DESC
LIMIT 100;
```

Worth knowing: the log is append-only **by convention** in this release — the
store never updates or deletes a row — not by database permissions. If your
assessment requires tamper resistance, grant the store's database role
`INSERT` and `SELECT` on `audit_log` only, and ship the table to your log
platform.

## Offline document recovery

When all workspace member devices and recovery codes are lost, or in an
emergency disaster recovery scenario, administrators can decrypt an escrowed
document package directly using the organization's offline recovery private key.

Using the container image:

```bash
docker run --rm \
  -u $(id -u):$(id -g) \
  -v ./keys:/keys \
  -v ./backups:/backups \
  ghcr.io/jbraunsmajr/system-design-store:latest \
  recover-document \
    --key /keys/recovery-private.pem \
    --package /backups/doc-123.json \
    --out /backups/recovered-123.json
```

Or from source:

```bash
npx tsx scripts/recover-document.ts \
  --key recovery-private.pem \
  --package doc-123.json \
  --out doc-123-recovered.json
```

The output JSON file can be opened directly in the editor via **File > Open**.

## Responses

| Status                | Meaning                                                                                 |
| :-------------------- | :-------------------------------------------------------------------------------------- |
| `200`, `204`          | Done.                                                                                   |
| `401 unauthenticated` | Your session has expired. Sign in again.                                                |
| `403 forbidden`       | You are not in `ADMIN_SUBJECTS`, or none are configured.                                |
| `404 not-found`       | No such document or person. Check the id.                                               |
| `409 conflict`        | Refused for a reason in the message — most often, a purge of a document under hold.     |
| `410 deleted`         | The document is deleted. Restore it first, or include deleted documents in the request. |
