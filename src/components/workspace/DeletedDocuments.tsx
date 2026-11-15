/**
 * A workspace's deleted documents.
 *
 * Deleting a document from a workspace keeps it in the store for the
 * retention period, so it can be brought back. Editors and owners see what
 * is kept and can restore it. A store administrator can also place a hold,
 * which keeps a document past its retention until released, and remove a
 * document for good before its time.
 */
import { useCallback, useEffect, useState } from 'react';
import { Lock, RotateCcw, Trash2, Unlock } from 'lucide-react';
import { Button } from '../../common/components/button/Button';
import { deletedFirstByRecency, describeRetention } from '../../collab/trusted/retentionWords';
import type {
  TrustedDocument,
  TrustedStoreClient,
  TrustedWorkspace,
} from '../../collab/trusted/trustedStoreClient';

interface DeletedDocumentsProps {
  client: TrustedStoreClient;
  workspace: TrustedWorkspace;
  isAdmin: boolean;
  /** Called after a document comes back, so the live list can reload. */
  onRestored: (docId: string) => void;
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

type Asking = { docId: string; kind: 'purge' } | { docId: string; kind: 'hold'; reason: string };

export function DeletedDocuments({
  client,
  workspace,
  isAdmin,
  onRestored,
}: DeletedDocumentsProps) {
  const { workspaceId } = workspace;
  const canChange = workspace.archivedAt === null;
  const [documents, setDocuments] = useState<TrustedDocument[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState<Asking | null>(null);
  // Read once: "days left" does not need to tick while the list is open.
  const [now] = useState(() => new Date());

  const load = useCallback(async () => {
    try {
      const all = await client.listDocuments(workspaceId, { deleted: true });
      setDocuments(deletedFirstByRecency(all));
    } catch (cause) {
      setDocuments([]);
      setError(messageOf(cause));
    }
  }, [client, workspaceId]);

  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (!cancelled) return load();
    });
    return () => {
      cancelled = true;
    };
  }, [load]);

  const act = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
      setAsking(null);
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(false);
      await load();
    }
  };

  if (documents === null) {
    return <p className="trusted-workspace__status">Loading deleted documents...</p>;
  }

  return (
    <div className="workspace-access deleted-documents">
      {error && (
        <p className="trusted-workspace__error" role="alert">
          {error}
        </p>
      )}
      {documents.length === 0 ? (
        <p className="trusted-workspace__status">
          Nothing deleted from {workspace.name} is being kept.
        </p>
      ) : (
        documents.map((document) => {
          const mine = asking?.docId === document.docId ? asking : null;
          return (
            <div key={document.docId} className="deleted-documents__entry">
              <div className="trusted-workspace__document">
                <div className="trusted-workspace__document-main">
                  <span className="trusted-workspace__document-title">{document.title}</span>
                  <span className="trusted-workspace__document-meta deleted-documents__kept">
                    {describeRetention(document, now)}
                  </span>
                </div>
                {canChange && !mine && (
                  <>
                    <Button
                      variant="secondary"
                      size="sm"
                      icon={<RotateCcw size={12} />}
                      className="deleted-documents__restore"
                      disabled={busy}
                      onClick={() =>
                        void act(async () => {
                          await client.restoreDocument(document.docId);
                          onRestored(document.docId);
                        })
                      }
                    >
                      Restore
                    </Button>
                    {isAdmin &&
                      (document.legalHold ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          icon={<Unlock size={12} />}
                          className="deleted-documents__release"
                          disabled={busy}
                          onClick={() =>
                            void act(() => client.releaseHold(document.docId).then(() => {}))
                          }
                        >
                          Release hold
                        </Button>
                      ) : (
                        <>
                          <Button
                            variant="ghost"
                            size="sm"
                            icon={<Lock size={12} />}
                            className="deleted-documents__hold"
                            disabled={busy}
                            onClick={() =>
                              setAsking({ docId: document.docId, kind: 'hold', reason: '' })
                            }
                          >
                            Hold
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            iconOnly
                            icon={<Trash2 size={12} />}
                            className="deleted-documents__purge"
                            aria-label={`Remove ${document.title} for good`}
                            title={`Remove ${document.title} for good`}
                            disabled={busy}
                            onClick={() => setAsking({ docId: document.docId, kind: 'purge' })}
                          />
                        </>
                      ))}
                  </>
                )}
              </div>

              {mine?.kind === 'purge' && (
                <div className="workspace-access__confirm" role="alertdialog" aria-label="Confirm">
                  <span>
                    Remove <strong>{document.title}</strong> for good? It cannot be restored
                    afterwards, by anyone.
                  </span>
                  <Button
                    variant="danger-outline"
                    size="sm"
                    className="deleted-documents__purge-yes"
                    disabled={busy}
                    onClick={() => void act(() => client.purgeDocument(document.docId))}
                  >
                    Remove for good
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setAsking(null)}>
                    Cancel
                  </Button>
                </div>
              )}

              {mine?.kind === 'hold' && (
                <form
                  className="trusted-workspace__row"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void act(() => client.placeHold(document.docId, mine.reason).then(() => {}));
                  }}
                >
                  <label htmlFor={`hold-reason-${document.docId}`}>Reason for the hold</label>
                  <input
                    id={`hold-reason-${document.docId}`}
                    className="trusted-workspace__input"
                    value={mine.reason}
                    maxLength={500}
                    autoFocus
                    onChange={(e) => setAsking({ ...mine, reason: e.target.value })}
                  />
                  <Button
                    type="submit"
                    variant="primary"
                    size="sm"
                    disabled={busy || mine.reason.trim() === ''}
                  >
                    Place hold
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setAsking(null)}>
                    Cancel
                  </Button>
                </form>
              )}
            </div>
          );
        })
      )}
      <p className="trusted-workspace__status">
        {isAdmin
          ? 'A hold keeps a document past its retention until you release it. The reason is recorded in the audit log.'
          : 'Only a store administrator can remove a document before its time, or keep one longer.'}
      </p>
    </div>
  );
}
