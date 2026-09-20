/**
 * Title and scenarios, stored in the document (WS1-R7, WS3-R1).
 *
 * Both lived in React state until now, which had three consequences once the
 * document became the only model:
 *
 *  - they were the only content `useUndoableState` still tracked, so it could
 *    not be deleted (WS3-R1);
 *  - a peer who joined a session saw their OWN title and scenarios, never the
 *    session's;
 *  - they persisted only through the localStorage autosave, not with the
 *    document in IndexedDB.
 *
 * Title is one key, so concurrent renames resolve last-writer-wins, which is
 * what a single text field should do.
 *
 * Scenarios are stored as ONE plain JSON value rather than as nested shared
 * types. Two peers editing different scenarios at the same moment therefore
 * resolve last-writer-wins for the whole list. That is a deliberate first step:
 * scenarios were not collaborative at all before, the list is small, and
 * modelling steps as shared types is a schema decision worth making on its
 * own. Every write replaces the value atomically, so a peer never observes a
 * half-applied list.
 */
import * as Y from 'yjs';
import type { Scenario } from '../domain/types.ts';

export const META_MAP = 'meta';
const TITLE = 'title';
const SCENARIOS = 'scenarios';

export const DEFAULT_DOCUMENT_TITLE = 'Untitled Diagram';

export interface DocumentMeta {
  title: string;
  scenarios: Scenario[];
}

export interface DocumentMetaStore {
  getSnapshot(): DocumentMeta;
  subscribe(listener: () => void): () => void;
  setTitle(title: string): void;
  setScenarios(scenarios: Scenario[]): void;
  destroy(): void;
}

const EMPTY_SCENARIOS: Scenario[] = [];

export function createYjsDocumentMetaStore(doc: Y.Doc): DocumentMetaStore {
  // Concrete type, never bare doc.get() - see undoManager.ts on placeholders.
  const meta = doc.getMap<unknown>(META_MAP);
  const listeners = new Set<() => void>();
  let cached: DocumentMeta | null = null;

  const onChange = () => {
    // Snapshot identity drives rendering downstream, so it only changes when
    // the map does.
    cached = null;
    for (const listener of listeners) listener();
  };
  meta.observe(onChange);

  const read = (): DocumentMeta => {
    const title = meta.get(TITLE);
    const scenarios = meta.get(SCENARIOS);
    return {
      title: typeof title === 'string' ? title : DEFAULT_DOCUMENT_TITLE,
      scenarios: Array.isArray(scenarios) ? (scenarios as Scenario[]) : EMPTY_SCENARIOS,
    };
  };

  let destroyed = false;
  return {
    getSnapshot: () => (cached ??= read()),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setTitle(title) {
      if (meta.get(TITLE) === title) return;
      doc.transact(() => meta.set(TITLE, title));
    },
    setScenarios(scenarios) {
      doc.transact(() => meta.set(SCENARIOS, scenarios));
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      meta.unobserve(onChange);
      listeners.clear();
    },
  };
}

/**
 * Fills in whichever of title and scenarios the document does not have yet.
 *
 * Per key rather than all-or-nothing, and safe against a populated document
 * (WS1-R6). That matters for documents persisted before this store existed:
 * they reopen with content but no meta, and are not "empty", so the normal
 * seed never runs for them - without this they would lose their title.
 */
export function seedYjsDocumentMeta(doc: Y.Doc, initial: Partial<DocumentMeta>): void {
  const meta = doc.getMap<unknown>(META_MAP);
  const needsTitle = !meta.has(TITLE) && initial.title !== undefined;
  const needsScenarios = !meta.has(SCENARIOS) && initial.scenarios !== undefined;
  if (!needsTitle && !needsScenarios) return;
  doc.transact(() => {
    if (needsTitle) meta.set(TITLE, initial.title);
    if (needsScenarios) meta.set(SCENARIOS, initial.scenarios);
  });
}
