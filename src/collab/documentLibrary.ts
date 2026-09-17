/**
 * Operations on stored documents other than the one being edited
 * (WS2-R3, WS2-R6).
 *
 * The document store keeps the index and a snapshot of each document; the
 * live content of a local document is its own y-indexeddb database
 * (`system-design:doc:<id>`), and a joined session's replica is keyed by room
 * (`system-design:room:<room>`). Every operation here keeps those in step:
 * renaming a closed document renames it inside its content too (or the next
 * save would put the old title back), and forgetting removes the content
 * database as well as the index entry.
 */
import * as Y from "yjs";
import type { DocumentIndexEntry, DocumentStore, StorageResult } from "../domain/documentStore.ts";
import { newDocumentId } from "../domain/documentStore.ts";
import { toDiagramFile, type DiagramFile } from "../domain/serialization.ts";
import { openDocument, persistenceKeyForDocument, type OpenDocument } from "./localDocument.ts";
import { persistenceKeyForRoom } from "./persistence.ts";
import { readDocumentContents } from "./rebase.ts";

export interface DocumentLibraryDeps {
  store: DocumentStore;
  /** Opens a stored local document. Injectable for tests. */
  open?: (docId: string, initial?: DiagramFile) => Promise<OpenDocument>;
  /** Deletes a whole IndexedDB database. Injectable for tests. */
  deleteDatabase?: (name: string) => Promise<DeleteOutcome>;
}

/** `blocked`: another tab still has the database open. The deletion completes
 * once that tab lets go, so the caller should say so rather than report
 * failure. */
export type DeleteOutcome = "deleted" | "blocked";

export interface DocumentLibrary {
  list(): Promise<StorageResult<DocumentIndexEntry[]>>;
  rename(entry: DocumentIndexEntry, title: string): Promise<StorageResult<DocumentIndexEntry>>;
  /** A new, independent local document with the same content. */
  duplicate(entry: DocumentIndexEntry): Promise<StorageResult<DocumentIndexEntry>>;
  /** WS2-R6: irreversible. Removes the index entry, the snapshot and the
   * content database. Never called for the document open in this tab. */
  forget(entry: DocumentIndexEntry): Promise<StorageResult<DeleteOutcome>>;
}

/** The content database a document's live replica is kept in. */
export function contentDatabaseFor(entry: Pick<DocumentIndexEntry, "docId" | "origin" | "sessionRoom">): string {
  // A joined session's replica is keyed by room. A local document that was
  // shared keeps its document key - origin "session" with a doc id that is
  // not a session id - so the id decides, not the origin alone.
  if (entry.origin === "session" && entry.docId.startsWith("session:") && entry.sessionRoom) {
    return persistenceKeyForRoom(entry.sessionRoom);
  }
  return persistenceKeyForDocument(entry.docId);
}

/** Whether an entry's live content can be opened as a local document. A
 * joined session's replica can only be copied: its content lives under the
 * room, and editing it outside the session would fork it silently. */
export function isLocallyOpenable(entry: Pick<DocumentIndexEntry, "docId" | "origin">): boolean {
  return !(entry.origin === "session" && entry.docId.startsWith("session:"));
}

function fileFromDoc(doc: Y.Doc): DiagramFile {
  const c = readDocumentContents(doc);
  return toDiagramFile(
    c.meta.title,
    c.root.nodes,
    c.root.edges,
    c.meta.scenarios,
    c.requirements,
    c.programIncrements,
    c.team,
    c.milestones,
  );
}

function defaultDeleteDatabase(name: string): Promise<DeleteOutcome> {
  return new Promise((resolve, reject) => {
    const request = globalThis.indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve("deleted");
    request.onerror = () => reject(request.error);
    // Another tab holds it open. The request stays queued and completes when
    // that tab closes; waiting here would hang the UI on the other tab.
    request.onblocked = () => resolve("blocked");
  });
}

const failed = <T,>(message: string): StorageResult<T> => ({ ok: false, reason: "unknown", message });

export function createDocumentLibrary(deps: DocumentLibraryDeps): DocumentLibrary {
  const { store } = deps;
  const open = deps.open ?? ((docId: string, initial?: DiagramFile) => openDocument({ docId, initial }));
  const deleteDatabase = deps.deleteDatabase ?? defaultDeleteDatabase;

  /** The content to copy or re-save: the live document where there is one,
   * the stored snapshot otherwise. */
  async function contentOf(entry: DocumentIndexEntry): Promise<StorageResult<DiagramFile>> {
    if (!isLocallyOpenable(entry)) return store.readDocument(entry.docId);
    const opened = await open(entry.docId);
    try {
      return { ok: true, value: fileFromDoc(opened.doc) };
    } finally {
      await opened.close();
    }
  }

  return {
    async list() {
      const listed = await store.listDocuments();
      if (!listed.ok) return listed;
      return { ok: true, value: [...listed.value].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) };
    },

    async rename(entry, title) {
      const trimmed = title.trim();
      if (!trimmed) return failed("A document needs a name.");
      if (isLocallyOpenable(entry)) {
        // Inside the content as well: the title lives in the document, and
        // the next save would otherwise restore the old one to the index.
        const opened = await open(entry.docId);
        try {
          opened.stores.meta.setTitle(trimmed);
          return await store.writeDocument(entry.docId, fileFromDoc(opened.doc));
        } finally {
          await opened.close();
        }
      }
      return store.renameDocument(entry.docId, trimmed);
    },

    async duplicate(entry) {
      const content = await contentOf(entry);
      if (!content.ok) return content;
      const copy: DiagramFile = { ...content.value, title: `Copy of ${content.value.title || "Untitled Diagram"}` };
      const docId = newDocumentId();
      // Seeded fresh rather than copied update-by-update: the copy is a new
      // document with its own history, not a fork that could merge back.
      const opened = await open(docId, copy);
      try {
        return await store.writeDocument(docId, fileFromDoc(opened.doc), { origin: "local" });
      } finally {
        await opened.close();
      }
    },

    async forget(entry) {
      const removed = await store.deleteDocument(entry.docId);
      if (!removed.ok) return removed;
      try {
        return { ok: true, value: await deleteDatabase(contentDatabaseFor(entry)) };
      } catch (error) {
        return failed(
          `"${entry.title}" was removed from the list, but its stored content could not be deleted: ${String(error)}`,
        );
      }
    },
  };
}
