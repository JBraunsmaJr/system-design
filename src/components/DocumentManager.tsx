import { useCallback, useEffect, useState } from "react";
import { Copy, FileText, FolderOpen, Pencil, Plus, Trash2, Users, X } from "lucide-react";
import type { DocumentIndexEntry, StorageHealth } from "../domain/documentStore";
import { requestPersistentStorage } from "../domain/documentStore";
import { isLocallyOpenable, type DocumentLibrary } from "../collab/documentLibrary";

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
}

function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined) return "unknown";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatWhen(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "unknown" : date.toLocaleString();
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
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
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
    [refresh]
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
        setEntries((prev) => prev?.map((e) => (e.docId === entry.docId ? { ...e, title } : e)) ?? prev);
        return;
      }
      void run(async () => {
        const result = await library.rename(entry, title);
        if (!result.ok) setError(result.message);
      });
    },
    [renaming, currentDocId, onRenameCurrent, library, run]
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
    [library, run, onOpenDocument]
  );

  const forget = useCallback(
    (entry: DocumentIndexEntry) => {
      const ok = window.confirm(
        `Forget "${entry.title}"?\n\n` +
          `This permanently deletes it from this browser - its content and its saved copy. ` +
          `It cannot be undone.\n\n` +
          `Export it to a file first if you might need it again.`
      );
      if (!ok) return;
      void run(async () => {
        const result = await library.forget(entry);
        if (!result.ok) setError(result.message);
        else if (result.value === "blocked") {
          setNotice(
            `"${entry.title}" is no longer listed. It is still open in another tab; its content is removed once that tab is closed.`
          );
        } else {
          setNotice(`"${entry.title}" was forgotten.`);
        }
      });
    },
    [library, run]
  );

  if (!isOpen) return null;

  return (
    <div
      className="modal-overlay"
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="modal-content document-manager"
        role="dialog"
        aria-modal="true"
        aria-label="Documents"
        style={{
          background: "var(--bg-panel, #1e222b)",
          color: "var(--text, #e7e9ee)",
          borderRadius: 8,
          width: 760,
          maxWidth: "95vw",
          maxHeight: "85vh",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 10px 30px rgba(0,0,0,0.5)",
          border: "1px solid var(--border, #2d3342)",
          overflow: "hidden",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 18px", borderBottom: "1px solid var(--border, #2d3342)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <FileText size={18} style={{ color: "var(--accent, #5B7CFA)" }} />
            <strong>Documents in this browser</strong>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" className="primary document-manager__new" onClick={onNewDocument} disabled={busy}>
              <Plus size={14} /> New document
            </button>
            <button type="button" aria-label="Close" onClick={onClose}>
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="document-manager__storage" style={{ padding: "8px 18px", fontSize: 12, color: "var(--text-muted, #9aa3b2)", borderBottom: "1px solid var(--border, #2d3342)" }}>
          {health ? (
            <>
              Using {formatBytes(health.usageBytes)} of {formatBytes(health.quotaBytes)} available.{" "}
              {health.persisted ? (
                <span className="document-manager__persisted">The browser will keep this storage.</span>
              ) : (
                <span className="document-manager__not-persisted" style={{ color: "var(--warning, #e0a84a)" }}>
                  The browser may clear this storage when space runs low. Export anything important.
                </span>
              )}
            </>
          ) : (
            "Checking storage..."
          )}
        </div>

        {error && (
          <div role="alert" style={{ padding: "8px 18px", color: "var(--danger, #e5534b)", fontSize: 13 }}>
            {error}
          </div>
        )}
        {notice && (
          <div role="status" className="document-manager__notice" style={{ padding: "8px 18px", fontSize: 13 }}>
            {notice}
          </div>
        )}

        <div style={{ overflowY: "auto", padding: "6px 10px 12px" }}>
          {entries === null ? (
            <div style={{ padding: 12 }}>Loading...</div>
          ) : entries.length === 0 ? (
            <div style={{ padding: 12 }}>No stored documents yet.</div>
          ) : (
            entries.map((entry) => {
              const isCurrent = entry.docId === currentDocId;
              const openable = isLocallyOpenable(entry);
              const isRenaming = renaming?.docId === entry.docId;
              return (
                <div
                  key={entry.docId}
                  className="document-manager__row"
                  data-doc-id={entry.docId}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "8px",
                    borderRadius: 6,
                    background: isCurrent ? "var(--bg-active, #313848)" : "transparent",
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {isRenaming ? (
                      <input
                        className="document-manager__rename-input"
                        aria-label={`New name for ${entry.title}`}
                        autoFocus
                        value={renaming.title}
                        onChange={(e) => setRenaming({ docId: entry.docId, title: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") commitRename(entry);
                          if (e.key === "Escape") {
                            e.stopPropagation();
                            setRenaming(null);
                          }
                        }}
                        onBlur={() => commitRename(entry)}
                        style={{ width: "100%" }}
                      />
                    ) : (
                      <div className="document-manager__title" style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {entry.title}
                      </div>
                    )}
                    <div style={{ fontSize: 11, color: "var(--text-muted, #9aa3b2)", display: "flex", gap: 10, flexWrap: "wrap" }}>
                      {isCurrent && <span className="document-manager__current">Open in this tab</span>}
                      {!openable && (
                        <span title="A copy of a session you joined. Open a copy to edit it on its own.">
                          <Users size={10} /> Session copy
                        </span>
                      )}
                      <span>Saved {formatWhen(entry.updatedAt)}</span>
                      <span>{formatBytes(entry.sizeBytes)}</span>
                    </div>
                  </div>
                  {openable ? (
                    <button
                      type="button"
                      className="document-manager__open"
                      disabled={isCurrent || busy}
                      onClick={() => onOpenDocument(entry.docId)}
                      aria-label={`Open ${entry.title}`}
                    >
                      <FolderOpen size={14} /> Open
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="document-manager__open-copy"
                      disabled={busy}
                      onClick={() => void duplicate(entry, true)}
                      aria-label={`Open a copy of ${entry.title}`}
                    >
                      <FolderOpen size={14} /> Open a copy
                    </button>
                  )}
                  <button
                    type="button"
                    className="document-manager__rename"
                    disabled={busy}
                    onClick={() => setRenaming({ docId: entry.docId, title: entry.title })}
                    aria-label={`Rename ${entry.title}`}
                    title="Rename"
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    type="button"
                    className="document-manager__duplicate"
                    disabled={busy}
                    onClick={() => void duplicate(entry, false)}
                    aria-label={`Duplicate ${entry.title}`}
                    title="Duplicate"
                  >
                    <Copy size={14} />
                  </button>
                  <button
                    type="button"
                    className="document-manager__forget"
                    disabled={isCurrent || busy}
                    onClick={() => forget(entry)}
                    aria-label={`Forget ${entry.title}`}
                    title={isCurrent ? "Open another document to forget this one" : "Forget - permanently delete from this browser"}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
