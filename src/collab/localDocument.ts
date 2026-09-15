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
import { seedTeamStore } from "./teamStore.ts";
import { unflattenToSubDiagram } from "./diagramStore.ts";
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

  const stores: OpenDocumentStores = {
    diagram: createYjsDiagramStore(doc),
    requirements: createYjsRequirementsStore(doc),
    programIncrements: createYjsProgramIncrementsStore(doc),
    team: createYjsTeamStore(doc),
    milestones: createYjsMilestonesStore(doc),
  };

  if (wasSeeded && options.initial) {
    seedDocument(doc, options.initial, stores.team);
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
      for (const store of Object.values(stores)) store.destroy();
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
  // DiagramFile stores nodes FLAT with a parentPath; seedYjsDiagramDoc takes
  // the tree form and flattens it itself. Handing it the flat list would
  // re-flatten an already-flat structure and hoist every nested node to the
  // root, silently collapsing the sub-diagram hierarchy.
  seedYjsDiagramDoc(doc, unflattenToSubDiagram(file.nodes, file.edges));
  seedYjsMilestonesDoc(doc, file.milestones ?? []);
  if (file.team) seedTeamStore(teamStore, file.team);
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
    for (const name of ["itemTypes", "categories", "items", "relationshipTypes", "relationships", "nextSequence", "pis", "milestones", "members", "extraDaysOff"]) {
      doc.getMap(name).clear();
    }
  });
  seedDocument(doc, file);
}

