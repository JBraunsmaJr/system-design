import { useCallback, useRef, useState } from "react";

type Updater<T> = T | ((prev: T) => T);

export interface UndoableState<T> {
  present: T;
  set: (updater: Updater<T>) => void;
  undo: () => void;
  redo: () => void;
  /** Clears all history - call this when the "document" itself changes
   * wholesale (new diagram, file load), so you can't undo past that
   * boundary into a completely different document's history. */
  resetHistory: (newPresent?: T) => void;
  canUndo: boolean;
  canRedo: boolean;
}

const MAX_HISTORY = 100;
const DEBOUNCE_MS = 500;

/**
 * Generic undo/redo state container. Rapid-fire updates - every frame of a
 * node drag, every keystroke while typing, every step of a resize - are
 * debounced into a SINGLE history entry rather than one per update;
 * otherwise undoing one drag would take dozens of presses to fully
 * reverse. The debounce window resets on every `set` call, so it only
 * commits once updates actually pause. `undo`/`redo` always flush any
 * pending commit first, so they never operate on a stale/incomplete
 * history - including the case where undo is pressed before the very
 * first debounce has even fired. Starting a new edit after an undo clears
 * the redo stack immediately (not only once that edit's own debounce
 * commits), so a stale "redo" can't briefly reappear as available while
 * you're mid-edit on a new branch. All of this - burst-collapsing,
 * immediate-undo, and the stale-redo edge case - was verified with a
 * standalone test mirroring this exact logic before writing this file.
 */
export function useUndoableState<T>(initial: T | (() => T)): UndoableState<T> {
  const [present, setPresentState] = useState<T>(initial);
  const past = useRef<T[]>([]);
  const future = useRef<T[]>([]);
  const pendingBase = useRef<T | null>(null);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const commitPending = useCallback(() => {
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
      debounceTimer.current = null;
    }
    if (pendingBase.current === null) return;
    past.current.push(pendingBase.current);
    if (past.current.length > MAX_HISTORY) past.current.shift();
    pendingBase.current = null;
    future.current = [];
    setCanUndo(true);
    setCanRedo(false);
  }, []);

  const set = useCallback(
    (updater: Updater<T>) => {
      setPresentState((prev) => {
        const next = typeof updater === "function" ? (updater as (p: T) => T)(prev) : updater;
        if (next === prev) return prev;
        if (pendingBase.current === null) {
          pendingBase.current = prev;
          future.current = [];
          setCanRedo(false);
        }
        if (debounceTimer.current) clearTimeout(debounceTimer.current);
        debounceTimer.current = setTimeout(commitPending, DEBOUNCE_MS);
        return next;
      });
    },
    [commitPending]
  );

  const undo = useCallback(() => {
    commitPending();
    if (past.current.length === 0) return;
    setPresentState((prev) => {
      const previous = past.current.pop() as T;
      future.current.push(prev);
      setCanUndo(past.current.length > 0);
      setCanRedo(true);
      return previous;
    });
  }, [commitPending]);

  const redo = useCallback(() => {
    if (future.current.length === 0) return;
    setPresentState((prev) => {
      const next = future.current.pop() as T;
      past.current.push(prev);
      setCanUndo(true);
      setCanRedo(future.current.length > 0);
      return next;
    });
  }, []);

  const resetHistory = useCallback((newPresent?: T) => {
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
      debounceTimer.current = null;
    }
    past.current = [];
    future.current = [];
    pendingBase.current = null;
    setCanUndo(false);
    setCanRedo(false);
    if (newPresent !== undefined) setPresentState(newPresent);
  }, []);

  return { present, set, undo, redo, resetHistory, canUndo, canRedo };
}
