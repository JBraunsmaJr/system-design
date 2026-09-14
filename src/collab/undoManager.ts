/**
 * Undo/redo backed by Y.UndoManager (WS3-R1, WS3-R2, WS3-R3, WS3-R4).
 *
 * Replaces the snapshot-stack approach, which could not work during a session:
 * remote edits arrive as Yjs updates rather than as local state transitions, so
 * the app's own history was simply frozen while collaborating. From the user's
 * side that meant Ctrl+Z silently did nothing - the worst kind of failure,
 * since there is no error to notice and no reason to stop trying.
 *
 * The mechanism that makes this work is origin scoping. Every local edit is
 * tagged with a single origin object, and the UndoManager is told to track only
 * that origin. Remote peers' updates carry their own origins, so they are never
 * candidates for this user's undo. Without this, pressing undo could revert a
 * collaborator's work, which is worse than undo not working at all.
 *
 * Because tracking is by origin rather than by transport, the same code runs
 * whether or not a session is active: solo editing is simply the case where no
 * other origin ever appears.
 */
import * as Y from "yjs";

/**
 * Root collections the UndoManager watches, split by concrete type.
 *
 * The split is not cosmetic. `doc.get(name)` without a type constructor
 * returns a placeholder, and Yjs REPLACES that placeholder with a real
 * instance the first time the collection is accessed as a concrete type. A
 * scope built from placeholders therefore holds objects that are no longer the
 * live shared types, and the UndoManager silently tracks nothing.
 *
 * That failure is invisible on a document this browser seeded - seeding calls
 * getArray/getMap first, so the concrete types already exist. It appears only
 * on a document populated purely by incoming updates, which is exactly the
 * case of a peer who joined a session. Undo then works for whoever started the
 * session and does nothing for everyone else.
 *
 * A collection omitted here is simply not undoable, so this list is kept in
 * step with the seeds it mirrors.
 */
const TRACKED_ARRAYS = [
  "nodeOrder",
  "edgeOrder",
  "itemTypeOrder",
  "categoryOrder",
  "itemOrder",
  "piOrder",
  "milestoneOrder",
  "memberOrder",
] as const;

const TRACKED_MAPS = [
  "nodes",
  "edges",
  "itemTypes",
  "categories",
  "items",
  "relationshipTypes",
  "relationships",
  "nextSequence",
  "pis",
  "milestones",
  "members",
  "extraDaysOff",
  "settings",
] as const;

export interface UndoController {
  /** The origin every local edit must be made under to be undoable. */
  readonly origin: object;
  /** Runs `fn` in a transaction tagged with the local origin. All local
   * mutations must go through this, or they will not be undoable. */
  transact(fn: () => void): void;
  undo(): void;
  redo(): void;
  canUndo(): boolean;
  canRedo(): boolean;
  /** Fires whenever undo/redo availability changes, so a toolbar can enable
   * and disable without polling. Returns an unsubscribe function. */
  subscribe(listener: () => void): () => void;
  /** WS3-R4: clears history at a document boundary, so undo cannot cross from
   * one document into another's past. */
  clear(): void;
  destroy(): void;
}

export interface UndoControllerOptions {
  /**
   * Edits closer together than this collapse into one undo entry
   * (WS3-R3). Matches the 500ms debounce the previous implementation used,
   * so a single drag still takes one press to reverse rather than dozens.
   */
  captureTimeout?: number;
  /** Overridable for tests that need to observe collapsing precisely. */
  trackedOrigins?: Set<unknown>;
}

export function createUndoController(
  doc: Y.Doc,
  options: UndoControllerOptions = {},
): UndoController {
  // A plain object as a sentinel: identity is what matters, and a unique
  // object per controller means two controllers on one doc (which should not
  // happen, but is cheap to be safe about) cannot undo each other's work.
  const origin = { local: true };

  // Accessed as concrete types so the scope holds the live shared types rather
  // than placeholders - see the comment on TRACKED_ARRAYS.
  const scope: Y.AbstractType<unknown>[] = [
    ...TRACKED_ARRAYS.map((name) => doc.getArray(name) as Y.AbstractType<unknown>),
    ...TRACKED_MAPS.map((name) => doc.getMap(name) as Y.AbstractType<unknown>),
  ];

  const manager = new Y.UndoManager(scope, {
    captureTimeout: options.captureTimeout ?? 500,
    trackedOrigins: options.trackedOrigins ?? new Set([origin]),
  });

  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };

  manager.on("stack-item-added", notify);
  manager.on("stack-item-popped", notify);
  manager.on("stack-cleared", notify);

  return {
    origin,
    transact(fn) {
      doc.transact(fn, origin);
    },
    undo() {
      manager.undo();
    },
    redo() {
      manager.redo();
    },
    canUndo: () => manager.undoStack.length > 0,
    canRedo: () => manager.redoStack.length > 0,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    clear() {
      manager.clear();
      notify();
    },
    destroy() {
      manager.off("stack-item-added", notify);
      manager.off("stack-item-popped", notify);
      manager.off("stack-cleared", notify);
      listeners.clear();
      manager.destroy();
    },
  };
}
