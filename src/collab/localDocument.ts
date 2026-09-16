/**
 * Opening a document (WS1 Step 2).
 *
 * One bootstrap for every document the app opens, whether or not anyone is
 * collaborating on it. A document is always a `Y.Doc`; collaboration is a
 * provider attached to it later (Step 3), not a different kind of document.
 *
 * Ordering here is the whole point and is easy to get wrong:
 *
 *   1. create the doc
 *   2. attach persistence
 *   3. AWAIT whenSynced
 *   4. seed ONLY if the document is still empty
 *
 * Deciding to seed before persistence has replayed means seeding on top of
 * content that is about to arrive. The seeds are individually idempotent
 * (WS1-R6) so the damage is bounded, but relying on that is defence in depth,
 * not a design.
 */
import * as Y from "yjs";
import type { DiagramFile } from "../domain/serialization.ts";
import {
  attachPersistence,
  createNullPersistence,
  type DocPersistence,
} from "./persistence.ts";
import { isYjsDocEmpty } from "./seedGuards.ts";
import { seedYjsDiagramDoc, createYjsDiagramStore } from "./yjsDiagramStore.ts";
import {
  seedYjsRequirementsDoc,
  createYjsRequirementsStore,
} from "./yjsRequirementsStore.ts";
import {
  seedYjsProgramIncrementsDoc,
  createYjsProgramIncrementsStore,
} from "./yjsProgramIncrementsStore.ts";
import {
  seedYjsMilestonesDoc,
  createYjsMilestonesStore,
} from "./yjsMilestonesStore.ts";
import { createYjsTeamStore } from "./yjsTeamStore.ts";
import {
  createYjsDocumentMetaStore,
  seedYjsDocumentMeta,
  META_MAP,
  type DocumentMetaStore,
} from "./yjsDocumentMetaStore.ts";
import { seedTeamStore } from "./teamStore.ts";
import type { DiagramStore } from "./diagramStore.ts";
import type { RequirementsStore } from "./requirementsStore.ts";
import type { ProgramIncrementsStore } from "./programIncrementsStore.ts";
import type { TeamStore } from "./teamStore.ts";
import type { MilestonesStore } from "./milestonesStore.ts";

/** Namespaced apart from room keys so a document and a session can never
 * collide in IndexedDB, even if their identifiers happen to match. */
export function persistenceKeyForDocument(docId: string): string {
  return `system-design:doc:${docId}`;
}

export interface OpenDocumentStores {
  diagram: DiagramStore;
  requirements: RequirementsStore;
  programIncrements: ProgramIncrementsStore;
  team: TeamStore;
  milestones: MilestonesStore;
  /** Title and scenarios (WS1-R7). */
  meta: DocumentMetaStore;
}

/** Every store over `doc`. The single place the set is built, so a session and
 * a local document cannot end up with different ones. */
export function createDocumentStores(doc: Y.Doc): OpenDocumentStores {
  return {
    diagram: createYjsDiagramStore(doc),
    requirements: createYjsRequirementsStore(doc),
    programIncrements: createYjsProgramIncrementsStore(doc),
    team: createYjsTeamStore(doc),
    milestones: createYjsMilestonesStore(doc),
    meta: createYjsDocumentMetaStore(doc),
  };
}

/** Detaches every store in the set (WS1 Step 1). */
export function destroyDocumentStores(stores: OpenDocumentStores): void {
  for (const store of Object.values(stores)) store.destroy();
}

export interface OpenDocument {
  docId: string;
  doc: Y.Doc;
  stores: OpenDocumentStores;
  persistence: DocPersistence;
  /** True when this call seeded the document, false when persistence restored
   * it. Callers use this to distinguish "new document" from "reopened". */
  wasSeeded: boolean;
  /**
   * Releases everything this document holds: store observers first, then
   * persistence. Does NOT delete stored data - that is `persistence.forget()`,
   * and keeping them separate is what stops closing a document from
   * discarding it (WS2-R6).
   */
  close(): Promise<void>;
}

export interface OpenDocumentOptions {
  docId: string;
  /** Content to seed with when the document turns out to be empty. Omit to
   * open whatever is stored and nothing more. */
  initial?: DiagramFile;
  /** Off for tests and the perf harness, which want a clean document every
   * run rather than whatever a previous run left behind. */
  persist?: boolean;
  /** Injectable so tests can supply a provider without a real database. */
  createPersistence?: (doc: Y.Doc, key: string) => DocPersistence;
}

/**
 * Opens a document synchronously, with loading and seeding resolving after.
 *
 * `openDocument` below awaits persistence before it returns, which leaves a
 * window during which the app has no document and the seams need a fallback.
 * Keeping that fallback means keeping the adapter stores alive purely to cover
 * a few frames, and it means two code paths can render the canvas.
 *
 * The document and its stores exist immediately here; `ready` resolves once
 * persistence has replayed and the seed decision has been made. Consumers
 * subscribe to the stores as usual and simply see content appear - which is
 * what they already do for remote updates, so nothing downstream is special.
 */
export function openDocumentNow(options: OpenDocumentOptions): OpenDocument & {
  ready: Promise<void>;
} {
  const doc = new Y.Doc();
  const key = persistenceKeyForDocument(options.docId);

  const persistence =
    options.persist === false
      ? createNullPersistence(doc)
      : (options.createPersistence ?? ((d, k) => attachPersistence(d, k)))(
          doc,
          key
        );

  const stores = createDocumentStores(doc);

  const handle: OpenDocument & { ready: Promise<void> } = {
    docId: options.docId,
    doc,
    stores,
    persistence,
    // Not known yet; set when `ready` resolves. Callers that care must await.
    wasSeeded: false,
    ready: persistence.whenSynced.then(() => {
      if (isYjsDocEmpty(doc) && options.initial) {
        seedDocument(doc, options.initial, stores.team);
        handle.wasSeeded = true;
      } else if (options.initial) {
        seedMetaFrom(doc, options.initial);
      }
    }),
    async close() {
      destroyDocumentStores(stores);
      await persistence.destroy();
    },
  };
  return handle;
}

export async function openDocument(
  options: OpenDocumentOptions
): Promise<OpenDocument> {
  const doc = new Y.Doc();
  const key = persistenceKeyForDocument(options.docId);

  const persistence =
    options.persist === false
      ? createNullPersistence(doc)
      : (options.createPersistence ?? ((d, k) => attachPersistence(d, k)))(
          doc,
          key
        );

  await persistence.whenSynced;

  // Checked against the document rather than trusting wasEmptyOnLoad alone:
  // a caller may have handed us a doc that something else has already
  // touched, and the document itself is the only authority on whether it
  // holds content.
  const empty = isYjsDocEmpty(doc);
  const wasSeeded = empty && options.initial !== undefined;

  const stores = createDocumentStores(doc);

  if (wasSeeded && options.initial) {
    seedDocument(doc, options.initial, stores.team);
  } else if (options.initial) {
    seedMetaFrom(doc, options.initial);
  }

  return {
    docId: options.docId,
    doc,
    stores,
    persistence,
    wasSeeded,
    async close() {
      // Stores first: a store that is still observing while persistence tears
      // down would rebuild snapshots nobody is going to read.
      destroyDocumentStores(stores);
      await persistence.destroy();
    },
  };
}

/**
 * Populates an empty document from a file.
 *
 * Order matches the session bootstrap so a document seeded here is shaped the
 * same as one seeded there - which matters because Step 3 makes them the same
 * code path.
 */
export function seedDocument(
  doc: Y.Doc,
  file: DiagramFile,
  teamStore = createYjsTeamStore(doc)
): void {
  seedYjsRequirementsDoc(doc, file.requirements);
  seedYjsProgramIncrementsDoc(doc, file.programIncrements ?? []);
  // The import boundary (WS1-R3): the one place a file's diagram becomes the
  // canonical flat schema. DiagramFile holds the NESTED tree (`data.subDiagram`)
  // - see its own doc comment - and seedYjsDiagramDoc flattens it here.
  //
  // This used to unflatten first, on the belief that files were flat. Files
  // are not, so unflattening a nested file kept only root-level entries and
  // dropped every sub-diagram on load. Flattening is now idempotent, so a
  // caller holding an already-flat list is handled too.
  seedYjsDiagramDoc(doc, { nodes: file.nodes, edges: file.edges });
  seedYjsMilestonesDoc(doc, file.milestones ?? []);
  if (file.team) seedTeamStore(teamStore, file.team);
  seedMetaFrom(doc, file);
}

/**
 * Title and scenarios from a file, filling only what the document lacks.
 *
 * Also run against documents that were NOT seeded: one persisted before
 * title and scenarios moved into the document reopens populated but without
 * them, and the restored autosave is the only place they still exist.
 */
function seedMetaFrom(doc: Y.Doc, file: DiagramFile): void {
  seedYjsDocumentMeta(doc, {
    title: file.title,
    // Files saved before cross-diagram scenarios have no step paths.
    scenarios: (file.scenarios ?? []).map((sc) => ({
      ...sc,
      steps: sc.steps.map((st) => ({ ...st, path: st.path ?? [] })),
    })),
  });
}

/**
 * Replaces a document's contents wholesale, for loading a file into a document
 * that already holds something.
 *
 * Clearing and reseeding rather than merging: merging two unrelated documents
 * unions their contents, which is how a file load would silently end up with
 * both the old and new diagram in it.
 */
export function replaceDocumentContents(doc: Y.Doc, file: DiagramFile): void {
  doc.transact(() => {
    const store = createYjsDiagramStore(doc);
    const snapshot = store.getSnapshot();
    for (const node of snapshot.nodes) store.deleteNode(node.id);
    for (const edge of snapshot.edges) store.deleteEdge(edge.id);
    store.destroy();

    for (const name of ["itemTypeOrder", "categoryOrder", "itemOrder", "piOrder", "milestoneOrder", "memberOrder"]) {
      doc.getArray(name).delete(0, doc.getArray(name).length);
    }
    for (const name of ["itemTypes", "categories", "items", "relationshipTypes", "relationships", "nextSequence", "pis", "milestones", "members", "extraDaysOff", META_MAP]) {
      doc.getMap(name).clear();
    }
  });
  seedDocument(doc, file);
}

