/**
 * Document rebase (WS4-R6, WS4-R7, WS4-R8).
 *
 * Even correct editing accumulates history. Every overwrite leaves its
 * predecessor behind as a tombstone, and Yjs's garbage collection reclaims the
 * CONTENT of a deleted item but not the clock range it occupied. WS4-R1 stops
 * the pathological case - drag frames - but a long-lived document still grows.
 *
 * A rebase is the only way to reclaim it: build a fresh Y.Doc from the current
 * VALUES and discard the old one along with its entire history.
 *
 * The cost is that this is not a background operation. The new document shares
 * no history with the old, so:
 *   - anyone still holding the old document cannot sync with the new one;
 *   - every stored update for the old document becomes dead weight;
 *   - a client that was offline across the rebase would have its work orphaned.
 *
 * That last one is why WS4-R8 bounds this by the reconciliation window and why
 * it is never triggered automatically on a size threshold. Compaction - which
 * preserves document identity and is safe to automate - is a different
 * operation and deliberately not this one.
 */
import * as Y from "yjs";
import type { SubDiagram } from "../domain/types";
import type { Milestone } from "../domain/milestones";
import type { ProgramIncrement } from "../domain/programIncrements";
import type { RequirementsDocument } from "../domain/requirementsTypes";
import type { TeamDocument } from "../domain/teamTypes";
import { seedYjsDiagramDoc, createYjsDiagramStore } from "./yjsDiagramStore.ts";
import {
  seedYjsMilestonesDoc,
  createYjsMilestonesStore,
} from "./yjsMilestonesStore.ts";
import {
  seedYjsProgramIncrementsDoc,
  createYjsProgramIncrementsStore,
} from "./yjsProgramIncrementsStore.ts";
import {
  seedYjsRequirementsDoc,
  createYjsRequirementsStore,
} from "./yjsRequirementsStore.ts";
import { createYjsTeamStore } from "./yjsTeamStore.ts";
import { seedTeamStore } from "./teamStore.ts";
import { unflattenToSubDiagram } from "./diagramStore.ts";

export interface DocumentContents {
  root: SubDiagram;
  requirements: RequirementsDocument;
  programIncrements: ProgramIncrement[];
  team: TeamDocument;
  milestones: Milestone[];
}

/** Reads every collection as plain values, with no CRDT metadata attached. */
export function readDocumentContents(doc: Y.Doc): DocumentContents {
  const snapshot = createYjsDiagramStore(doc).getSnapshot();
  return {
    root: unflattenToSubDiagram(snapshot.nodes, snapshot.edges),
    requirements: createYjsRequirementsStore(doc).getSnapshot(),
    programIncrements: createYjsProgramIncrementsStore(doc).getSnapshot(),
    team: createYjsTeamStore(doc).getSnapshot(),
    milestones: createYjsMilestonesStore(doc).getSnapshot(),
  };
}

export interface RebaseResult {
  doc: Y.Doc;
  /** Encoded size before and after, so callers can report what was reclaimed
   * and so the perf harness can assert the reclamation actually happened. */
  bytesBefore: number;
  bytesAfter: number;
}

/**
 * Builds a fresh document holding the same values and none of the history.
 *
 * Does not touch the original: the caller decides when to swap, and keeping
 * the old document intact until that point means a failure part-way through
 * leaves the user with the document they had rather than neither.
 */
export function rebaseDocument(source: Y.Doc): RebaseResult {
  const contents = readDocumentContents(source);
  const bytesBefore = Y.encodeStateAsUpdate(source).byteLength;

  const doc = new Y.Doc();
  // Order matches the session bootstrap so the fresh document is byte-shaped
  // the same way a newly seeded one would be.
  seedYjsRequirementsDoc(doc, contents.requirements);
  seedYjsProgramIncrementsDoc(doc, contents.programIncrements);
  seedYjsDiagramDoc(doc, contents.root);
  seedYjsMilestonesDoc(doc, contents.milestones);
  seedTeamStore(createYjsTeamStore(doc), contents.team);

  return {
    doc,
    bytesBefore,
    bytesAfter: Y.encodeStateAsUpdate(doc).byteLength,
  };
}

export interface RebaseEligibility {
  allowed: boolean;
  reason?: string;
}

/**
 * WS4-R8. Rebase is blocked while anyone might still hold the old document.
 *
 * `lastSyncedAt` is the most recent time each known client synced. A client
 * inside the reconciliation window may be offline rather than gone, and
 * rebasing would orphan whatever they have done since - the exact data loss
 * this programme exists to prevent.
 */
export function canRebase(options: {
  connectedPeerCount: number;
  lastSyncedAt: number[];
  reconciliationWindowMs: number;
  now?: number;
}): RebaseEligibility {
  if (options.connectedPeerCount > 0) {
    return {
      allowed: false,
      reason:
        `${options.connectedPeerCount} other ${options.connectedPeerCount === 1 ? "person is" : "people are"} ` +
        `in this session. Rebasing would disconnect them from the document.`,
    };
  }

  const now = options.now ?? Date.now();
  const recent = options.lastSyncedAt.filter(
    (at) => now - at < options.reconciliationWindowMs
  );
  if (recent.length > 0) {
    const days = Math.ceil(options.reconciliationWindowMs / 86_400_000);
    return {
      allowed: false,
      reason:
        `${recent.length} ${recent.length === 1 ? "device has" : "devices have"} synced within the last ` +
        `${days} days and may hold unsynced work. Rebasing would orphan it.`,
    };
  }

  return { allowed: true };
}
