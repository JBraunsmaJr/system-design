# Workspaces

A **workspace** is shared storage for a team's documents, kept on your
organization's server. Everyone in it can open the same documents from any
browser they have signed in on, and changes are kept without anyone
remembering to save or send a file.

Workspaces are optional. With no store set up, the editor behaves as it
always has: documents live in your browser, sessions are started from a
link, and nothing leaves the machine.

::: tip The short version
A **workspace** is where documents live. A **session** is who is in one right
now. Opening a workspace document puts you in its session automatically.
:::

::: warning Who can read a workspace document
Documents in a workspace are stored on your organization's server as they
are. Its administrators can read them. The editor says so wherever it shows
workspaces. [How your work is protected](/guide/security) has the detail.
:::

## Signing in

Open **File → Documents** and choose **Sign in**. You are sent to your
organization's sign-in page and brought back to the document you had open.

That is all there is to it. There is nothing to set up on each browser, no
code to compare, and nobody has to approve you: the workspaces you can use
are there as soon as you are signed in.

### If your editor has no store

Some copies of the editor are not set up with a store - the public one, for
example. **File → Documents** then shows **No store**. Choose **Connect to a
store** and type the address your administrator gave you. The editor checks
that a store answers there before remembering it, and reloads.

The address is remembered in this browser only. **Change** lets you point at
a different store or stop using one. Documents already in your browser stay
where they are whichever you choose.

## Which workspaces you have

A workspace is yours in one of two ways, and the panel tells you which:

> You are an editor here, through the group /platform-eng.

- **Through a group.** Your organization's sign-in tells the store which
  groups you are in, and a workspace can give a whole group a role. Join the
  group and you have the workspace the next time you sign in.
- **By name.** An owner of the workspace added you.

If you expected a workspace and it is not there, sign out and in again:
groups are read when you sign in. If it still is not there, ask one of its
owners, or your administrator.

| Role       | You can                                                         |
| :--------- | :-------------------------------------------------------------- |
| **Viewer** | Open the workspace's documents and follow changes to them.      |
| **Editor** | Also create, change, delete and restore documents.              |
| **Owner**  | Also rename the workspace and decide who is in it, and as what. |

## Putting a document in a workspace

Open the document, then **File → Documents**, pick the workspace, and choose
**Add a copy to …**.

The workspace gets a copy, and the editor switches you to it. The original
stays in your browser, untouched; delete it from your documents list if you
no longer want it. From then on the copy saves to the workspace as you work.

## Opening one

**File → Documents**, pick the workspace, and choose **Open** beside the
document. It arrives from the store with everyone's changes.

The "Linked document" field on a diagram node offers workspace documents
too, including ones you have never opened.

## Saving

A workspace document keeps itself up to date. Every change goes to the
workspace within a second or so, and the save indicator says where your work
is.

If the store is unreachable, the editor says so and keeps working. Your
changes stay in your browser and go up when it returns.

## Working together

Opening a workspace document puts you in a live session with everyone else
who can edit it and has it open. You see their cursors, their selections and
their names, and their edits arrive as they type. Nobody shares a link.

Concurrent edits **merge**. Two people editing the same diagram both keep
their work; there is no last-writer-wins and no overwrite. Someone who edits
while disconnected keeps those changes too, and they are merged when they
come back.

**Viewers** are not in the live session. They see changes a few seconds
after they are made, and anything they change on their own screen stays
there: it is not sent to the workspace.

## Deleting, and getting a document back

An editor can delete a document from a workspace with the bin beside it. It
is gone for everyone in the workspace, but not at once from the store: your
organization keeps deleted documents for a period, so a mistake can be
undone.

Choose **Deleted** in the workspace panel to see what is being kept and for
how long, and **Restore** to bring one back. If you had it open, saving
resumes when you return to the tab.

## Managing a workspace

Owners see more in the panel.

**Members** lists the people added by name and the groups that have a role.

- **Add someone** by typing their name. They can be found once they have
  signed in at least once.
- **Add a group** by typing its name as your sign-in provider reports it,
  and picking a role. Everyone in it has that role the next time they sign
  in. Your own groups are suggested; any other is typed.
- Change a role with the menu beside a person or group, or remove them with
  the bin.

Someone with more than one role - their own, and one from a group - has the
highest of them. To give someone less than their group has, they have to
come out of the group.

The editor asks before a change that would take away your own access or
leave the workspace with no owner.

**Rename** changes the workspace's name for everyone.

## Losing a laptop

Sign-in is your organization's, so that is where a lost machine is dealt
with: change your password there, and ask your administrator to end your
sessions. Nothing about the workspace needs replacing.

Documents you had open are still in that browser's storage. If that matters,
treat the laptop as you would one holding the files themselves.

## What the server can see

Everything in a workspace. See [How your work is protected](/guide/security).
