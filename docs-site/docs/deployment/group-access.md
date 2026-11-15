# Groups and Roles

A workspace decides who can open and change its documents. It can name people
one by one, but the usual way is to give a role to a **group from your
identity provider**: everyone in the group has the workspace the next time
they sign in, and loses it when they leave the group. Nobody approves anyone.

This page covers how roles work, how to get groups from your provider to the
store, and what to check when someone does not have the access you expect.

## Roles

| Role       | Can                                                                 |
| :--------- | :------------------------------------------------------------------ |
| **Viewer** | Open the workspace's documents.                                     |
| **Editor** | Also create, change, delete and restore documents.                  |
| **Owner**  | Also rename the workspace and manage its members and mapped groups. |

A person's role in a workspace is the **highest** of:

- the role they were given individually,
- the role of any group of theirs that the workspace maps to a role, and
- owner, if they are a store administrator.

A role is a grant, never a restriction. Adding someone as a viewer does not
take away the editor role their group gives them. To give someone less, take
them out of the group.

**Store administrators** are owners of every workspace. They are also the
only people who can archive a workspace, place a legal hold, or remove a
deleted document before its retention ends. They are named in the store's
settings with `ADMIN_GROUPS` and `ADMIN_SUBJECTS`; see
[Administering Workspaces](/deployment/administration).

Someone with no role in a workspace cannot tell that it exists.

## What you need

- **OIDC sign-in.** Groups come from the ID token. GitHub sign-in has no
  groups, so people who sign in with GitHub are added individually.
- **Groups in the ID token.** The store reads one claim, named by
  `OIDC_GROUPS_CLAIM` (default `groups`), holding a list of group names.
- **The names, exactly.** A workspace matches a group by its name as it
  appears in the token, character for character.

## Keycloak

These steps use Keycloak 26 and the realm from the example deployment
(`system-design`, client `system-design-store`). Substitute your own realm
and client names. The example realm already has the mapper from step 3.

### 1. Create the groups

In the admin console, open your realm, then **Groups → Create group**.

| Group                               | Name in the token           |
| :---------------------------------- | :-------------------------- |
| `platform-eng` at the top level     | `/platform-eng`             |
| `platform-eng` inside `engineering` | `/engineering/platform-eng` |

With **Full group path** on, which is what the example uses, a group is known
by its full path, starting with a slash. That is what you want: two teams can
each have a subgroup called `design`, and only the path tells them apart.

### 2. Put people in them

**Users →** a user **→ Groups → Join group**, and pick the group. A user in a
subgroup is not automatically in its parent, and the other way round.

### 3. Add groups to the ID token

**Clients → system-design-store → Client scopes →
system-design-store-dedicated → Configure a new mapper → Group Membership**.

| Field                      | Value    |
| :------------------------- | :------- |
| Name                       | `groups` |
| Token Claim Name           | `groups` |
| Full group path            | **On**   |
| Add to ID token            | **On**   |
| Add to access token        | Off      |
| Add to userinfo            | On       |
| Add to token introspection | On       |

**Add to ID token** is the one that matters. The store reads only the ID
token. Groups in any other token are ignored.

Putting the mapper on the dedicated scope means it applies to every sign-in
with no change to the store's `OIDC_SCOPES`. If you would rather share one
`groups` client scope across several clients, create it under **Client
scopes**, add the same mapper there, and assign it to the client as
**Default** - an **Optional** scope needs `OIDC_SCOPES=openid,profile,groups`
on the store, and is easy to forget.

**Check it:** **Clients → system-design-store → Client scopes → Evaluate**.
Pick a user who is in the group, then **Generated ID token**. You should see:

```json
"groups": ["/platform-eng"]
```

If `groups` is missing, the mapper is not adding to the ID token. If it holds
names without a leading `/`, **Full group path** is off: that works too, but
then type the names without the slash everywhere.

### 4. Tell the store which claim holds groups

Only if you named the claim something other than `groups`:

```yaml
OIDC_GROUPS_CLAIM: roles
```

Restart the store. At startup it prints the claim it reads:

```
Groups: read from the "groups" claim at sign-in, for workspace roles and ADMIN_GROUPS (a token without it means no groups)
```

### 5. Give a group a role

Sign in to the editor as an owner of the workspace, or as an administrator.

1. **File → Documents**, and pick the workspace.
2. Choose **Members**.
3. Under **Groups**, type the group as it appears in the token
   (`/platform-eng`), pick a role, and choose **Add group**.

The editor suggests the groups you are in yourself. For any other group, type
the name: the store only learns a group's name when a member of it signs in,
so it cannot list them for you.

### 6. Try it

Sign in as someone in the group, in another browser or a private window.
**File → Documents** shows the workspace, and under its name:

> You are an editor here, through the group /platform-eng.

## Other providers

Anything that puts a list of group names in the ID token works.

- **Entra ID** - add a **groups claim** to the app registration's token
  configuration, for the ID token. Entra sends group **object ids** unless
  you choose otherwise, so those ids are what you type into the workspace.
  When someone is in more groups than Entra will put in a token (about 200),
  it leaves the claim out and points elsewhere; the store then has no groups
  for that sign-in and gives no role from a group. Limit the claim to groups
  assigned to the application to stay under it.
- **Okta** - add a **groups claim** to the ID token of the authorization
  server, with a filter that matches the groups you want sent.
- **Anything else** - find the setting that adds group membership to the ID
  token, and set `OIDC_GROUPS_CLAIM` to the claim's name.

## When access changes

**Groups are read when someone signs in**, and kept for that session.

| Change                                 | Takes effect                                                                   |
| :------------------------------------- | :----------------------------------------------------------------------------- |
| A group is given a role in a workspace | For each member of the group, the next time they sign in.                      |
| A group's role is changed or removed   | At once, for everyone who has it through that group.                           |
| Someone is added to a group            | The next time they sign in.                                                    |
| Someone is removed from a group        | When their session ends: at sign-out, or after eight hours, whichever is first |
| A person is added or removed by name   | At once.                                                                       |

### Someone who must lose access immediately

Removing them from the group is not enough on its own: their session still
carries the group until it ends. To cut someone off at once:

1. Remove them from the group at the provider, so they do not come back.
2. Remove or lower the group's role in the workspace, **or** disable their
   account at the provider and end their session there.

If the group has many members and only one must go, the quick route is the
provider: disabling the account stops new sign-ins, and the session they have
ends within eight hours. If that is too long, lower the group's role for the
moment and give the others their role by name.

Set `RELAY_TOKEN_SECRET` on the store and the relay as well. Without it,
someone removed from a workspace who had kept a live session's details could
rejoin that session and watch edits; see
[Workspace Store](/deployment/workspace-store#sessions-and-the-relay).

## Troubleshooting

Open `https://<your store>/v2/me` while signed in. It shows what the store
knows about you:

```json
{
  "user": { "userId": "…", "displayName": "Dee Okafor" },
  "groups": ["/platform-eng"],
  "isAdmin": false,
  "canCreateWorkspaces": false
}
```

| What you see                                    | What it means                                                                                                                            |
| :---------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------- |
| `groups` is empty                               | The token carried no groups. Check the mapper adds to the **ID token**, and that `OIDC_GROUPS_CLAIM` names the claim.                    |
| The group is listed, but the workspace is not   | The workspace maps a different spelling. Compare with the name under **Members → Groups**: a missing `/` or different case is a mismatch |
| The group is missing, though you were added     | You signed in before being added. Sign out and in again.                                                                                 |
| `isAdmin` is false, though you are in the group | `ADMIN_GROUPS` is spelled differently from the name in `groups`. Copy it from here, then restart the store.                              |
| The workspace is there, but as a viewer         | You have the highest role any of your groups gives you. An owner can raise the group's role, or add you by name.                         |

## Things to decide first

- **Which groups, and whose.** A workspace per team, with that team's group
  as editors, is the usual shape. Avoid mapping a group so broad that nobody
  would notice a new member.
- **Who owns each workspace.** Owners manage members. Giving a small group
  the owner role keeps that from resting on one person. The editor warns
  before a change that would leave a workspace with no owner; administrators
  can always manage it regardless.
- **Who administers the store.** Administrators can open every workspace and
  every document. Keep `ADMIN_GROUPS` to the people who run the service.
