# Workspace Store

The store is the optional service that gives teams shared documents. It
signs people in through your identity provider, keeps documents in
workspaces, and decides who may open and change each one.

It keeps documents as the editor sends them. The server, its database and
whoever administers either can read them. See
[How your work is protected](/guide/security) for what that means in
practice.

Without a store, the editor works exactly as it does today: documents live
in the browser, sessions start from a link, and nothing leaves the machine.

## What you need

- **PostgreSQL 16 or later.** The store applies its own schema at startup;
  there is no separate migration step.
- **An identity provider.** Any OIDC provider works - Keycloak, Entra ID,
  Okta, Auth0, GitLab, Google - and GitHub is supported through an adapter.
- **HTTPS**, unless everything is on localhost. See _Origins and HTTPS_.
- **A network you control.** The store is meant to run inside your own
  environment, beside the people who use it, not on the public internet.

## The image

The store is published alongside the editor and the relay, on each release:

```
ghcr.io/jbraunsmajr/system-design-store:latest
ghcr.io/jbraunsmajr/system-design-store:<yyyy-mm-dd>
ghcr.io/jbraunsmajr/system-design-store:v<x.y.z>
```

Pin to a release tag such as `v0.98.1` to stay on one version; `latest` moves with each
release.

Each release is tested against PostgreSQL and started once before it is
published. A complete example - editor, relay, store, PostgreSQL and
Keycloak - lives in `docker/store/compose.yaml` in the repository; it builds
the images from source, and swapping each `build:` for the matching
`image:` above runs the published ones instead.

```yaml
store:
  image: ghcr.io/jbraunsmajr/system-design-store:latest
  environment:
    PUBLIC_URL: https://store.example.gov
    DATABASE_URL: postgresql://store:${POSTGRES_PASSWORD}@postgres:5432/store
    # …the settings below
```

## Settings

The store reads its configuration from the environment, prints what it is at
startup, and refuses to start on anything unusable rather than falling back
to a quiet default.

| Variable                                                      | Required                      | Purpose                                                                                                                                                                                                                                                                                |
| :------------------------------------------------------------ | :---------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PUBLIC_URL`                                                  | yes                           | Where people reach the store. Sign-in returns here.                                                                                                                                                                                                                                    |
| `DATABASE_URL`                                                | no                            | PostgreSQL. Without it everything is kept in memory - demonstrations only.                                                                                                                                                                                                             |
| `PORT`                                                        | no                            | Default 8080.                                                                                                                                                                                                                                                                          |
| `ALLOWED_ORIGINS`                                             | where the editor is elsewhere | Exact origins the editor is served from, comma separated. No wildcards. An editor on an origin not listed here cannot use the store.                                                                                                                                                   |
| `AFTER_LOGIN_URL`                                             | no                            | Where people land after signing in when the editor did not say. Defaults to the first allowed origin.                                                                                                                                                                                  |
| `AUTH_PROVIDERS`                                              | yes                           | `oidc`, `github`, or both.                                                                                                                                                                                                                                                             |
| `OIDC_ISSUER`                                                 | with `oidc`                   | The issuer URL **as the browser sees it**.                                                                                                                                                                                                                                             |
| `OIDC_INTERNAL_URL`                                           | in a container network        | The address _the store_ uses, when it differs.                                                                                                                                                                                                                                         |
| `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`                        | with `oidc`                   | This store's client. The secret stays on the server.                                                                                                                                                                                                                                   |
| `OIDC_SCOPES`                                                 | no                            | Comma-separated list of scopes to request from the identity provider (e.g. `openid,profile,groups`).                                                                                                                                                                                   |
| `OIDC_GROUPS_CLAIM`                                           | no                            | The ID-token claim that lists a person's groups, for workspace roles and `ADMIN_GROUPS`. Default `groups`. See [Groups and Roles](/deployment/group-access).                                                                                                                           |
| `OIDC_GROUPS_CLAIM_ABSENT`                                    | no                            | What a token without the groups claim means: `no-groups` (default; Keycloak leaves the claim out for someone in no groups) or `unknown` (the provider left it out for another reason, so the person's groups are not known). Either way they get no role from a group at that sign-in. |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`                    | with `github`                 | A GitHub OAuth app. GitHub sign-in carries no groups.                                                                                                                                                                                                                                  |
| `GITHUB_AUTHORIZE_URL`, `GITHUB_TOKEN_URL`, `GITHUB_USER_URL` | no                            | Custom GitHub OAuth endpoints, for GitHub Enterprise or development.                                                                                                                                                                                                                   |
| `ADMIN_GROUPS`                                                | no                            | Identity-provider groups whose members are store administrators, comma separated, spelled as they appear in the groups claim. Read at each sign-in, so administrators are added and removed at the provider.                                                                           |
| `ADMIN_SUBJECTS`                                              | no                            | `issuer#subject` per administrator, comma separated. Used as well as `ADMIN_GROUPS`. With neither set there are no administrators.                                                                                                                                                     |
| `WORKSPACE_CREATION`                                          | no                            | Who may create workspaces: `admins` (default) or `anyone` (anyone signed in).                                                                                                                                                                                                          |
| `RETENTION_PERIOD`                                            | no                            | `immediate`, a duration (`7d`, `6m`, `7y`), or `indefinite`. Default `30d`.                                                                                                                                                                                                            |
| `RELAY_TOKEN_SECRET`                                          | recommended                   | Shared with the relay, which then admits only people the store has let into a session. At least 32 characters. See _Sessions and the relay_.                                                                                                                                           |
| `MAX_BLOB_BYTES`, `MAX_BLOBS_PER_DOCUMENT`, `MAX_TOTAL_BYTES` | no                            | Quotas on document sizes and total storage. Defaults: 8MB max blob, 100,000 blobs/doc, unlimited total.                                                                                                                                                                                |
| `PURGE_INTERVAL_MINUTES`                                      | no                            | How often deleted documents past their retention are removed. Default `60`.                                                                                                                                                                                                            |
| `ALLOW_UNAUTHENTICATED`                                       | no                            | `true` runs with no sign-in at all: every request is one local administrator. Development only.                                                                                                                                                                                        |

`CRYPTO_MODE`, `RECOVERY_PUBLIC_KEY`, `RECOVERY_PUBLIC_KEY_FILE`, `AUTO_ACCESS`
and `JOIN_EVIDENCE_RETENTION` belonged to an earlier, encrypted workspace and
are no longer read. A store that still sets them starts normally and lists
them at startup as safe to remove.

The editor needs one setting of its own: `STORE_URL`, the store's public
address. An editor served without it can still be pointed at a store by each
person, from **File → Documents → Store**.

## Identity provider setup

Register the store as a **confidential client**:

| Setting      | Value                                                                                                                                         |
| :----------- | :-------------------------------------------------------------------------------------------------------------------------------------------- |
| Redirect URI | **Exactly** `<PUBLIC_URL>/v1/auth/callback`                                                                                                   |
| Client type  | Confidential - the secret stays on the server                                                                                                 |
| Flow         | Authorization Code with PKCE                                                                                                                  |
| Scopes       | `openid profile` - the subject and a display name. Groups come from a claim in the ID token; see [Groups and Roles](/deployment/group-access) |

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
OIDC_ISSUER: http://localhost:8081/realms/system-design # the browser's
OIDC_INTERNAL_URL: http://keycloak:8080 # the store's
```

Only the token exchange, discovery and key fetch use the internal address.
The provider must also know its own public address (`KC_HOSTNAME` for
Keycloak) or it will advertise the internal one and the two stop matching.

## Origins and HTTPS

A browser only sends a session cookie across origins when it is marked
`SameSite=None`, and only accepts that over HTTPS.

- **Different origins** - serve both over HTTPS. The store refuses to start
  with a cross-origin editor over plain HTTP rather than appearing to work
  and then having every request look unauthenticated.
- **Same origin**, behind one reverse proxy - nothing special is needed.
  This is the arrangement to prefer.
- **Localhost** - plain HTTP works, because browsers treat it as secure.

An editor on a different site from the store depends on the browser allowing
a cookie from another site. Browsers that block third-party cookies will
sign someone in and then treat them as signed out. Serving both under one
site avoids it.

After signing in, the store sends people back to the page they started
from, if that page is on the store's own origin or one in `ALLOWED_ORIGINS`.

## Sessions and the relay

Saving goes through the store. A live session is separate: the people who
have a document open see each other's cursors and changes as they happen,
browser to browser, through the relay.

The store gives a document's session - a room on the relay and the key that
encrypts what passes through it - to people who may **edit** the document,
and to nobody else. Viewers are not in the session; changes reach them
through the store a few seconds later.

By default the relay admits anyone who can reach it and knows a room. Set
the same `RELAY_TOKEN_SECRET` on the store and the relay and the relay
admits only people carrying a short-lived token the store issued for that
room.

::: warning Set `RELAY_TOKEN_SECRET`
Without it, someone removed from a workspace who had kept a session's room
and key could rejoin that session and watch edits as they are made. They
could not read or change anything in the store. With the secret set, the
relay refuses them.
:::

A token lasts ten minutes and is used when the connection is made. A browser
that is disconnected for longer is refused when it reconnects, until the
document is reopened.

## Retention and legal hold

`RETENTION_PERIOD` decides what deleting a document means: removed at once,
restorable for a period, or kept until an administrator removes it. A
**legal hold** keeps a deleted document past its retention, and prevents an
administrator removing it, until the hold is released. Holds and removal are
for administrators; see [Administering Workspaces](/deployment/administration).

Set the period your records schedule requires before the first document is
stored; changing it later affects only documents deleted afterwards.

## Running more than one instance

Sessions live in PostgreSQL, so a restart does not sign everyone out and two
instances behind a load balancer share them - no sticky sessions needed.

## Backups

Back up PostgreSQL as usual. The database holds every document in readable
form, along with who is in which workspace. **Encrypt backups and restrict
who can reach them**, as you would for the documents themselves.

Restoring a backup restores everything: workspaces, members, group roles,
documents and their history. There is nothing else to keep.

## Upgrading from the encrypted workspace

Earlier releases encrypted documents in the browser, with keys held by
enrolled devices. That workspace has been removed. Upgrading does not carry
its documents across, and there is no migration tool:

1. **Before upgrading**, have each team open the documents it wants to keep
   in the release they are running and save them to files (**File → Save**).
2. Upgrade the editor, the relay and the store together.
3. Create workspaces, and have each team open its files and add them.

The store leaves the old tables and documents in the database untouched, and
ignores the old settings. `docs/trusted-store.md` in the repository has the
statements to remove them once nothing in them is needed.
