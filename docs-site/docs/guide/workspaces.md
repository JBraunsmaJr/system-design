# Workspaces

A **workspace** is shared storage for documents. Everyone in it can open the
same documents from any browser they have signed in on, and changes are kept
without anyone remembering to save or send a file.

Workspaces are optional. With no workspace configured, the editor behaves as
it always has: documents live in your browser, sessions are started from a
link, and nothing leaves the machine.

::: tip The short version
A **workspace** is where documents live. A **session** is who is in one right
now. Opening a workspace document puts you in its session automatically.
:::

## Signing in

Open **File → Documents**. If your deployment has a workspace, a Workspace
section appears at the top with the sign-in providers it accepts - usually
your organization's single sign-on.

Signing in identifies you. It does not, on its own, let you read anything:
documents are encrypted with keys the server never holds, so access is
something a person gives you, not something the server can grant.

## The first browser

The first person to use a workspace sets it up: their browser generates the
keys and is ready immediately. Any document they save becomes readable by
anyone they let in afterwards.

## Every browser after that

A **second browser of your own** - a laptop as well as a desktop - shows a
short verification code and waits. On a browser you already use, open
**File → Documents** and approve it, checking the code matches on both
screens. Comparing the code is what stops someone substituting their own
browser for yours; if the codes differ, refuse.

A **different person** signing in is told they are waiting for access.
Anyone already in the workspace sees them listed under _People in this
workspace_ with a **Give access** button. Pressing it hands them the
workspace key, wrapped so that only they can open it. Their browser picks it
up within a few seconds.

Nothing you do while waiting can read the workspace - and neither can the
server.

### Joining automatically

Your workspace may be set up to let in everyone in a particular group at your
organization. If you are in it, you do not wait for anyone to press a button:
a teammate's open editor checks your sign-in and lets you in, usually within
a few seconds.

If nobody in the workspace has the editor open, you wait until someone does -
the screen says so. Leave it open, or come back later; if a day passes, you
will be asked to sign in again so your sign-in can be checked.

Your teammate's browser checks your organization's signed record of your
groups itself, rather than trusting the workspace server, so the server
cannot use this to let anyone else in. Administrators set it up as described
in [Automatic Access from Groups](/deployment/group-access).

## Saving

Save the open document with **Save this document to the workspace**. From
then on it keeps itself up to date: every autosave goes to the workspace as
well as to your browser, and the save indicator reads **In workspace**.

If the workspace is unreachable, the editor says so and keeps working. Your
changes stay in your browser and go up when it returns.

## Working together

Opening a workspace document puts you in a live session with everyone else
who has it open. You see their cursors, their selections and their names, and
their edits arrive as they type. Nobody shares a link - everyone holding the
document's key arrives in the same place.

Concurrent edits **merge**. Two people editing the same diagram both keep
their work; there is no last-writer-wins and no overwrite. Someone who edits
while disconnected keeps those changes too, and they are merged when they
come back.

## Losing a laptop

Two steps, and both matter:

1. **Revoke the browser.** Under _Browsers with access_, press **Revoke**.
   The workspace stops serving it immediately.
2. **Rotate the key.** A revoked browser still holds the workspace key it
   already had. **Rotate key** replaces it so that key opens nothing saved
   afterwards. Every document is re-wrapped; no content is re-encrypted and
   nothing is lost - a workspace of 500 documents rotates in under a second.

Revoking alone is not enough, and the editor says so at the point you do it.

## Getting back in

| Situation                                       | What to use                             |
| ----------------------------------------------- | --------------------------------------- |
| New browser, one you already use still works    | Approve it from the working browser     |
| Every browser gone, you have your recovery code | The recovery code unseals your keys     |
| Every browser gone and no recovery code         | An administrator re-grants access       |
| The workspace itself has lost its keys          | The organization's offline recovery key |

### Your recovery code

Once you have access, File → Documents offers to **create a recovery code**.
It is shown once - 28 characters in groups of five - and you are asked to
confirm you have kept it. Keep it somewhere other than the machines it
recovers: written down, or in a password manager.

The workspace never stores the code in any form, which is also why nobody -
including an administrator - can look it up for you. You can make a new one
at any time; the old one stops working.

To use it, open File → Documents on the new browser. It will be waiting for
approval; choose **No other browser? Use your recovery code** and type it.
Case, spaces and dashes do not matter, and a mistyped character is caught
before anything is sent, because the code checks itself.

## What the server can see

See [How your work is protected](/guide/security) for the detail. In short:
in its default mode the workspace stores documents it cannot read, and the
interface tells you plainly on the rare deployment configured otherwise.
