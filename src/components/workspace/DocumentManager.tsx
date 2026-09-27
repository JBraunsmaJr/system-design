import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  Copy,
  FileText,
  FolderOpen,
  Minimize2,
  Pencil,
  Plus,
  RefreshCcw,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import type { DocumentIndexEntry, StorageHealth } from '../../domain/storage/documentStore';
import { requestPersistentStorage } from '../../domain/storage/documentStore';
import type { DocumentLibrary } from '../../collab/sync/documentLibrary';
import { TIMED_COPY_INTERVALS, type TimedCopiesSettings } from '../../domain/storage/timedCopies';
import { BaseModal } from '../../common/components/modal/BaseModal';
import { Button } from '../../common/components/button/Button';

interface DocumentManagerProps {
  isOpen: boolean;
  onClose: () => void;
  library: DocumentLibrary;
  /** The document open in this tab. It can be renamed here but not
   * forgotten - its database is in use. */
  currentDocId: string;
  /** Renames the open document through its live store, so the change is part
   * of the document (and undoable) rather than only in the list. */
  onRenameCurrent: (title: string) => void;
  onOpenDocument: (docId: string) => void;
  onNewDocument: () => void;
  /** The workspace section, where a store is configured (WS9-R4). */
  workspace?: ReactNode;
  /** WS13-R6: timed downloads, a browser-wide preference. */
  timedCopies?: TimedCopiesSettings;
  onTimedCopiesChange?: (next: TimedCopiesSettings) => void;
}

function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined) return 'unknown';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatWhen(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? 'unknown' : date.toLocaleString();
}

/**
 * Every document stored in this browser (WS2-R3), how much space they use and
 * whether the browser may evict them (WS2-R5), and the irreversible "forget"
 * action (WS2-R6) - deliberately separate from leaving a session, which never
 * deletes anything.
 */
export function DocumentManager({
  isOpen,
  onClose,
  library,
  currentDocId,
  onRenameCurrent,
  onOpenDocument,
  onNewDocument,
  workspace,
  timedCopies,
  onTimedCopiesChange,
}: DocumentManagerProps) {
  const [entries, setEntries] = useState<DocumentIndexEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [health, setHealth] = useState<StorageHealth | null>(null);
  const [renaming, setRenaming] = useState<{ docId: string; title: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const listed = await library.list();
    if (listed.ok) {
      setEntries(listed.value);
      setError(null);
    } else {
      setError(listed.message);
    }
    setHealth(await requestPersistentStorage());
  }, [library]);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    void (async () => {
      const listed = await library.list();
      const storage = await requestPersistentStorage();
      if (cancelled) return;
      if (listed.ok) setEntries(listed.value);
      else setError(listed.message);
      setHealth(storage);
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen, library]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  const run = useCallback(
    async (work: () => Promise<void>) => {
      setBusy(true);
      setNotice(null);
      try {
        await work();
      } finally {
        setBusy(false);
        await refresh();
      }
    },
    [refresh],
  );

  const commitRename = useCallback(
    (entry: DocumentIndexEntry) => {
      if (!renaming) return;
      const title = renaming.title.trim();
      setRenaming(null);
      if (!title || title === entry.title) return;
      if (entry.docId === currentDocId) {
        onRenameCurrent(title);
        // The open document saves itself a moment later; show it now.
        setEntries(
          (prev) => prev?.map((e) => (e.docId === entry.docId ? { ...e, title } : e)) ?? prev,
        );
        return;
      }
      void run(async () => {
        const result = await library.rename(entry, title);
        if (!result.ok) setError(result.message);
      });
    },
    [renaming, currentDocId, onRenameCurrent, library, run],
  );

  const duplicate = useCallback(
    (entry: DocumentIndexEntry, thenOpen: boolean) =>
      run(async () => {
        const result = await library.duplicate(entry);
        if (!result.ok) {
          setError(result.message);
          return;
        }
        if (thenOpen) onOpenDocument(result.value.docId);
        else setNotice(`Created "${result.value.title}".`);
      }),
    [library, run, onOpenDocument],
  );

  const forget = useCallback(
    (entry: DocumentIndexEntry) => {
      const ok = window.confirm(
        `Forget "${entry.title}"?\n\n` +
          `This permanently deletes it from this browser - its content and its saved copy. ` +
          `It cannot be undone.\n\n` +
          `Export it to a file first if you might need it again.`,
      );
      if (!ok) return;
      void run(async () => {
        const result = await library.forget(entry);
        if (!result.ok) setError(result.message);
        else if (result.value === 'blocked') {
          setNotice(
            `"${entry.title}" is no longer listed. It is still open in another tab; its content is removed once that tab is closed.`,
          );
        } else {
          setNotice(`"${entry.title}" was forgotten.`);
        }
      });
    },
    [library, run],
  );

  /** WS4-R7: safe at any time, so no confirmation. */
  const compact = useCallback(
    (entry: DocumentIndexEntry) =>
      run(async () => {
        const result = await library.compact(entry);
        if (!result.ok) setError(result.message);
        else
          setNotice(
            result.value.updatesBefore > 1
              ? `Compacted "${entry.title}": ${result.value.updatesBefore} stored updates became 1.`
              : `"${entry.title}" is already compact.`,
          );
      }),
    [library, run],
  );

  /**
   * WS4-R6 / R8: always asked first. Inside the reconciliation window the
   * question says why it is blocked and what forcing it would do.
   */
  const rebase = useCallback(
    (entry: DocumentIndexEntry) => {
      const eligibility = library.rebaseEligibility(entry);
      const question = eligibility.allowed
        ? `Rebase "${entry.title}"?\n\n` +
          `This creates a new, smaller document with the same content and no editing history, and opens it. ` +
          `The original is kept as "${entry.title} (before rebase)".`
        : `Rebasing "${entry.title}" is blocked: ${eligibility.reason}\n\n` +
          `Forcing it creates a new document with no shared history. Anyone who still has the old one ` +
          `cannot sync into the new one, and changes they have not shared stay in the old document only. ` +
          `The original is kept here as "${entry.title} (before rebase)".\n\n` +
          `Rebase anyway?`;
      if (!window.confirm(question)) return;
      void run(async () => {
        const result = await library.rebase(entry);
        if (!result.ok) {
          setError(result.message);
          return;
        }
        const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`;
        setNotice(
          `Rebased "${entry.title}": ${kb(result.value.bytesBefore)} became ${kb(result.value.bytesAfter)}.`,
        );
        if (entry.docId === currentDocId) onOpenDocument(result.value.entry.docId);
      });
    },
    [library, run, currentDocId, onOpenDocument],
  );

  if (!isOpen) return null;

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      className="document-manager"
      ariaLabel="Documents"
      width={760}
      maxWidth="95vw"
      padding={0}
      style={{
        maxHeight: '85vh',
        background: 'var(--chrome-bg-raised, #1e222b)',
        color: 'var(--chrome-text, #e7e9ee)',
        border: '1px solid var(--chrome-border, #2d3342)',
      }}
    >
      <div className="document-manager__header">
        <div className="document-manager__title-wrap">
          <FileText size={18} style={{ color: 'var(--accent, #5B7CFA)' }} />
          <strong>Documents in this browser</strong>
        </div>
        <div className="document-manager__header-actions">
          <Button
            variant="primary"
            size="sm"
            className="document-manager__new"
            onClick={onNewDocument}
            disabled={busy}
            icon={<Plus size={14} />}
          >
            New document
          </Button>
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            aria-label="Close"
            onClick={onClose}
            icon={<X size={16} />}
          />
        </div>
      </div>

      <div className="document-manager__storage">
        {health ? (
          <>
            Using {formatBytes(health.usageBytes)} of {formatBytes(health.quotaBytes)} available.{' '}
            {health.persisted ? (
              <span className="document-manager__persisted">
                The browser will keep this storage.
              </span>
            ) : (
              <span
                className="document-manager__not-persisted"
                style={{ color: 'var(--warning, #e0a84a)' }}
              >
                The browser may clear this storage when space runs low. Export anything important.
              </span>
            )}
          </>
        ) : (
          'Checking storage...'
        )}
      </div>

      {workspace}

      {timedCopies && onTimedCopiesChange && (
        <div className="document-manager__timed-copies">
          <div className="document-manager__timed-copies-row">
            <strong>Timed copies</strong>
            <span className="document-manager__timed-copies-state">
              {timedCopies.enabled ? 'On' : 'Off'}
            </span>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              every
              <select
                aria-label="Minutes between copies"
                value={timedCopies.minutes}
                onChange={(e) =>
                  onTimedCopiesChange({ ...timedCopies, minutes: Number(e.target.value) })
                }
              >
                {(TIMED_COPY_INTERVALS as readonly number[]).includes(
                  timedCopies.minutes,
                ) ? null : (
                  <option value={timedCopies.minutes}>{timedCopies.minutes}</option>
                )}
                {TIMED_COPY_INTERVALS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
              minutes
            </label>
            <Button
              variant="secondary"
              size="sm"
              className="document-manager__timed-copies-toggle"
              onClick={() => onTimedCopiesChange({ ...timedCopies, enabled: !timedCopies.enabled })}
            >
              {timedCopies.enabled ? 'Turn off' : 'Turn on'}
            </Button>
          </div>
          <p className="document-manager__timed-copies-explain">
            When on, this browser downloads a copy of the open document at that interval, but only
            if it changed since the last copy. Copies go to your download folder with the date and
            time in the name. If your browser asks where to save each download, set it to save
            downloads automatically, or it will ask every time.
          </p>
        </div>
      )}

      {error && (
        <div role="alert" className="document-manager__error">
          {error}
        </div>
      )}
      {notice && (
        <div role="status" className="document-manager__notice">
          {notice}
        </div>
      )}

      <div className="document-manager__list">
        {entries === null ? (
          <div style={{ padding: 12 }}>Loading...</div>
        ) : entries.length === 0 ? (
          <div style={{ padding: 12 }}>No stored documents yet.</div>
        ) : (
          entries.map((entry) => {
            const isCurrent = entry.docId === currentDocId;
            const fromSession = entry.origin === 'session' && !!entry.sessionRoom;
            const isRenaming = renaming?.docId === entry.docId;
            return (
              <div
                key={entry.docId}
                className={`document-manager__row ${isCurrent ? 'is-current' : ''}`}
                data-doc-id={entry.docId}
              >
                <div className="document-manager__doc-info">
                  {isRenaming ? (
                    <input
                      className="document-manager__rename-input"
                      aria-label={`New name for ${entry.title}`}
                      autoFocus
                      value={renaming.title}
                      onChange={(e) => setRenaming({ docId: entry.docId, title: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitRename(entry);
                        if (e.key === 'Escape') {
                          e.stopPropagation();
                          setRenaming(null);
                        }
                      }}
                      onBlur={() => commitRename(entry)}
                    />
                  ) : (
                    <div className="document-manager__title">{entry.title}</div>
                  )}
                  <div className="document-manager__meta">
                    {isCurrent && (
                      <span className="document-manager__current">Open in this tab</span>
                    )}
                    {fromSession && (
                      <span
                        className="document-manager__session"
                        title="Shared in a session. Open it to resume hosting that session, so others can rejoin with the original link."
                      >
                        <Users size={10} /> From a session
                      </span>
                    )}
                    <span>Saved {formatWhen(entry.updatedAt)}</span>
                    <span>{formatBytes(entry.sizeBytes)}</span>
                  </div>
                </div>
                <div className="document-manager__actions">
                  <Button
                    variant="secondary"
                    size="sm"
                    className="document-manager__open"
                    disabled={isCurrent || busy}
                    onClick={() => onOpenDocument(entry.docId)}
                    aria-label={`Open ${entry.title}`}
                    icon={<FolderOpen size={14} />}
                  >
                    Open
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    iconOnly
                    className="document-manager__rename"
                    disabled={busy}
                    onClick={() => setRenaming({ docId: entry.docId, title: entry.title })}
                    aria-label={`Rename ${entry.title}`}
                    title="Rename"
                    icon={<Pencil size={14} />}
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    iconOnly
                    className="document-manager__duplicate"
                    disabled={busy}
                    onClick={() => void duplicate(entry, false)}
                    aria-label={`Duplicate ${entry.title}`}
                    title="Duplicate"
                    icon={<Copy size={14} />}
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    iconOnly
                    className="document-manager__compact"
                    disabled={busy}
                    onClick={() => void compact(entry)}
                    aria-label={`Compact ${entry.title}`}
                    title="Compact storage (safe at any time)"
                    icon={<Minimize2 size={14} />}
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    iconOnly
                    className="document-manager__rebase"
                    disabled={busy}
                    onClick={() => rebase(entry)}
                    aria-label={`Rebase ${entry.title}`}
                    title="Rebase - a new document without editing history"
                    icon={<RefreshCcw size={14} />}
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    iconOnly
                    className="document-manager__forget"
                    disabled={isCurrent || busy}
                    onClick={() => forget(entry)}
                    aria-label={`Forget ${entry.title}`}
                    title={
                      isCurrent
                        ? 'Open another document to forget this one'
                        : 'Forget - permanently delete from this browser'
                    }
                    icon={<Trash2 size={14} />}
                  />
                </div>
              </div>
            );
          })
        )}
      </div>
    </BaseModal>
  );
}
