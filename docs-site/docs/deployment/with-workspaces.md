# Deployment with Workspaces

Everything in the [core deployment](/deployment/core), plus **workspaces**:
shared storage for your team's documents, sign-in through your organization's
identity provider, and live sessions that only people who have signed in can
join.

Documents are kept on your server as the editor sends them. The server, and
whoever administers it, can read them, so this deployment belongs inside your
own network and its database and backups need the protection the documents
do. [How your work is protected](/guide/security) explains this for your
users.

**You'll end up with**

```
https://design.example.gov/          the editor
https://design.example.gov/docs/     this documentation
wss://design.example.gov/relay/      the relay, for live sessions
https://design.example.gov/store/    the workspace store
https://design.example.gov/auth/     Keycloak - only if you run it here
```

Plan for about twenty minutes.

## 1. Before you start

Everything the [core deployment](/deployment/core#_1-before-you-start) needs -
Docker with Compose v2, a DNS name, a TLS certificate, ports 80 and 443 - plus **somewhere for people to sign in**.
Either:

- **Your organization's identity provider** - Keycloak, Entra ID, Okta,
  Auth0, GitLab or Google; anything that speaks OpenID Connect. Recommended
  for production: people sign in with the accounts they already have.
- **Keycloak, run here** alongside everything else. Good when you have no
  provider, or for evaluating. You then manage its users yourself.

Decide now; step 4 differs between them.

You also need to know **who will administer it**. Administrators create
workspaces and decide what is kept. The simplest way to name them is a group
in your provider; step 4 sets that up.

## 2. Create a folder with the files

```bash
mkdir system-design && cd system-design
mkdir certs
```

::: code-group

```yaml [compose.yml]
<!--@include: @/files/workspace/compose.yml -->
```

```nginx [nginx.conf]
<!--@include: @/files/workspace/nginx.conf -->
```

```ini [.env]
<!--@include: @/files/workspace/workspace.env -->
```

:::

If you will run Keycloak here, also create these two:

::: code-group

```yaml [compose.keycloak.yml]
<!--@include: @/files/workspace/compose.keycloak.yml -->
```

```json [keycloak-realm.json]
<!--@include: @/files/workspace/keycloak-realm.json -->
```

:::

## 3. Set your domain and generate the secrets

In `.env`, set `DOMAIN` to your name. Then fill in the three secrets with
long random values. This prints them ready to paste:

```bash
for name in POSTGRES_PASSWORD RELAY_TOKEN_SECRET OIDC_CLIENT_SECRET; do
  echo "$name=$(openssl rand -hex 32)"
done
```

::: warning Keep `.env` private
It holds the database password and the secret that controls who can join a
session. `chmod 600 .env`, and keep it out of version control.
:::

## 4. Connect sign-in and name the administrators

### Option A - your organization's provider

Register the workspace with your provider as a **confidential client**:

| Setting       | Value                                                                                                              |
| :------------ | :----------------------------------------------------------------------------------------------------------------- |
| Client ID     | `system-design-store` (or anything; match `OIDC_CLIENT_ID`. This example value comes from the keycloak-realm.json) |
| Client type   | Confidential, with a client secret                                                                                 |
| Client secret | The `OIDC_CLIENT_SECRET` from your `.env`                                                                          |
| Redirect URI  | `https://design.example.gov/store/v1/auth/callback`                                                                |
| Flow          | Authorization Code, with PKCE                                                                                      |
| Scopes        | `openid profile`                                                                                                   |

Then set `OIDC_ISSUER` in `.env` to your provider's issuer - the URL that
serves `/.well-known/openid-configuration`. For Keycloak that is
`https://<keycloak>/realms/<realm>`. Leave `OIDC_INTERNAL_URL` empty.

**Put groups in the ID token.** Workspaces give roles to groups, and
administrators are usually named by group, so the store needs each person's
groups at sign-in. Add a mapper or claim that lists them in the **ID token**
under the name `groups` (or set `OIDC_GROUPS_CLAIM` to the name your provider
uses). [Groups and Roles](/deployment/group-access) has the steps for
Keycloak and what to check for other providers.

**Name the administrators.** In `.env`, set `ADMIN_GROUPS` to a group whose
members should administer the store, spelled exactly as it appears in the
token, and make sure you are in it.

::: tip Check the issuer before going further

```bash
curl https://login.example.gov/realms/yourrealm/.well-known/openid-configuration
```

If that doesn't return JSON from this server, the store won't reach it either.
:::

### Option B - Keycloak, run here

In `.env`, replace the three Option A lines with the Option B ones, and set
`KEYCLOAK_ADMIN_PASSWORD` and `KEYCLOAK_DB_PASSWORD` (the loop from step 3
works for these too). Nothing else to edit: the realm file reads your domain
and client secret when Keycloak imports it, puts each person's groups in
their token, and creates the group `notebook-admins`, which `.env` already
names in `ADMIN_GROUPS` as `/notebook-admins`. Keycloak reports groups by
their full path, so group names here start with a slash.

You'll add people to Keycloak, and yourself to that group, in step 7.

## 5. Add your certificate

As in the core deployment: `certs/fullchain.pem` and `certs/privkey.pem`.

## 6. Start it

::: warning If people cannot see each other in a session

In an air-gapped network it has been observed that sessions sometimes fail to
connect with `RELAY_TOKEN_SECRET` set. If two people have the same document
open and do not appear to each other, comment `RELAY_TOKEN_SECRET` out of both
the `store` and `relay` services to confirm that is the cause. Documents still
save and merge through the store without a session.

Leaving it out has a cost: the relay then admits anyone on your network who
knows a session's room and key, including someone since removed from a
workspace. See [Workspace Store](/deployment/workspace-store#sessions-and-the-relay).

:::

::: code-group

```bash [Option A]
docker compose up -d
```

```bash [Option B]
docker compose -f compose.yml -f compose.keycloak.yml up -d
```

:::

With Keycloak, give it a minute on first start: it builds itself and imports
the realm.

## 7. Check it works

```bash
curl https://design.example.gov/store/v1/health
```

You should see:

```json
{
  "status": "ok",
  "authentication": "required",
  "relayAuthentication": "required"
}
```

| If you see                     | It means                                                                                                  |
| :----------------------------- | :-------------------------------------------------------------------------------------------------------- |
| `"relayAuthentication":"none"` | `RELAY_TOKEN_SECRET` is empty in `.env`.                                                                  |
| No response                    | `docker compose logs store` - the store says what is wrong and stops, rather than starting misconfigured. |

Then check the workspace service itself:

```bash
curl https://design.example.gov/store/v2/health
```

```json
{ "status": "ok", "mode": "trusted" }
```

A `404` here means the store image is older than this guide. Pull the current
one.

**Option B only - add people.** Open `https://design.example.gov/auth/admin`
(this depends on your proxy: the example forwards `/auth` to Keycloak), sign
in as `admin` with `KEYCLOAK_ADMIN_PASSWORD`, and switch to the
**system-design** realm.

1. Under **Users**, add each person. Give them an email address, marked
   verified: Keycloak will otherwise interrupt their first sign-in to ask for
   one.
2. Open your own user, choose **Groups**, and join `notebook-admins`.
3. Under **Groups**, create a group for each team (such as `platform-eng`)
   and add its people. You will give these groups roles in step 8, where
   this one is typed `/platform-eng`.

## 8. Sign in and create a workspace

1. Open `https://design.example.gov`, then **File → Documents**, and choose
   **Sign in**.
2. In the **Workspaces** panel, choose **New workspace** and name it for a
   team. If the button is not there, you are not an administrator yet: see
   the box below.
3. Choose **Members**, then under **Groups** type the team's group exactly
   as your provider reports it (`/platform-eng` with Keycloak), pick a role,
   and choose **Add group**. Everyone in that group has the workspace
   the next time they sign in. Nobody approves them.
4. Open a diagram and choose **Add a copy to …** to put the first document
   in.

::: tip No "New workspace" button?
The store decides who is an administrator when you sign in. Open
`https://design.example.gov/store/v2/me`: `isAdmin` should be `true` and
`groups` should list your groups.

- **`groups` is empty** - your provider is not putting groups in the ID
  token, or uses another claim name. See [Groups and Roles](/deployment/group-access).
- **Your group is there but spelled differently** from `ADMIN_GROUPS` - for
  example `notebook-admins` without the leading slash. Copy it from here
  into `.env` exactly, then `docker compose up -d store`.
- **You changed your groups after signing in** - sign out and in again.
  Groups are read at sign-in.

:::

## 9. Invite your team

Send people the address. Anyone in a group you mapped signs in and finds the
workspace. For someone outside those groups, an owner adds them by name from
**Members**; they appear in the search once they have signed in for the first
time. [Workspaces](/guide/workspaces) is the guide to give them.

## Keeping it running

| Task                         | Command                                       |
| :--------------------------- | :-------------------------------------------- |
| See what is running          | `docker compose ps`                           |
| Read the logs                | `docker compose logs -f store`                |
| Update to the newest release | `docker compose pull && docker compose up -d` |

With Keycloak, add `-f compose.yml -f compose.keycloak.yml` to each.

### Backups

Back up the `store-data` volume - and `keycloak-data` if you run Keycloak -
like any PostgreSQL database:

```bash
docker compose exec postgres pg_dump -U store store > store-$(date +%F).sql
```

The database holds every document in readable form. **Encrypt the backups
and restrict who can reach them**, as you would for the documents
themselves.

### Next

- [Administering Workspaces](/deployment/administration) - archiving,
  retention, legal holds, and the audit trail.
- [Groups and Roles](/deployment/group-access) - getting groups into the
  token, and how roles are decided.
- [Workspace Store](/deployment/workspace-store) - every setting, including
  retention and running more than one instance.
