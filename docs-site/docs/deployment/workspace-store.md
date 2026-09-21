# Workspace Store

The store is the optional service that gives a team shared documents. It
keeps them encrypted, so it holds ciphertext and wrapped keys and can read
none of it. See [How your work is protected](/guide/security) for what that
means in practice.

Without a store, the editor works exactly as it does today: documents live
in the browser, sessions start from a link, and nothing leaves the machine.

## What you need

- **PostgreSQL 16 or later.** The store applies its own schema at startup;
  there is no separate migration step.
- **An identity provider.** Any OIDC provider works — Keycloak, Entra ID,
  Okta, Auth0, GitLab, Google — and GitHub is supported through an adapter.
- **HTTPS**, unless everything is on localhost. See *Origins and HTTPS*.
- **A recovery keypair**, generated before the first document is stored.

A complete example — editor, relay, store, PostgreSQL and Keycloak — lives in
`docker/store/compose.example.yaml` in the repository.

## Before the first document

Generate the organization's recovery pair once, on a machine that is not the
server:

```bash
npx tsx scripts/generate-recovery-key.ts --out ./recovery
```

Give the store the **public** half. Keep the private half offline, and
somewhere other than your database backups — it is the last route into a
document when workspace keys are gone, and it is useless to an attacker who
has only the database.

::: warning A store with encryption on and no recovery key refuses documents.
That is deliberate. The alternative is a workspace quietly accumulating
content that nobody, including you, could ever recover.
:::

## Settings

The store reads its configuration from the environment, prints what it is at
startup, and refuses to start on anything unusable rather than falling back
to a quiet default.

| Variable | Required | Purpose |
| :--- | :--- | :--- |
| `PUBLIC_URL` | yes | Where people reach the store. Sign-in returns here. |
| `DATABASE_URL` | no | PostgreSQL. Without it everything is kept in memory — demonstrations only. |
| `PORT` | no | Default 8080. |
| `ALLOWED_ORIGINS` | where the editor is elsewhere | Exact origins the editor is served from. No wildcards. |
| `AFTER_LOGIN_URL` | no | Where people land after signing in. Defaults to the first allowed origin. |
| `AUTH_PROVIDERS` | yes | `oidc`, `github`, or both. |
| `OIDC_ISSUER` | with `oidc` | The issuer URL **as the browser sees it**. |
| `OIDC_INTERNAL_URL` | in a container network | The address *the store* uses, when it differs. |
| `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` | with `oidc` | This store's client. The secret stays on the server. |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | with `github` | A GitHub OAuth app. |
| `RECOVERY_PUBLIC_KEY_FILE` | with encryption on | PEM file holding the recovery **public** key. |
| `ADMIN_SUBJECTS` | no | `issuer#subject` per administrator. With none set, holds and purges are refused to everyone. |
| `RETENTION_PERIOD` | no | `immediate`, a duration (`7d`, `6m`, `7y`), or `indefinite`. Default `30d`. |
| `RELAY_TOKEN_SECRET` | no | Shared with the relay to require membership for sessions. |
| `CRYPTO_MODE` | no | `webcrypto` (default) or `passthrough`. |
| `ALLOW_UNAUTHENTICATED` | no | `true` runs with no sign-in at all. Development only. |

The editor needs one setting of its own: `STORE_URL`, the store's public
address. Without it, the editor shows no workspace.

## Identity provider setup

Register the store as a **confidential client**:

| Setting | Value |
| :--- | :--- |
| Redirect URI | **Exactly** `<PUBLIC_URL>/v1/auth/callback` |
| Client type | Confidential — the secret stays on the server |
| Flow | Authorization Code with PKCE |
| Scopes | `openid profile` — only the subject and a display name are read |

Two things catch people out:

- **The redirect URI must match `PUBLIC_URL` exactly**, including the port. A
  mismatch is refused by the provider before the store is involved.
- **A user with no email address may not be able to sign in.** Keycloak 26
  interrupts the sign-in to ask them to complete their profile. Give test and
  service accounts an email, marked verified.

### Two addresses for one provider

Inside a container, `localhost` is that container. A store told only about
`http://localhost:8081` will send the browser to the right place and then
fail to reach the provider itself:

```yaml
OIDC_ISSUER: http://localhost:8081/realms/system-design   # the browser's
OIDC_INTERNAL_URL: http://keycloak:8080                   # the store's
```

Only the token exchange, discovery and key fetch use the internal address.
The provider must also know its own public address (`KC_HOSTNAME` for
Keycloak) or it will advertise the internal one and the two stop matching.

## Origins and HTTPS

A browser only sends a session cookie across origins when it is marked
`SameSite=None`, and only accepts that over HTTPS.

- **Different origins** — serve both over HTTPS. The store refuses to start
  with a cross-origin editor over plain HTTP rather than appearing to work
  and then having every request look unauthenticated.
- **Same origin**, behind one reverse proxy — nothing special is needed.
- **Localhost** — plain HTTP works, because browsers treat it as secure.

## Sessions and the relay

By default the relay admits anyone who can reach it: knowing a room name is
the whole of the access control. To require membership, set the same
`RELAY_TOKEN_SECRET` on the store and the relay, and run the relay from
`scripts/relay-server.ts`. The store then issues short-lived tokens for one
room to people it has signed in.

The relay never holds a document key either way.

## Retention and legal hold

`RETENTION_PERIOD` decides what deleting a document means: purged at once,
restorable for a period, or kept until an administrator purges it. A **legal
hold** prevents purge in every mode, including an explicit purge, until an
administrator releases it. Holds and purges need `ADMIN_SUBJECTS`.

Set the period your records schedule requires before the first document is
stored; changing it later affects only documents deleted afterwards.

## Running more than one instance

Sessions live in PostgreSQL, so a restart does not sign everyone out and two
instances behind a load balancer share them — no sticky sessions needed.

## Backups

Back up PostgreSQL as usual. Its contents are encrypted, so a backup is
useless to an attacker — and equally useless to you without the offline
recovery key. **Store that key separately from the backups it would be used
to recover.**
