/**
 * The workspaces of a trusted store, inside File > Documents.
 *
 * Shown in place of WorkspacePanel when the store serves the workspace API
 * (docs/trusted-store.md). There are no keys here, so none of that panel's
 * states exist - no device to enroll, no code to compare, no one to wait
 * for. Someone signed in sees the workspaces their roles and groups give
 * them, at once, and can:
 *
 *   - open a workspace's documents,
 *   - put a copy of the document they have open into a workspace (editors),
 *   - delete a document from a workspace (editors),
 *   - create a workspace (where the store allows them to),
 *   - see who is in a workspace, and as an owner change that
 *     (WorkspaceAccess) and rename it,
 *   - see what has been deleted and restore it (editors; DeletedDocuments),
 *   - as a store administrator, archive a workspace and bring it back.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Archive,
  ArchiveRestore,
  History,
  Cloud,
  CloudOff,
  FolderOpen,
  Loader2,
  Pencil,
  Plus,
  Settings2,
  ShieldAlert,
  Trash2,
  Upload,
  Users,
} from 'lucide-react';
import { Button } from '../../common/components/button/Button';
import { StoreClientError } from '../../collab/access/storeErrors';
import { announceWorkspaceChange } from '../../collab/trusted/workspaceSyncState';
import { describeRole } from '../../collab/trusted/roleWords';
import { newDocumentId } from '../../domain/storage/documentStore';
import { DeletedDocuments } from './DeletedDocuments';
import { StoreAdministration } from './StoreAdministration';
import { WorkspaceAccess } from './WorkspaceAccess';
import {
  createTrustedStoreClient,
  type TrustedDocument,
  type TrustedMe,
  type TrustedStoreClient,
  type TrustedWorkspace,
} from '../../collab/trusted/trustedStoreClient';

interface TrustedWorkspacePanelProps {
  storeUrl: string;
  currentDocId: string;
  currentTitle: string;
  onOpenDocument: (docId: string) => void;
  /** The open document's whole CRDT state, to copy into a workspace. */
  getDocumentState: () => Uint8Array;
  /** Sends the browser to sign in. Absent when the store offers no way to. */
  onSignIn?: () => void;
  /** Injected for tests. */
  client?: TrustedStoreClient;
}

type Phase = 'loading' | 'offline' | 'signed-out' | 'ready';

const canEdit = (workspace: TrustedWorkspace | null) =>
  workspace !== null && workspace.role !== 'viewer' && workspace.archivedAt === null;

function formatWhen(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString();
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function TrustedWorkspacePanel(props: TrustedWorkspacePanelProps) {
  const { storeUrl, currentDocId, currentTitle, onOpenDocument, getDocumentState, onSignIn } =
    props;
  const client = useMemo(
    () => props.client ?? createTrustedStoreClient({ baseUrl: storeUrl }),
    [props.client, storeUrl],
  );

  const [phase, setPhase] = useState<Phase>('loading');
  const [me, setMe] = useState<TrustedMe | null>(null);
  const [workspaces, setWorkspaces] = useState<TrustedWorkspace[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [documents, setDocuments] = useState<TrustedDocument[] | null>(null);
  /** Where the open document is, if it is in a workspace this person sees. */
  const [currentIn, setCurrentIn] = useState<TrustedDocument | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  /** Whether the selected workspace's members and groups are shown. */
  const [showAccess, setShowAccess] = useState(false);
  /** The new name being typed for the selected workspace, or null. */
  const [renaming, setRenaming] = useState<string | null>(null);
  const [confirmingArchive, setConfirmingArchive] = useState(false);
  const [showDeleted, setShowDeleted] = useState(false);
  /** Bumped when a document is deleted, so an open deleted list reloads. */
  const [deletions, setDeletions] = useState(0);
  /** Whether the store administration page is open. */
  const [administering, setAdministering] = useState(false);

  /** Whether the open document was in a workspace when last looked at. */
  const wasInWorkspace = useRef<boolean | null>(null);
  const selected = workspaces.find((w) => w.workspaceId === selectedId) ?? null;

  /** Who is signed in, their workspaces, and where the open document is. */
  const load = useCallback(async () => {
    try {
      const [who, list, current] = await Promise.all([
        client.me(),
        // Archived ones too: the store only includes them for an
        // administrator, the one person who can bring them back.
        client.listWorkspaces({ includeArchived: true }),
        // A document deleted from its workspace is, for this panel, not in one.
        client.findDocument(currentDocId).catch((cause) => {
          if (cause instanceof StoreClientError && cause.reason === 'deleted') return null;
          throw cause;
        }),
      ]);
      setMe(who);
      setWorkspaces(list);
      setCurrentIn(current);
      // The open document has entered or left a workspace since this panel
      // last looked - restored by someone else, say. Syncing should
      // follow; it does nothing if it already agrees.
      if (wasInWorkspace.current !== (current !== null)) {
        wasInWorkspace.current = current !== null;
        announceWorkspaceChange();
      }
      // Keep the selection if it still exists; otherwise the open
      // document's workspace, or the first.
      setSelectedId((previous) =>
        previous && list.some((w) => w.workspaceId === previous)
          ? previous
          : (current?.workspaceId ?? list[0]?.workspaceId ?? null),
      );
      setPhase('ready');
    } catch (cause) {
      if (cause instanceof StoreClientError && cause.reason === 'unauthenticated') {
        setPhase('signed-out');
      } else if (cause instanceof StoreClientError && cause.reason === 'offline') {
        setPhase('offline');
      } else {
        setPhase('ready');
        setError(messageOf(cause));
      }
    }
  }, [client, currentDocId]);

  useEffect(() => {
    let canceled = false;
    void Promise.resolve().then(() => {
      if (!canceled) return load();
    });
    return () => {
      canceled = true;
    };
  }, [load]);

  const loadDocuments = useCallback(
    async (workspaceId: string) => {
      try {
        setDocuments(await client.listDocuments(workspaceId));
      } catch (cause) {
        setDocuments([]);
        setError(messageOf(cause));
      }
    },
    [client],
  );

  useEffect(() => {
    if (!selectedId) return;
    let canceled = false;
    void Promise.resolve().then(() => {
      if (!canceled) return loadDocuments(selectedId);
    });
    return () => {
      canceled = true;
    };
  }, [selectedId, loadDocuments]);

  /** Runs one change, shows what went wrong if it fails, and reloads. */
  const act = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(false);
    }
  };

  /**
   * Puts a copy of the open document in the selected workspace, under a new
   * id, and opens that copy.
   *
   * A copy, not the document itself, because a browser's first document has
   * the same id in every browser ("local"). Sharing that id would make
   * every teammate's own first document the same document as this one the
   * moment they signed in, merging their private work into the workspace.
   * A fresh id belongs to this document alone.
   */
  const addCurrent = () =>
    act(async () => {
      if (!selected) return;
      const docId = newDocumentId();
      const created = await client.createDocument(selected.workspaceId, {
        docId,
        title: currentTitle,
      });
      await client.documentLog(docId).append(getDocumentState(), created.version);
      // The tab moves to the workspace copy; the original stays here.
      onOpenDocument(docId);
    });

  const remove = (docId: string) =>
    act(async () => {
      await client.deleteDocument(docId);
      setConfirmingDelete(null);
      setDeletions((count) => count + 1);
      if (docId === currentDocId) announceWorkspaceChange();
      await load();
      if (selected) await loadDocuments(selected.workspaceId);
    });

  const rename = () =>
    act(async () => {
      if (!selected || renaming === null) return;
      await client.renameWorkspace(selected.workspaceId, renaming);
      setRenaming(null);
      await load();
    });

  const setArchived = (archived: boolean) =>
    act(async () => {
      if (!selected) return;
      await client.setWorkspaceArchived(selected.workspaceId, archived);
      setConfirmingArchive(false);
      // The open document may have just become read-only, or stopped being.
      if (currentIn?.workspaceId === selected.workspaceId) announceWorkspaceChange();
      await load();
    });

  /** The signed-in person changed their own role: what they see may differ. */
  const reloadAfterOwnAccessChange = useCallback(() => {
    announceWorkspaceChange();
    void load();
  }, [load]);

  const createWorkspace = () =>
    act(async () => {
      if (newName === null) return;
      const created = await client.createWorkspace(newName);
      setNewName(null);
      await load();
      setSelectedId(created.workspaceId);
    });

  return (
    <div className="workspace-panel trusted-workspace" data-phase={phase}>
      <div className="workspace-panel__header">
        {phase === 'offline' ? <CloudOff size={14} /> : <Cloud size={14} />}
        <strong>Workspaces</strong>
        {(phase === 'loading' || busy) && <Loader2 size={12} className="workspace-panel__busy" />}
        {me && <span className="workspace-panel__who">{me.user.displayName ?? 'Signed in'}</span>}
        {me?.isAdmin && (
          <span className="workspace-panel__admin">
            <span className="store-admin__pill store-admin__pill--owner">Store admin</span>
            <Button
              variant="secondary"
              size="sm"
              icon={<Settings2 size={12} />}
              className="trusted-workspace__administration"
              onClick={() => setAdministering(true)}
            >
              Administration
            </Button>
          </span>
        )}
      </div>

      {administering && me && (
        <StoreAdministration
          client={client}
          me={me}
          onClose={() => setAdministering(false)}
          onChanged={reloadAfterOwnAccessChange}
        />
      )}

      {/* Not dismissible, and stated plainly: this is what "trusted" means. */}
      <p className="trusted-workspace__notice" role="note">
        <ShieldAlert size={14} aria-hidden="true" />
        <span>
          Documents in a workspace are stored on your organization&apos;s server, and its
          administrators can read them.
        </span>
      </p>

      {phase === 'offline' && (
        <p className="trusted-workspace__status">
          The store is unreachable. Your work is saved in this browser.{' '}
          <button type="button" className="trusted-workspace__link" onClick={() => void load()}>
            Try again
          </button>
        </p>
      )}

      {phase === 'signed-out' && (
        <div className="trusted-workspace__row">
          <span>Sign in to see your workspaces.</span>
          {onSignIn && (
            <Button
              variant="secondary"
              size="sm"
              className="trusted-workspace__sign-in"
              onClick={onSignIn}
            >
              Sign in
            </Button>
          )}
        </div>
      )}

      {error && (
        <p className="trusted-workspace__error" role="alert">
          {error}
        </p>
      )}

      {phase === 'ready' && me && (
        <>
          {workspaces.length === 0 ? (
            <p className="trusted-workspace__status">
              You are not in any workspace yet.{' '}
              {me.isAdmin
                ? 'Open Administration to create one and give a group a role in it.'
                : me.canCreateWorkspaces
                  ? 'Create one to share documents.'
                  : 'A workspace owner can add you by name, or a store administrator can give one of your groups a role in a workspace.'}
              {!me.isAdmin && (
                <>
                  {' '}
                  {me.groups.length > 0
                    ? `Your groups: ${me.groups.join(', ')}.`
                    : 'Your sign-in reported no groups.'}
                </>
              )}
            </p>
          ) : (
            <div className="trusted-workspace__row">
              <label htmlFor="trusted-workspace-select">Workspace</label>
              <select
                id="trusted-workspace-select"
                className="trusted-workspace__select"
                value={selectedId ?? ''}
                onChange={(e) => {
                  setDocuments(null);
                  setConfirmingDelete(null);
                  setRenaming(null);
                  setConfirmingArchive(false);
                  setSelectedId(e.target.value);
                }}
              >
                {workspaces.map((workspace) => (
                  <option key={workspace.workspaceId} value={workspace.workspaceId}>
                    {workspace.name}
                    {workspace.archivedAt ? ' (archived)' : ''}
                  </option>
                ))}
              </select>
              {selected && (
                <span className="trusted-workspace__role">{describeRole(selected)}</span>
              )}
            </div>
          )}

          {me.canCreateWorkspaces &&
            (newName === null ? (
              <div>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<Plus size={12} />}
                  className="trusted-workspace__new"
                  onClick={() => setNewName('')}
                >
                  New workspace
                </Button>
              </div>
            ) : (
              <form
                className="trusted-workspace__row"
                onSubmit={(e) => {
                  e.preventDefault();
                  void createWorkspace();
                }}
              >
                <label htmlFor="trusted-workspace-name">Name</label>
                <input
                  id="trusted-workspace-name"
                  className="trusted-workspace__input"
                  value={newName}
                  maxLength={120}
                  autoFocus
                  onChange={(e) => setNewName(e.target.value)}
                />
                <Button
                  type="submit"
                  variant="primary"
                  size="sm"
                  disabled={busy || newName.trim() === ''}
                >
                  Create
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setNewName(null)}>
                  Cancel
                </Button>
              </form>
            ))}

          {selected && (
            <>
              {selected.archivedAt && (
                <p className="trusted-workspace__status trusted-workspace__archived">
                  <strong>{selected.name}</strong> is archived. Its members cannot see it, and
                  nothing in it can be changed until it is restored.
                </p>
              )}

              <div className="trusted-workspace__row trusted-workspace__manage">
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<Users size={12} />}
                  className="trusted-workspace__access-toggle"
                  aria-expanded={showAccess}
                  onClick={() => setShowAccess((shown) => !shown)}
                >
                  {showAccess ? 'Hide members' : 'Members'}
                </Button>
                {selected.role !== 'viewer' && (
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={<History size={12} />}
                    className="trusted-workspace__deleted-toggle"
                    aria-expanded={showDeleted}
                    onClick={() => setShowDeleted((shown) => !shown)}
                  >
                    {showDeleted ? 'Hide deleted' : 'Deleted'}
                  </Button>
                )}
                {selected.role === 'owner' && !selected.archivedAt && renaming === null && (
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={<Pencil size={12} />}
                    className="trusted-workspace__rename"
                    onClick={() => setRenaming(selected.name)}
                  >
                    Rename
                  </Button>
                )}
                {me.isAdmin &&
                  (selected.archivedAt ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={<ArchiveRestore size={12} />}
                      className="trusted-workspace__restore"
                      disabled={busy}
                      onClick={() => void setArchived(false)}
                    >
                      Restore
                    </Button>
                  ) : confirmingArchive ? (
                    <>
                      <span className="trusted-workspace__document-meta">
                        Archive {selected.name}? Its members will no longer see it or its documents.
                        Nothing is deleted, and you can restore it.
                      </span>
                      <Button
                        variant="danger-outline"
                        size="sm"
                        className="trusted-workspace__archive-yes"
                        disabled={busy}
                        onClick={() => void setArchived(true)}
                      >
                        Archive
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setConfirmingArchive(false)}>
                        Cancel
                      </Button>
                    </>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={<Archive size={12} />}
                      className="trusted-workspace__archive"
                      onClick={() => setConfirmingArchive(true)}
                    >
                      Archive
                    </Button>
                  ))}
              </div>

              {renaming !== null && (
                <form
                  className="trusted-workspace__row"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void rename();
                  }}
                >
                  <label htmlFor="trusted-workspace-rename">New name</label>
                  <input
                    id="trusted-workspace-rename"
                    className="trusted-workspace__input"
                    value={renaming}
                    maxLength={120}
                    autoFocus
                    onChange={(e) => setRenaming(e.target.value)}
                  />
                  <Button
                    type="submit"
                    variant="primary"
                    size="sm"
                    disabled={busy || renaming.trim() === '' || renaming.trim() === selected.name}
                  >
                    Rename
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setRenaming(null)}>
                    Cancel
                  </Button>
                </form>
              )}

              {showAccess && (
                // Keyed by workspace and role: switching workspace, or
                // losing the owner role, starts it afresh.
                <WorkspaceAccess
                  key={`${selected.workspaceId}:${selected.role}:${selected.archivedAt ?? ''}`}
                  client={client}
                  workspace={selected}
                  me={me}
                  onOwnAccessChanged={reloadAfterOwnAccessChange}
                />
              )}

              {showDeleted && selected.role !== 'viewer' && (
                <DeletedDocuments
                  key={`${selected.workspaceId}:${deletions}:${selected.archivedAt ?? ''}`}
                  client={client}
                  workspace={selected}
                  isAdmin={me.isAdmin}
                  onRestored={(docId) => {
                    if (docId === currentDocId) announceWorkspaceChange();
                    void load();
                    void loadDocuments(selected.workspaceId);
                  }}
                />
              )}

              {currentIn ? (
                <p className="trusted-workspace__status">
                  The document you have open is in{' '}
                  <strong>
                    {workspaces.find((w) => w.workspaceId === currentIn.workspaceId)?.name ??
                      'a workspace'}
                  </strong>{' '}
                  and saves there as you work.
                </p>
              ) : (
                canEdit(selected) && (
                  <div className="trusted-workspace__row">
                    <span>
                      The document you have open is only in this browser. Adding it puts a copy in
                      the workspace and opens that copy; the original stays here.
                    </span>
                    <Button
                      variant="secondary"
                      size="sm"
                      icon={<Upload size={12} />}
                      className="trusted-workspace__add"
                      disabled={busy}
                      onClick={() => void addCurrent()}
                    >
                      Add a copy to {selected.name}
                    </Button>
                  </div>
                )
              )}

              <div className="trusted-workspace__documents">
                {documents === null ? (
                  <p className="trusted-workspace__status">Loading documents...</p>
                ) : documents.length === 0 ? (
                  <p className="trusted-workspace__status">{selected.name} has no documents yet.</p>
                ) : (
                  documents.map((document) => {
                    const isCurrent = document.docId === currentDocId;
                    return (
                      <div
                        key={document.docId}
                        className={`trusted-workspace__document${isCurrent ? ' is-current' : ''}`}
                      >
                        <div className="trusted-workspace__document-main">
                          <span className="trusted-workspace__document-title">
                            {document.title}
                          </span>
                          <span className="trusted-workspace__document-meta">
                            {isCurrent ? 'Open now · ' : ''}
                            Edited {formatWhen(document.updatedAt)}
                          </span>
                        </div>
                        {confirmingDelete === document.docId ? (
                          <>
                            <span className="trusted-workspace__document-meta">
                              Delete for everyone in {selected.name}?
                            </span>
                            <Button
                              variant="danger-outline"
                              size="sm"
                              disabled={busy}
                              onClick={() => void remove(document.docId)}
                            >
                              Delete
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setConfirmingDelete(null)}
                            >
                              Cancel
                            </Button>
                          </>
                        ) : (
                          <>
                            {!isCurrent && (
                              <Button
                                variant="secondary"
                                size="sm"
                                icon={<FolderOpen size={12} />}
                                className="trusted-workspace__open"
                                onClick={() => onOpenDocument(document.docId)}
                              >
                                Open
                              </Button>
                            )}
                            {canEdit(selected) && (
                              <Button
                                variant="ghost"
                                size="sm"
                                iconOnly
                                icon={<Trash2 size={12} />}
                                aria-label={`Delete ${document.title}`}
                                title={`Delete ${document.title}`}
                                onClick={() => setConfirmingDelete(document.docId)}
                              />
                            )}
                          </>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
