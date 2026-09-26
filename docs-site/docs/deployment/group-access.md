# Automatic Access from Groups

Without this, every new person waits for someone to press **Give access**.
With it, a workspace can say "anyone in this group may join", and members'
browsers let those people in on their own - usually within seconds of them
signing in.

::: warning Status
This page documents a feature in development. Setting names and screens may
change before release.
:::

::: tip The short version
Your identity provider puts the person's groups in their sign-in token. The
workspace keeps a rule naming which groups may join. A member's browser -
never the server - checks the token against the rule and hands over the
workspace key.
:::

## Why a browser grants, not the server

The store holds only wrapped keys: it cannot give anyone the workspace key,
because it never has it. Access is always handed from a browser that holds
the key to the newcomer. Automatic access keeps that; it only removes the
button press.

What changes is what the granting browser trusts. It does **not** take the
store's word that someone is in a group. It checks the identity provider's
signed token itself, and it checks that the token vouches for the exact key
it is about to hand the workspace key to. A store that has been tampered with
can delay a join or hide one, but it cannot get anyone in.

See [How a grant is checked](#how-a-grant-is-checked) for the detail.

## What you need

- The workspace store, set up as in [Deployment with Workspaces](/deployment/with-workspaces).
- Sign-in through **OIDC**. GitHub sign-in has no signed token to check, so
  people signing in with GitHub always wait for a manual grant.
- An identity provider that puts group membership in the **ID token**. The
  steps below are for Keycloak.
- The provider's discovery document and signing keys readable **from the
  editor's origin** (CORS). The granting browser fetches them directly -
  deliberately not through the store. See [Step 4](#_4-check-the-browser-can-reach-the-signing-keys).
- At least one member with the editor open. A grant happens in a member's
  browser, so if nobody is online the newcomer waits until someone is. See
  [When nobody is online](#when-nobody-is-online).

## Keycloak

These steps use Keycloak 26 and the realm from the example deployment
(`system-design`, client `system-design-store`). Substitute your own realm
and client names.

### 1. Create the groups

In the admin console, open your realm, then **Groups → Create group**.

| Group | Path in the token |
| :--- | :--- |
| `design-team-a` at the top level | `/design-team-a` |
| `design-team-a` inside `engineering` | `/engineering/design-team-a` |

The workspace rule matches the **full path**, so a subgroup's name alone is
not enough. Full paths are what you want: two teams can each have a subgroup
called `design`, and only the path tells them apart.

### 2. Put people in them

**Users →** a user **→ Groups → Join group**, and pick the group. A user in a
subgroup is not automatically in its parent, and the other way round.

### 3. Add groups to the ID token

**Clients → system-design-store → Client scopes →
system-design-store-dedicated → Configure a new mapper → Group Membership**.

| Field | Value |
| :--- | :--- |
| Name | `groups` |
| Token Claim Name | `groups` |
| Full group path | **On** |
| Add to ID token | **On** |
| Add to access token | Off |
| Add to userinfo | On |
| Add to token introspection | On |

**Add to ID token** is the one that matters. The store never reads the access
token, and the granting browser checks only the ID token. Groups in any other
token are ignored.

Putting the mapper on the dedicated scope means it applies to every sign-in
with no change to the store's `OIDC_SCOPES`. If you would rather share one
`groups` client scope across several clients, create it under **Client
scopes**, add the same mapper there, and assign it to the client as
**Default** - an **Optional** scope needs `OIDC_SCOPES=openid profile groups`
on the store, and is easy to forget.

**Check it:** **Clients → system-design-store → Client scopes → Evaluate**.
Pick a user who is in the group, then **Generated ID token**. You should see:

```json
"groups": ["/design-team-a"]
```

If `groups` is missing, the mapper is not adding to the ID token. If it holds
names without a leading `/`, **Full group path** is off.

### 4. Check the browser can reach the signing keys

The granting browser fetches the provider's discovery document and signing
keys from the editor's page. Check both answer with a CORS header for the
editor's origin:

```bash
EDITOR=https://design.example.gov
ISSUER=https://keycloak.example.gov/realms/system-design

curl -s -D - -o /dev/null -H "Origin: $EDITOR" \
  "$ISSUER/.well-known/openid-configuration" | grep -i access-control-allow-origin

curl -s -D - -o /dev/null -H "Origin: $EDITOR" \
  "$ISSUER/protocol/openid-connect/certs" | grep -i access-control-allow-origin
```

Each should print an `access-control-allow-origin` line naming the editor or
`*`. If either prints nothing:

1. Add the editor's origin under **Clients → system-design-store → Settings
   → Web origins**, and run the check again.
2. If it still prints nothing, add the header at the reverse proxy in front
   of Keycloak, for those two paths only. For Caddy:

   ```
   keycloak.example.gov {
       @keys path /realms/*/.well-known/openid-configuration /realms/*/protocol/openid-connect/certs
       header @keys Access-Control-Allow-Origin "https://design.example.gov"
       reverse_proxy keycloak:8080
   }
   ```

Do not work around this by serving the keys through the store. The point of
the check is that it does not depend on the store.

### 5. Tell the store which claim holds groups

The store reads the same claim to know whom to show as waiting for which
workspace. It defaults to `groups`, which matches step 3:

```yaml
OIDC_GROUPS_CLAIM: groups
```

Nothing else changes on the store. Restart it if you set this.

### 6. Turn it on for the workspace

A member of the workspace opens **File → Documents → Workspace settings →
Automatic access** and adds the group paths:

| Setting | Example | Meaning |
| :--- | :--- | :--- |
| Groups | `/design-team-a` | Anyone whose token lists one of these may join. |
| Evidence valid for | `24h` (default) | How old a sign-in may be when it is checked. |

The editor fills in the issuer and client from the running deployment and
shows them for confirmation. They are saved inside the workspace's sealed
document list, next to the titles, so the store cannot read or change them.

### 7. Try it

The example realm (`docker/store/keycloak/system-design-realm.json`) already
has `design-team-a` and `design-team-b`, and three accounts:

| User | Password | Groups |
| :--- | :--- | :--- |
| `demo` | `demo` | `/design-team-a` |
| `otter` | `otter` | `/design-team-a` |
| `Badger` | `badger` | `/design-team-b` |

1. Sign in as `demo` and set up the workspace. Add `/design-team-a` under
   Automatic access.
2. Leave that window open. In a private window, sign in as `otter`. Within
   about fifteen seconds the workspace opens, with no button pressed.
3. In another private window, sign in as `Badger`. They wait, and `demo` sees
   them under *People in this workspace* with **Give access**, as before.

## How a grant is checked

For the reviewer. Nothing in this section needs configuring.

**At sign-in.** Before sending a newcomer to the provider, their browser
creates its key pair and commits to the public key in the sign-in's `nonce`:

```
nonce = base64url( SHA-256( "system-design/join/v1" ‖ 0x00 ‖ SPKI(public key) ‖ salt ) )
```

`salt` is 32 random bytes the browser keeps. The provider copies the nonce
into the ID token it signs, so the token now says: *this person, in these
groups, holds this key*. The store checks the nonce as it always has, and
keeps the raw ID token alongside the person's request to join.

**At grant.** A member's browser that holds the workspace key sees the
request - the ID token, the public key, and the salt - and accepts it only if
all of these hold:

1. The workspace's rule, read from the sealed document list, has automatic
   access on.
2. The token's signature verifies against keys fetched **from the issuer
   named in the rule**, not from the store.
3. `iss` is that issuer and `aud` includes the client named in the rule.
4. `iat` is within *Evidence valid for*, and not in the future. Expiry
   (`exp`) is not used: ID tokens live for minutes, and a join may be checked
   hours later.
5. `sub` is the person the store says is asking.
6. The nonce recomputed from the public key and salt matches the token's.
7. The groups claim lists at least one group the rule names.

Only then is the workspace key wrapped to that public key. The grant is
recorded in the store's audit log as `workspace.auto_grant`, with the
granting device and the token's `jti` or hash.

**What each check stops.** Check 2 stops the store inventing a token. Check 6
stops it pairing a real person's token with a key of its own - the attack
that would otherwise make this unsafe. Checks 1 and 3 stop it swapping in a
rule or an issuer of its choosing. Check 4 limits how long a leaked token is
useful.

**What it trusts.** Your identity provider: whoever can put someone in the
group, or sign tokens as the provider, can let them in. That is usually the
right boundary for a team that already signs in with single sign-on - but it
means Keycloak group administration is now also workspace access.

**What it does not change.** Any member can already let anyone in by hand,
and any member can edit the rule. The rule is protected from the store, not
from members.

## Leaving a group

The store re-reads groups at every sign-in. Sessions last eight hours, so
someone removed from the group loses access to the store **within eight
hours**, when they next have to sign in and no longer match.

They still hold the workspace key they were given. When the store notices
someone who joined through a group no longer matches, it marks the workspace
as needing a new key, and the next member browser to open it
[rotates the key](/guide/workspaces#losing-a-laptop) automatically. Saved
work is not re-encrypted and nothing is lost.

For anyone who must lose access now rather than within eight hours - someone
leaving on bad terms - do both straight away:

1. In Keycloak, **disable the user** (or sign them out: **Users →** the user
   **→ Sessions → Sign out**).
2. In the editor, remove them under *People in this workspace* and press
   **Rotate key**.

People given access by hand are never removed by a group change.

## When nobody is online

A grant needs a browser that holds the key, so a newcomer who signs in at
3 a.m. waits until a member opens the editor. The waiting screen says so:
*Access will be given automatically when a teammate next opens the editor.*

If they wait longer than *Evidence valid for*, their sign-in is too old to
check. The waiting screen asks them to sign in again; nothing else is needed.

## Troubleshooting

| What you see | Likely cause |
| :--- | :--- |
| Newcomer waits, members see them with **Give access** | Their token does not match the rule. Compare the rule with **Evaluate → Generated ID token** for that user - usually a path versus a bare name, or a subgroup. |
| Newcomer waits, members see nothing | The store's `OIDC_GROUPS_CLAIM` does not match the mapper's claim name, so the store does not know which workspace they are for. |
| Members see *Could not check this sign-in* | The browser could not fetch the signing keys. Run the CORS check in [step 4](#_4-check-the-browser-can-reach-the-signing-keys) from a member's network. |
| *Sign-in too old to check* | Longer than *Evidence valid for* has passed. The newcomer signs in again. |
| Worked in the example, not in production | The rule's issuer is the one the **browser** sees (`OIDC_ISSUER`), not `OIDC_INTERNAL_URL`. A token's `iss` never contains the internal name. |
| Nobody in the group is ever let in | Groups are only in the access token. Turn on **Add to ID token**. |

## Things to decide before turning it on

- **Rename with care.** A rule names group paths. Renaming or moving a group
  in Keycloak changes its path, and its members stop matching until the rule
  is updated. Deleting a group and creating another with the same name gives
  the new one the old one's access.
- **Who administers the group.** Anyone who can add members to the group in
  Keycloak can now add people to the workspace. If that is a wider set of
  people than your workspace members, use a group only they manage.
- **Evidence valid for.** Shorter is stricter and makes people sign in again
  more often while they wait. The default of a day suits a team whose members
  open the editor at least daily.
