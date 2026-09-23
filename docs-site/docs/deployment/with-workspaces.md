# Deployment with Workspaces

Everything in the [core deployment](/deployment/core), plus **workspaces**:
shared storage for your team's documents, sign-in through your organization's
identity provider, and live sessions that only people who have signed in can
join.

Documents are encrypted in the browser before they reach your server, so the
store holds nothing it can read. [How your work is protected](/guide/security)
explains what that means for your users.

**You'll end up with**

```
https://design.example.gov/          the editor
https://design.example.gov/docs/     this documentation
wss://design.example.gov/relay/      the relay, for live sessions
https://design.example.gov/store/    the workspace store
https://design.example.gov/auth/     Keycloak - only if you run it here
```

Plan for about thirty minutes.

## 1. Before you start

Everything the [core deployment](/deployment/core#_1-before-you-start) needs -
Docker with Compose v2, a DNS name, a TLS certificate, ports 80 and 443 - plus **somewhere for people to sign in**.
Either:

- **Your organization's identity provider** - Keycloak, Entra ID, Okta,
  Auth0, GitLab or Google; anything that speaks OpenID Connect. Recommended
  for production: people sign in with the accounts they already have.
- **Keycloak, run here** alongside everything else. Good when you have no
  provider, or for evaluating. You then manage its users yourself.

Decide now; step 5 differs between them.

## 2. Create a folder with the files

```bash
mkdir system-design && cd system-design
mkdir certs keys
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

## 4. Create the recovery key

The organization's recovery key is the last way back into a document if every
person's own keys are lost. The store refuses documents until it has one.

```bash
sudo docker run --rm \
  -v ./keys:/keys \
  ghcr.io/jbraunsmajr/system-design-store:latest \
  generate-recovery-key --out /keys/recovery
```

*(On Windows PowerShell, use `-v ${PWD}/keys:/keys` and leave out `-u`.)*

This creates two files in `keys/`:

| File                   | What to do with it                                                                                                                                  |
|:-----------------------|:----------------------------------------------------------------------------------------------------------------------------------------------------|
| `recovery-public.pem`  | Leave it where it is. The store reads it.                                                                                                           |
| `recovery-private.pem` | **Move it off this server now**, to somewhere offline - a password manager, an encrypted drive in a safe. Keep it apart from your database backups. |

::: danger Nobody can recreate the private half
Without it, nothing escrowed to this key can ever be recovered - not by you,
not by us. Losing it does not affect day-to-day use, but it removes the last
route back for anyone who loses everything.
:::

## 5. Connect sign-in

### Option A - your organization's provider

Register the workspace with your provider as a **confidential client**:

| Setting       | Value                                                                                                              |
|:--------------|:-------------------------------------------------------------------------------------------------------------------|
| Client ID     | `system-design-store` (or anything; match `OIDC_CLIENT_ID`. This example value comes from the keycloak-realm.json) |
| Client type   | Confidential, with a client secret                                                                                 |
| Client secret | The `OIDC_CLIENT_SECRET` from your `.env`                                                                          |
| Redirect URI  | `https://design.example.gov/store/v1/auth/callback`                                                                |
| Flow          | Authorization Code, with PKCE                                                                                      |
| Scopes        | `openid profile`                                                                                                   |

Then set `OIDC_ISSUER` in `.env` to your provider's issuer - the URL that
serves `/.well-known/openid-configuration`. For Keycloak that is
`https://<keycloak>/realms/<realm>`. Leave `OIDC_INTERNAL_URL` empty.

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
and client secret when Keycloak imports it.

You'll add people to Keycloak in step 8.

## 6. Add your certificate

As in the core deployment: `certs/fullchain.pem` and `certs/privkey.pem`.

## 7. Start it

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

## 8. Check it works

```bash
curl https://design.example.gov/store/v1/health
```

You should see:

```json
{
  "status": "ok",
  "cryptoMode": "webcrypto",
  "authentication": "required",
  "escrow": "configured",
  "relayAuthentication": "required"
}
```

| If you see                     | It means                                                                                                  |
|:-------------------------------|:----------------------------------------------------------------------------------------------------------|
| `"escrow":"missing"`           | `keys/recovery-public.pem` isn't there. Redo step 4.                                                      |
| `"relayAuthentication":"none"` | `RELAY_TOKEN_SECRET` is empty in `.env`.                                                                  |
| No response                    | `docker compose logs store` - the store says what is wrong and stops, rather than starting misconfigured. |

**Option B only - add people.** Open `https://design.example.gov/auth/admin` (Depends on your proxy configuration.
Assuming everything is hosted at `design.example.com` and your proxy is set to forward `/auth` traffic to your keycloak
instance), sign in as `admin` with `KEYCLOAK_ADMIN_PASSWORD`, switch to the **system-design** realm, and add a user under
**Users**. Give each person an
email address, marked verified: Keycloak will otherwise interrupt their first
sign-in to ask for one.

## 9. Sign in, and make yourself an administrator

1. Open `https://design.example.gov`, then **File → Documents**, and sign in.
2. Choose **Set up this browser**. As the first person in, you create the
   workspace's keys.
3. Choose **Create a recovery code** and keep it somewhere safe - it is yours,
   and different from the organization's recovery key in step 4.

To become an administrator - needed only for legal holds and purges - open
`https://design.example.gov/store/v1/auth/session` and copy `issuer` and
`subject`. Put them in `.env`, joined with `#`:

```ini
ADMIN_SUBJECTS=https://login.example.gov/realms/yourrealm#9b1f3c52-6a1e-4c3a-9d2e-1f0a7b5c4e21
```

and restart the store: `docker compose up -d store`. (With Keycloak, add
`-f compose.yml -f compose.keycloak.yml` as in step 7.)

## 10. Invite your team

Send people the address. When someone new signs in, everyone already in the
workspace sees a notice over their document with **Give access** on it; one
press lets them in. [Workspaces](/guide/workspaces) is the guide to give them.

## Keeping it running

| Task                         | Command                                       |
|:-----------------------------|:----------------------------------------------|
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

The store's database holds only ciphertext, so a backup is useless to anyone
who steals it - and useless to you without the recovery key from step 4. **Keep that key somewhere other than the
backups.**

### Next

- [Administering a Workspace](/deployment/administration) - legal holds,
  purges, restoring someone's access.
- [Workspace Store](/deployment/workspace-store) - every setting, including
  retention and running more than one instance.
