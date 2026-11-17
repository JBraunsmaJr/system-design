# Deploying the store

The store gives teams shared workspaces: sign-in through your identity
provider, documents kept on your server, and roles that decide who may open
and change each one. It is optional. An editor with no store behaves exactly
as it always has, and nothing leaves the browser.

It keeps documents as the editor sends them. **The server, its database, its
backups and its administrators can read every workspace document.** Run it
inside your own network and protect it accordingly.

## Trying it

```bash
docker compose -f docker/store/compose.yaml up --build
```

Open <http://localhost:8088>, then **File → Documents**, and sign in as
`demo` / `demo`. That account is a store administrator, so it can create a
workspace. `otter` / `otter` and `badger` / `badger` are in the groups
`/design-team-a` and `/design-team-b`; give a group a role under a
workspace's **Members** and its people have the workspace the next time they
sign in.

That is all it takes, but read what it gives you before going further:
placeholder passwords and client secret, demo accounts, a relay that admits
anyone, and plain HTTP on localhost. None of that belongs in a deployment.

## Deploying it

The guides are in the documentation site, which is in this repository as
Markdown and is served by every editor container at `/docs/`:

| Guide                                                                         | Covers                                                                             |
| :---------------------------------------------------------------------------- | :--------------------------------------------------------------------------------- |
| [Deployment with Workspaces](../docs-site/docs/deployment/with-workspaces.md) | A complete deployment behind one domain, step by step, with the files to copy.     |
| [Workspace Store](../docs-site/docs/deployment/workspace-store.md)            | Every setting, identity provider setup, origins and HTTPS, the relay, backups.     |
| [Groups and Roles](../docs-site/docs/deployment/group-access.md)              | Getting groups from your provider to the store, and how roles are decided.         |
| [Administering Workspaces](../docs-site/docs/deployment/administration.md)    | Administrators, archiving, retention, legal holds, the audit trail, and the API.   |
| [How your work is protected](../docs-site/docs/guide/security.md)             | What the server can read, written for the people using it and anyone assessing it. |

The files those guides tell you to copy are in
[`docs-site/docs/files/workspace`](../docs-site/docs/files/workspace), and
`scripts/verify-deployment-example.ts` checks that they, and the example in
`docker/store`, would start and leave someone able to create a workspace.

## For people working on the store

[`docs/trusted-store.md`](trusted-store.md) is the design note: the model,
where each rule lives in the code, the API, and what to do with a database
that held the earlier, encrypted workspace.
