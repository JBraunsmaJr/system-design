# Deploying the store

The store keeps documents for a team, encrypted so that it cannot read them.
It is optional: an editor with no store configured behaves exactly as it
always has, and nothing leaves the browser.

A complete example — editor, relay, store, PostgreSQL and Keycloak — is in
[`docker/store/compose.example.yaml`](../docker/store/compose.example.yaml).

## What you need

- **PostgreSQL 16 or later.** The store applies its own schema at startup;
  there is no separate migration step.
- **An identity provider**, or a decision to run without sign-in in
  development. Any OIDC provider works — Keycloak, Entra ID, Okta, Auth0,
  GitLab, Google — and GitHub is supported through an adapter.
- **HTTPS**, unless everything is on localhost. See *Origins and HTTPS*.

## Settings

The store reads its configuration from the environment and prints what it is
at startup. Anything unusable stops it, with a sentence saying what to set.

| Variable | Required | Meaning |
|---|---|---|
| `PUBLIC_URL` | yes | Where people reach the store. Sign-in returns here. |
| `DATABASE_URL` | no | PostgreSQL. Without it the store keeps everything in memory and says so — for demonstrations only. |
| `PORT` | no | Default 8080. |
| `ALLOWED_ORIGINS` | where the editor is elsewhere | Exact origins the editor is served from, comma separated. No wildcards. |
| `AUTH_PROVIDERS` | yes | `oidc`, `github`, or both. |
| `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` | with `oidc` | The provider's issuer URL and this store's client. The secret stays on the server. |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | with `github` | A GitHub OAuth app. |
| `ADMIN_SUBJECTS` | no | `issuer#subject` for each administrator. **With none set, legal holds and purges are refused to everyone.** |
| `RETENTION_PERIOD` | no | `immediate`, a duration (`7d`, `12w`, `6m`, `7y`), or `indefinite`. Default `30d`. |
| `CRYPTO_MODE` | no | `webcrypto` (default) or `passthrough`. |
| `RECOVERY_PUBLIC_KEY_FILE` | with `webcrypto` | PEM file holding the organisation's recovery **public** key. Without it the store refuses every document (see below). |
| `RECOVERY_PUBLIC_KEY` | alternative | The same key inline, for secret managers that inject values rather than files. |
| `MAX_BLOB_BYTES`, `MAX_BLOBS_PER_DOCUMENT`, `MAX_TOTAL_BYTES` | no | Quotas. |
| `PURGE_INTERVAL_MINUTES` | no | How often the purge sweep runs. Default 60. |
| `ALLOW_UNAUTHENTICATED` | no | `true` runs with no sign-in at all. Development only. |

The editor needs one setting of its own: `STORE_URL`, the store's public
address. Without it the editor shows no workspace.

## Before the first document: the recovery key

Generate the organisation's recovery pair once, on a machine that is not the
server:

```bash
npx tsx scripts/generate-recovery-key.ts --out ./recovery
```

Give the store the **public** half (`RECOVERY_PUBLIC_KEY_FILE`). Keep the
private half offline, and somewhere other than your database backups.

Every document is wrapped to this key as well as to the workspace key, so
the organisation can recover content when workspace keys are lost, someone
leaves, or a records request has to be answered without the members'
cooperation. **A store with encryption on and no recovery key refuses to
accept documents at all**, rather than quietly accumulating content that
nobody could ever recover.

Replacing the key later does not re-wrap existing documents: keep the old
private half for as long as documents escrowed to it exist.

## Origins and HTTPS

The store and the editor are usually on different hosts. A browser only
sends a session cookie across origins when it is marked `SameSite=None`, and
only accepts that over HTTPS. So:

- **Different origins:** serve both over HTTPS. The store refuses to start
  with a cross-origin editor over plain HTTP, rather than appearing to work
  and then having every request look unauthenticated.
- **Same origin** (the editor and store behind one reverse proxy): nothing
  special is needed; the cookie stays `SameSite=Lax`.
- **Localhost:** plain HTTP works, because browsers treat localhost as
  secure. That is what the example compose file relies on.

List editor origins exactly in `ALLOWED_ORIGINS`. A wildcard is not
permitted alongside credentials, and would let any site spend a signed-in
person's session.

## Retention and legal hold

`RETENTION_PERIOD` decides what deleting a document means:

- `immediate` — deleting purges at once. No restore.
- A duration — the document is hidden, restorable, and purged when the
  period ends. A sweep runs hourly by default.
- `indefinite` — kept until an administrator purges it.

A **legal hold** prevents purge in every mode, including `immediate` and an
explicit purge, until an administrator releases it. Holds and purges need
`ADMIN_SUBJECTS`.

Set the period your records schedule requires before the first document is
stored. Changing it later only affects documents deleted afterwards.

## What the store can and cannot see

In the default `webcrypto` mode the store holds ciphertext and wrapped keys:
no titles, no diagram content, no keys it can use. A database dump yields
nothing readable. It does see document identifiers, sizes, timestamps, who
signed in, and which documents they touched, and it records those in its
audit log.

`passthrough` stores documents unencrypted. It exists for development and
for a deployment that has decided the server should read content; the editor
shows a warning that cannot be dismissed whenever it is in use.

## Keys, devices and recovery

Signing in proves who someone is. It does not, on its own, give access to
any document.

- A person's **first browser** generates their keys and is ready at once.
- **Every later browser** shows a verification code and waits until an
  already-approved browser approves it, with the codes compared by the
  person.
- A **recovery code** unlocks a new browser when no approved one is left.
- An **administrator** can restore access for someone who has lost every
  browser and their recovery code. Their old keys are discarded and the
  workspace key is re-wrapped to a new one.
- **Revoking a browser** takes its key away immediately. If the device was
  lost, rotate the workspace key as well.

The organisation's **recovery key** is generated during first-run setup and
kept offline. It is the last route into a document when workspace keys are
gone, and it is the reason documents can be recovered at all; the store
never holds its private half. Recover a document with
`npx tsx scripts/recover-document.ts --key recovery-private.pem --package doc.json`.

## Running more than one instance

Sessions live in PostgreSQL, so a restart does not sign everyone out and two
instances behind a load balancer share them: no sticky sessions are needed.
A store running without `DATABASE_URL` keeps sessions in memory along with
everything else, which is one more reason that mode is for demonstrations.

The purge sweep runs in every instance. It is safe to run concurrently —
each document is purged once — but there is no need for more than one, so
set `PURGE_INTERVAL_MINUTES` higher where several instances run.

## Backups

Back up PostgreSQL as usual. Its contents are encrypted, so a backup is
useless to anyone without the keys — and equally useless to *you* without
them, which is what the offline recovery key protects against. Store that
key separately from the database backups.
