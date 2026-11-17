/**
 * Store administration: every workspace in the store on one page.
 *
 * Opened by a store administrator from the workspace panel. It covers what
 * the panel does one workspace at a time, across all of them: a table of
 * workspaces with who is in each, how much it holds and when it was last
 * touched; a side panel to manage the selected one (rename, groups, people,
 * archive); everyone and every group with access anywhere; and everything
 * deleted and still kept.
 *
 * Nothing here needs more from the store than an administrator already
 * has: an administrator is an owner of every workspace, so the page reads
 * each one's members and documents and counts them (adminOverview.ts).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Archive, ArchiveRestore, Loader2, Pencil, Plus, RefreshCw, X } from 'lucide-react';
import { Button } from '../../common/components/button/Button';
import {
  describeMembership,
  describeWhen,
  groupsAcross,
  inBatches,
  peopleAcross,
  sortWorkspaceRows,
  summarizeWorkspace,
  type Grant,
  type WorkspaceDetail,
} from '../../collab/trusted/adminOverview';
import type {
  TrustedMe,
  TrustedStoreClient,
  TrustedWorkspace,
} from '../../collab/trusted/trustedStoreClient';
import { DeletedDocuments } from './DeletedDocuments';
import { WorkspaceAccess } from './WorkspaceAccess';

interface StoreAdministrationProps {
  client: TrustedStoreClient;
  me: TrustedMe;
  onClose: () => void;
  /** Called after anything here changes what the rest of the editor may
   * be showing: a workspace created, renamed, archived, its people. */
  onChanged: () => void;
}

type Tab = 'workspaces' | 'people' | 'deleted';
const TABS: readonly { id: Tab; label: string }[] = [
  { id: 'workspaces', label: 'Workspaces' },
  { id: 'people', label: 'People and groups' },
  { id: 'deleted', label: 'Deleted documents' },
];

const ROLE_LABEL = { viewer: 'Viewer', editor: 'Editor', owner: 'Owner' } as const;
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** How many workspaces are read at once. */
const BATCH = 6;

function Grants({ grants }: { grants: readonly Grant[] }) {
  return (
    <ul className="store-admin__grants">
      {grants.map((grant) => (
        <li key={grant.workspaceId}>
          {grant.workspaceName}
          <span className={`store-admin__pill store-admin__pill--${grant.role}`}>
            {ROLE_LABEL[grant.role]}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function StoreAdministration({ client, me, onClose, onChanged }: StoreAdministrationProps) {
  const [details, setDetails] = useState<WorkspaceDetail[] | null>(null);
  const [tab, setTab] = useState<Tab>('workspaces');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [confirmingArchive, setConfirmingArchive] = useState(false);
  // Read when the page loads its data: "2 minutes ago" need not count up.
  const [now, setNow] = useState(() => new Date());

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const workspaces = await client.listWorkspaces({ includeArchived: true });
      const next = await inBatches(workspaces, BATCH, async (workspace) => {
        const [access, documents] = await Promise.all([
          client.listMembers(workspace.workspaceId),
          // The store does not list an archived workspace's deleted
          // documents (nothing in it can be restored until it is); its
          // live ones still count.
          client
            .listDocuments(workspace.workspaceId, { deleted: workspace.archivedAt === null })
            .catch(() => client.listDocuments(workspace.workspaceId)),
        ]);
        return { workspace, members: access.members, groups: access.groups, documents };
      });
      setDetails(next);
      setNow(new Date());
      setError(null);
    } catch (cause) {
      setDetails((previous) => previous ?? []);
      setError(messageOf(cause));
    } finally {
      setBusy(false);
    }
  }, [client]);

  useEffect(() => {
    let canceled = false;
    void Promise.resolve().then(() => {
      if (!canceled) return load();
    });
    return () => {
      canceled = true;
    };
  }, [load]);

  // Escape closes this page and nothing beneath it: the document manager it
  // was opened from listens for the same key.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopImmediatePropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const rows = useMemo(() => sortWorkspaceRows((details ?? []).map(summarizeWorkspace)), [details]);
  const people = useMemo(() => peopleAcross(details ?? []), [details]);
  const groups = useMemo(() => groupsAcross(details ?? []), [details]);
  const withDeleted = useMemo(
    () =>
      (details ?? [])
        .filter((d) => d.documents.some((doc) => doc.deletedAt !== null))
        .sort((a, b) => a.workspace.name.localeCompare(b.workspace.name)),
    [details],
  );
  const selected: TrustedWorkspace | null =
    details?.find((d) => d.workspace.workspaceId === selectedId)?.workspace ?? null;

  const select = (workspaceId: string | null) => {
    setSelectedId(workspaceId);
    setRenaming(null);
    setConfirmingArchive(false);
  };

  /** Makes one change, then reads everything again: the store is the truth. */
  const act = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
      onChanged();
    } catch (cause) {
      setError(messageOf(cause));
    }
    await load();
  };

  const create = () =>
    act(async () => {
      if (newName === null) return;
      const created = await client.createWorkspace(newName);
      setNewName(null);
      select(created.workspaceId);
    });

  const rename = () =>
    act(async () => {
      if (!selected || renaming === null) return;
      await client.renameWorkspace(selected.workspaceId, renaming);
      setRenaming(null);
    });

  const setArchived = (archived: boolean) =>
    act(async () => {
      if (!selected) return;
      await client.setWorkspaceArchived(selected.workspaceId, archived);
      setConfirmingArchive(false);
    });

  const afterAccessChange = () => {
    onChanged();
    void load();
  };

  const page = (
    <div
      className="store-admin"
      role="dialog"
      aria-modal="true"
      aria-label="Store administration"
      data-loaded={details !== null}
    >
      <header className="store-admin__header">
        <span className="store-admin__crumb">Engineers Notebook</span>
        <span className="store-admin__crumb" aria-hidden="true">
          /
        </span>
        <h1 className="store-admin__title">Administration</h1>
        {busy && <Loader2 size={14} className="workspace-panel__busy" aria-label="Loading" />}
        <span className="store-admin__spacer" />
        <span className="store-admin__who">
          {me.user.displayName ?? 'Signed in'}
          <span className="store-admin__pill store-admin__pill--owner">Store admin</span>
        </span>
        <Button
          variant="ghost"
          size="sm"
          icon={<RefreshCw size={12} />}
          className="store-admin__refresh"
          disabled={busy}
          onClick={() => void load()}
        >
          Refresh
        </Button>
        <Button
          variant="secondary"
          size="sm"
          icon={<X size={12} />}
          className="store-admin__close"
          onClick={onClose}
        >
          Close
        </Button>
      </header>

      <nav className="store-admin__tabs" aria-label="Administration sections">
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            className={`store-admin__tab${tab === id ? ' is-current' : ''}`}
            aria-current={tab === id ? 'page' : undefined}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </nav>

      {error && (
        <p className="trusted-workspace__error store-admin__error" role="alert">
          {error}
        </p>
      )}

      {details === null ? (
        <p className="store-admin__empty">Loading the store&apos;s workspaces...</p>
      ) : tab === 'workspaces' ? (
        <div className="store-admin__body">
          <main className="store-admin__main">
            <div className="store-admin__heading">
              <h2>Workspaces</h2>
              <span className="store-admin__spacer" />
              {newName === null ? (
                <Button
                  variant="primary"
                  icon={<Plus size={14} />}
                  className="store-admin__new"
                  onClick={() => setNewName('')}
                >
                  New workspace
                </Button>
              ) : (
                <form
                  className="store-admin__inline-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void create();
                  }}
                >
                  <input
                    className="trusted-workspace__input"
                    aria-label="Name of the new workspace"
                    placeholder="Workspace name"
                    value={newName}
                    maxLength={120}
                    autoFocus
                    onChange={(e) => setNewName(e.target.value)}
                  />
                  <Button type="submit" variant="primary" disabled={busy || newName.trim() === ''}>
                    Create
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => setNewName(null)}>
                    Cancel
                  </Button>
                </form>
              )}
            </div>

            {rows.length === 0 ? (
              <p className="store-admin__empty">
                This store has no workspaces yet. Create one, then give a group from your identity
                provider a role in it: everyone in the group has the workspace the next time they
                sign in.
              </p>
            ) : (
              <div className="store-admin__table-wrap">
                <table className="store-admin__table">
                  <thead>
                    <tr>
                      <th scope="col">Workspace</th>
                      <th scope="col">Members</th>
                      <th scope="col">Documents</th>
                      <th scope="col">Last activity</th>
                      <th scope="col">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr
                        key={row.workspaceId}
                        className={`${row.workspaceId === selectedId ? 'is-selected' : ''}${
                          row.archived ? ' is-archived' : ''
                        }`}
                        data-workspace={row.name}
                        onClick={() =>
                          select(row.workspaceId === selectedId ? null : row.workspaceId)
                        }
                      >
                        <th scope="row">
                          <button
                            type="button"
                            className="store-admin__row-button"
                            aria-pressed={row.workspaceId === selectedId}
                          >
                            {row.name}
                          </button>
                        </th>
                        <td>{describeMembership(row)}</td>
                        <td>
                          {row.documentCount}
                          {row.deletedCount > 0 && (
                            <span className="store-admin__dim"> (+{row.deletedCount} deleted)</span>
                          )}
                        </td>
                        <td title={new Date(row.lastActivity).toLocaleString()}>
                          {describeWhen(row.lastActivity, now)}
                        </td>
                        <td>
                          <span
                            className={`store-admin__pill store-admin__pill--${
                              row.archived ? 'archived' : 'active'
                            }`}
                          >
                            {row.archived ? 'Archived' : 'Active'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </main>

          {selected && (
            <aside className="store-admin__aside" aria-label={`${selected.name} settings`}>
              <div className="store-admin__aside-head">
                {renaming === null ? (
                  <>
                    <h2>{selected.name}</h2>
                    {!selected.archivedAt && (
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={<Pencil size={12} />}
                        className="store-admin__rename"
                        onClick={() => setRenaming(selected.name)}
                      >
                        Rename
                      </Button>
                    )}
                  </>
                ) : (
                  <form
                    className="store-admin__inline-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void rename();
                    }}
                  >
                    <input
                      className="trusted-workspace__input"
                      aria-label="Workspace name"
                      value={renaming}
                      maxLength={120}
                      autoFocus
                      onChange={(e) => setRenaming(e.target.value)}
                    />
                    <Button
                      type="submit"
                      variant="primary"
                      size="sm"
                      disabled={busy || renaming.trim() === ''}
                    >
                      Save
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setRenaming(null)}
                    >
                      Cancel
                    </Button>
                  </form>
                )}
                <span className="store-admin__spacer" />
                <button
                  type="button"
                  className="store-admin__aside-close"
                  aria-label="Close workspace settings"
                  onClick={() => select(null)}
                >
                  <X size={14} />
                </button>
              </div>

              {selected.archivedAt && (
                <p className="trusted-workspace__status">
                  Archived. Its members cannot see it, and nothing in it can be changed until it is
                  restored.
                </p>
              )}

              <WorkspaceAccess
                key={selected.workspaceId}
                client={client}
                workspace={selected}
                me={me}
                onOwnAccessChanged={onChanged}
                onChanged={afterAccessChange}
              />

              <section className="store-admin__danger">
                {selected.archivedAt ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={<ArchiveRestore size={12} />}
                    className="store-admin__restore"
                    disabled={busy}
                    onClick={() => void setArchived(false)}
                  >
                    Restore workspace
                  </Button>
                ) : (
                  <>
                    <p className="trusted-workspace__status">
                      Archiving hides the workspace from its members. Nothing is deleted, and you
                      can restore it.
                    </p>
                    {confirmingArchive ? (
                      <div className="store-admin__inline-form">
                        <span>Archive {selected.name}?</span>
                        <Button
                          variant="danger-outline"
                          size="sm"
                          className="store-admin__archive-yes"
                          disabled={busy}
                          onClick={() => void setArchived(true)}
                        >
                          Archive
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setConfirmingArchive(false)}
                        >
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <Button
                        variant="danger-outline"
                        size="sm"
                        icon={<Archive size={12} />}
                        className="store-admin__archive"
                        onClick={() => setConfirmingArchive(true)}
                      >
                        Archive workspace
                      </Button>
                    )}
                  </>
                )}
              </section>
            </aside>
          )}
        </div>
      ) : tab === 'people' ? (
        <div className="store-admin__body">
          <main className="store-admin__main">
            <div className="store-admin__heading">
              <h2>Groups</h2>
            </div>
            <p className="store-admin__note">
              Everyone in a group has its role in each workspace listed, from the next time they
              sign in. Who is in a group is decided in your identity provider.
            </p>
            {groups.length === 0 ? (
              <p className="store-admin__empty">No workspace gives a group a role yet.</p>
            ) : (
              <div className="store-admin__table-wrap">
                <table className="store-admin__table">
                  <thead>
                    <tr>
                      <th scope="col">Group</th>
                      <th scope="col">Workspaces</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groups.map((row) => (
                      <tr key={row.group} data-group={row.group}>
                        <th scope="row" className="store-admin__mono">
                          {row.group}
                        </th>
                        <td>
                          <Grants grants={row.grants} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="store-admin__heading">
              <h2>People added by name</h2>
            </div>
            {people.length === 0 ? (
              <p className="store-admin__empty">Nobody has been added to a workspace by name.</p>
            ) : (
              <div className="store-admin__table-wrap">
                <table className="store-admin__table">
                  <thead>
                    <tr>
                      <th scope="col">Person</th>
                      <th scope="col">Workspaces</th>
                    </tr>
                  </thead>
                  <tbody>
                    {people.map((row) => (
                      <tr key={row.userId}>
                        <th scope="row">{row.displayName ?? row.userId}</th>
                        <td>
                          <Grants grants={row.grants} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </main>
        </div>
      ) : (
        <div className="store-admin__body">
          <main className="store-admin__main">
            <div className="store-admin__heading">
              <h2>Deleted documents</h2>
            </div>
            {withDeleted.length === 0 ? (
              <p className="store-admin__empty">No workspace has a deleted document being kept.</p>
            ) : (
              withDeleted.map(({ workspace }) => (
                <section
                  key={workspace.workspaceId}
                  className="store-admin__deleted"
                  aria-label={`Deleted from ${workspace.name}`}
                >
                  <h3>
                    {workspace.name}
                    {workspace.archivedAt && (
                      <span className="store-admin__pill store-admin__pill--archived">
                        Archived
                      </span>
                    )}
                  </h3>
                  <DeletedDocuments
                    client={client}
                    workspace={workspace}
                    isAdmin={me.isAdmin}
                    onRestored={afterAccessChange}
                  />
                </section>
              ))
            )}
          </main>
        </div>
      )}
    </div>
  );

  return typeof document === 'undefined' || !document.body
    ? page
    : createPortal(page, document.body);
}
