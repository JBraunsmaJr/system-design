/**
 * Stops a tab closing on work that is not yet safely stored (WS13-R7).
 *
 * The browser decides the wording - `beforeunload` cannot carry a custom
 * message in any current engine - so the only thing under our control is
 * WHETHER to prompt. That makes precision the whole job: prompting when there
 * is nothing at risk teaches people to dismiss it, and by the time it matters
 * they will dismiss that one too.
 *
 * The rule is narrow on purpose. Prompt only when closing the tab would
 * actually destroy something: pending writes, or a document with no durable
 * home at all. A document already written to a file, already synced, or
 * already at rest in browser storage is not at risk from a tab closing.
 */
import type { DurabilitySignals } from "./durability.ts";

/** Just enough of EventTarget to install a listener, so tests need no DOM. */
export interface UnloadTarget {
  addEventListener(
    type: "beforeunload",
    listener: (event: { preventDefault: () => void; returnValue?: unknown }) => void,
  ): void;
  removeEventListener(
    type: "beforeunload",
    listener: (event: { preventDefault: () => void; returnValue?: unknown }) => void,
  ): void;
}

/**
 * Whether closing now would lose work.
 *
 * Deliberately NOT the inverse of "is everything fine". Loading, for instance,
 * is an unknown state but nothing has been typed yet, so there is nothing to
 * lose and nothing to prompt about.
 */
export function shouldBlockUnload(signals: DurabilitySignals): boolean {
  // Writes are failing and the user has been told to export. Closing now
  // discards whatever they have done since.
  if (signals.storageFailure) return true;
  if (signals.autosaveBlockedReason) return true;

  // The file the user chose as their copy has changed elsewhere and has not
  // been written since; closing leaves it behind without them deciding.
  if (signals.fileAccess === "available" && signals.fileAttachment?.status === "conflict") return true;

  // Nothing is being written at all.
  if (signals.localPersistence === "unavailable") return true;

  // Queued for a server that has not confirmed receipt. The local replica
  // survives, so this is only worth prompting about when there is no local
  // replica to fall back on.
  if (
    (signals.pendingUpdates ?? 0) > 0 &&
    signals.localPersistence !== "active" &&
    !signals.fileBacked
  ) {
    return true;
  }

  return false;
}

export interface UnloadGuard {
  /** Stops guarding. Safe to call more than once. */
  release(): void;
}

/**
 * Installs the guard. `getSignals` is read at unload time rather than captured,
 * so the decision reflects the state at the moment of closing rather than the
 * state when the guard was installed.
 */
export function installUnloadGuard(
  getSignals: () => DurabilitySignals,
  target: UnloadTarget | undefined = globalThis as unknown as UnloadTarget,
): UnloadGuard {
  if (!target || typeof target.addEventListener !== "function") {
    return { release: () => {} };
  }

  const listener = (event: {
    preventDefault: () => void;
    returnValue?: unknown;
  }) => {
    if (!shouldBlockUnload(getSignals())) return;
    event.preventDefault();
    // Still required by some engines to actually trigger the prompt, even
    // though the string itself is ignored everywhere.
    event.returnValue = "";
  };

  target.addEventListener("beforeunload", listener);
  let released = false;
  return {
    release() {
      if (released) return;
      released = true;
      target.removeEventListener("beforeunload", listener);
    },
  };
}
