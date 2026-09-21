# Deploying the store

> The same material, written for operators and kept alongside the rest of
> the product documentation, is on the docs site under **Deployment →
> Workspace Store**, with **Guide → How your work is protected** covering
> the encryption. This file is the repository copy; keep the two in step
> when changing either.

The store keeps documents for a team, encrypted so that it cannot read them.
It is optional: an editor with no store configured behaves exactly as it
always has, and nothing leaves the browser.

A complete example — editor, relay, store, PostgreSQL and Keycloak — is in
[`docker/store/compose.example.yaml`](../docker/store/compose.example.yaml).

## Trying it

```bash
cd docker/store
npx tsx ../../scripts/generate-recovery-key.ts --out ./recovery
docker compose -f compose.example.yaml up --build
```

Then open <http://localhost:8088> and sign in as `demo` / `demo`.

That is all it takes, but read what it gives you before going further: a
placeholder client secret, a demo account, a throwaway database password,
and plain HTTP. Each is called out below.

## What you need

- **PostgreSQL 16 or later.** The store applies its own schema at startup;
  there is no separate migration step.
- **An identity provider**, or a decision to run without sign-in in
  development. Any OIDC provider works — Keycloak, Entra ID, Okta, Auth0,
  GitLab, Google — and GitHub is supported through an adapter.
- **HTTPS**, unless everything is on localhost. See _Origins and HTTPS_.

## Setting up the identity provider

The store is registered with your provider as a **confidential client**:
it holds a secret, and the browser never sees a token.

Whatever the provider, register:

| Setting      | Value                                                                      |
| ------------ | -------------------------------------------------------------------------- |
| Client id    | Anything; `system-design-store` in the examples. Goes in `OIDC_CLIENT_ID`. |
| Client type  | Confidential (a client secret). Goes in `OIDC_CLIENT_SECRET`.              |
| Redirect URI | **Exactly** `<PUBLIC_URL>/v1/auth/callback`.                               |
| Web origins  | The editor's origin, where the provider asks for one.                      |
| Flow         | Authorization Code with PKCE. Implicit and direct grants are not used.     |
| Scopes       | `openid profile`. The store reads only the subject and a display name.     |

Two things trip people up:

- **The redirect URI must match `PUBLIC_URL` exactly**, including the port.
  A mismatch shows as the provider refusing the sign-in before the store is
  involved at all.
- **A user with no email address may not be able to sign in.** Keycloak 26
  interrupts the sign-in and asks them to complete their profile. That is
  normal for a real person signing in themselves, and a nuisance for a
  service account or a test user created through the admin API, which
  should be given an email and marked verified.

### When the browser and the store reach the provider differently

Inside a container, `localhost` is that container, not the host. A store
configured only with `OIDC_ISSUER=http://localhost:8081/...` will send the
browser to the right place and then fail to reach the provider itself, with
a connection refused. It answers `502 provider-unreachable` and names the
address it tried.

Give it both addresses:

```yaml
OIDC_ISSUER: http://localhost:8081/realms/system-design # the browser's
OIDC_INTERNAL_URL: http://keycloak:8080 # this server's
```

Only back-channel calls use the internal address: discovery, the token
exchange, the key set. The browser is always sent to the public address,
and tokens are still checked against the public issuer.

The provider must also know its public address, or it will advertise
endpoints and issue tokens under the internal one and the two will not
match. For Keycloak that is `KC_HOSTNAME`; the example sets it.

`OIDC_ISSUER` is the realm or tenant URL, the one that serves
`/.well-known/openid-configuration` — for Keycloak,
`https://keycloak.example.gov/realms/<realm>`. Everything else is read from
that document, so no other endpoint needs configuring.

### Keycloak, specifically

The example imports
[`docker/store/keycloak/system-design-realm.json`](../docker/store/keycloak/system-design-realm.json),
which registers the client and a demo account. For a real deployment,
either import that file into your own Keycloak and change the secret and
redirect URI, or create the client by hand with the settings above.

Before using it for anything real:

1. Replace the client secret in both the realm file and `OIDC_CLIENT_SECRET`.
2. Delete the `demo` user; people come from your own directory.
3. Point the redirect URI at your real `PUBLIC_URL`, over HTTPS.

### GitHub

Register an OAuth app with the same callback URL, set `AUTH_PROVIDERS` to
`github`, and supply `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`. GitHub
is OAuth2 without OIDC, so there is no issuer to configure.

## Settings

The store reads its configuration from the environment and prints what it is
at startup. Anything unusable stops it, with a sentence saying what to set.

| Variable                                                      | Required                                      | Meaning                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PUBLIC_URL`                                                  | yes                                           | Where people reach the store. Sign-in returns here.                                                                                                                                                                                                           |
| `DATABASE_URL`                                                | no                                            | PostgreSQL. Without it the store keeps everything in memory and says so — for demonstrations only.                                                                                                                                                            |
| `PORT`                                                        | no                                            | Default 8080.                                                                                                                                                                                                                                                 |
| `ALLOWED_ORIGINS`                                             | where the editor is elsewhere                 | Exact origins the editor is served from, comma separated. No wildcards.                                                                                                                                                                                       |
| `AFTER_LOGIN_URL`                                             | no                                            | Where people are sent once signed in. Defaults to the first allowed origin — the editor. Must be this store or an allowed origin, or it would be an open redirect.                                                                                            |
| `AUTH_PROVIDERS`                                              | yes                                           | `oidc`, `github`, or both.                                                                                                                                                                                                                                    |
| `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`         | with `oidc`                                   | The provider's issuer URL **as the browser sees it**, and this store's client. The secret stays on the server.                                                                                                                                                |
| `OIDC_INTERNAL_URL`                                           | when the store reaches the provider elsewhere | The address _this server_ uses, when it differs — a container network, typically. See below.                                                                                                                                                                  |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`                    | with `github`                                 | A GitHub OAuth app.                                                                                                                                                                                                                                           |
| `ADMIN_SUBJECTS`                                              | no                                            | `issuer#subject` for each administrator. **With none set, legal holds and purges are refused to everyone.** The subject is the provider's identifier, not a username: with Keycloak it is the user's UUID, which `GET /v1/users/me` reports after signing in. |
| `RETENTION_PERIOD`                                            | no                                            | `immediate`, a duration (`7d`, `12w`, `6m`, `7y`), or `indefinite`. Default `30d`.                                                                                                                                                                            |
| `CRYPTO_MODE`                                                 | no                                            | `webcrypto` (default) or `passthrough`.                                                                                                                                                                                                                       |
| `RECOVERY_PUBLIC_KEY_FILE`                                    | with `webcrypto`                              | PEM file holding the organisation's recovery **public** key. Without it the store refuses every document (see below).                                                                                                                                         |
| `RECOVERY_PUBLIC_KEY`                                         | alternative                                   | The same key inline, for secret managers that inject values rather than files.                                                                                                                                                                                |
| `MAX_BLOB_BYTES`, `MAX_BLOBS_PER_DOCUMENT`, `MAX_TOTAL_BYTES` | no                                            | Quotas.                                                                                                                                                                                                                                                       |
| `PURGE_INTERVAL_MINUTES`                                      | no                                            | How often the purge sweep runs. Default 60.                                                                                                                                                                                                                   |
| `ALLOW_UNAUTHENTICATED`                                       | no                                            | `true` runs with no sign-in at all. Development only.                                                                                                                                                                                                         |

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

## The relay, and who may join a session

By default the relay admits anyone who can reach it: knowing a room name is
the whole of the access control. That is defensible where the relay is only
reachable inside a network, and not where it is public.

To require membership, set the same secret on both:

```yaml
store:
  environment:
    RELAY_TOKEN_SECRET: <at least 32 random characters>
relay:
  environment:
    RELAY_TOKEN_SECRET: <the same value>
```

The store then issues a short-lived token for one room to someone it has
already signed in, and the relay accepts nothing else. Run the relay from
`scripts/relay-server.ts` (the image's default) rather than y-webrtc's own
server, which has no such check.

The relay learns nothing either way. Session content is encrypted with the
key from the share link, which neither service ever sees, so a token
governs who may join a session — not who may read one.

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
useless to anyone without the keys — and equally useless to _you_ without
them, which is what the offline recovery key protects against. Store that
key separately from the database backups.
