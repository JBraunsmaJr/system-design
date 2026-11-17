# How your work is protected

This page describes where your documents are, who can read them, and what
protects them on the way. It is written for the people using the editor and
for anyone reviewing it before a deployment.

The short version: **without a workspace, your documents never leave your
browser. With one, they are kept on your organization's server, and whoever
runs that server can read them.**

## Three places a document can be

| Where              | Who can read it                                                                   |
| :----------------- | :-------------------------------------------------------------------------------- |
| **Your browser**   | You, and anyone with access to that browser profile.                              |
| **A live session** | The people in it. It passes between their browsers, encrypted with a session key. |
| **A workspace**    | The workspace's members, the store's administrators, and whoever runs the server. |

### In your browser

A document you have not put in a workspace is stored only in the browser
you made it in. Nothing is sent anywhere. Clearing that browser's data
removes it, which is why the editor can also keep a file on disk up to date
for you.

### In a live session

A session connects browsers to each other so people can edit together. What
they send is encrypted with a key that only the people in the session have:

- for a session you **start yourself**, the key is in the link you share,
  after the `#`. Browsers do not send that part of an address to any server,
  so the relay that introduces the browsers to each other never has it.
  Anyone you send the link to can join, so send it as you would the
  document;
- for a **workspace document**, the store gives the key to people who may
  edit that document.

The relay only passes messages along. It cannot read them, and it keeps
nothing.

### In a workspace

A workspace keeps documents on your organization's server so a team can
share them. They are stored **as they are**, not encrypted by your browser
first. That means:

- the workspace's **members** can open them, according to their role;
- the store's **administrators** can open every workspace;
- **anyone who runs the server**, or can reach its database or its backups,
  can read every document in it.

The editor says this wherever it shows workspaces, and it cannot be
dismissed:

> Documents in a workspace are stored on your organization's server, and its
> administrators can read them.

If a document should not be readable by the people who run your server, keep
it out of a workspace. It stays in your browser, and you can still share it
in a session by link.

## What protects a workspace

**Sign-in.** The store accepts nobody it has not signed in through your
organization's identity provider. It never sees your password; the provider
tells it who you are and which groups you are in.

**Roles.** What you may do in a workspace is decided by the store, for every
request, from your role there: viewer, editor or owner. Someone with no role
in a workspace cannot tell it exists. Roles come from being added by name or
from a group; see [Workspaces](/guide/workspaces#which-workspaces-you-have).

**The connection.** Everything between your browser and the store travels
over HTTPS, so it cannot be read or changed on the way.

**Where it runs.** The store is meant to run inside your organization's own
network, by your organization. It is not a service shared with anyone else.

**A record.** The store records every request: who made it, what it was, and
whether it was allowed. Administrators can review it.

**Retention.** A deleted document is kept for a period your organization
sets, so a mistake can be undone, and then removed. An administrator can
place a hold that keeps one longer.

## What this does not protect against

Stated plainly, because a security page that only lists strengths is not
much use:

- **The people who run the server.** They can read workspace documents. So
  can anyone who obtains a copy of the database or a backup. Protecting
  those is your organization's job, as it is for any file server.
- **A compromised browser.** Anything your browser can open, malware running
  in it can open too.
- **Someone you gave access to.** Removing someone stops them opening
  documents from then on. It does not recall copies they already have.
- **A session after someone is removed.** Where the relay is not set up to
  require a token from the store, someone removed from a workspace who had
  kept a live session's details could rejoin that session and watch edits
  being made. They could not open or change anything in the store.
  Administrators prevent this with one setting; see
  [Workspace Store](/deployment/workspace-store#sessions-and-the-relay).
- **A long sign-in.** Your groups are read when you sign in. If you are
  taken out of a group, the access it gave you ends when your sign-in does,
  which can be up to eight hours later.

## An earlier design

Earlier releases encrypted workspace documents in the browser, with keys
held by each enrolled device, so that the server could not read them. It
was removed: enrolling devices, comparing codes, keeping recovery codes and
waiting to be let in made shared workspaces hard to use, for deployments
that already run inside a protected network and trust the people operating
it. If your organization needs documents the server cannot read, workspaces
are not the place for them; documents kept in the browser and shared by
session link still never reach a server in readable form.
