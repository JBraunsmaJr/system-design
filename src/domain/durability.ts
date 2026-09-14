/**
 * Derives what to tell the user about whether their work is safe (WS13-R8,
 * WS13-R9, WS2-R4, NFR-10).
 *
 * Kept separate from the component that renders it because the interesting
 * part is precedence, not presentation: several signals can be true at once
 * and the honest answer is always the worst of them. A document that is
 * file-backed AND failing to write must not read as "saved to file".
 *
 * NFR-10 is the rule this module exists to enforce: durability is never
 * reported optimistically. Callers pass what has been CONFIRMED - a write that
 * completed, a permission that was granted - never what was attempted. If a
 * signal is unknown, the honest level is the lower one.
 */
import type { StorageFailureReason } from "./documentStore.ts";

export type DurabilityLevel =
  /** Written to a file on disk the user chose. Survives clearing the browser. */
  | "file"
  /** Confirmed present on the server. */
  | "synced"
  /** In browser storage only. Survives a reload; not a cleared profile. */
  | "local"
  /** Nothing is being written. Everything is lost on close. */
  | "at-risk"
  /** Still opening; durability genuinely unknown. */
  | "loading";

export type DurabilityTone = "ok" | "caution" | "alert";

export interface DurabilitySignals {
  /** Local persistence, as confirmed - not as requested. */
  localPersistence: "active" | "loading" | "unavailable";
  /** True only once a file handle is attached AND a write has succeeded. */
  fileBacked?: boolean;
  /** Server sync, where a store is configured. Absent means no store. */
  serverSync?: "synced" | "pending" | "offline";
  /** Updates queued for the server (WS8-R12). */
  pendingUpdates?: number;
  /** Participants in this session holding their own persisted replica
   * (WS13-R10). Absent outside a session. Counts replicas, not connections:
   * a peer with storage denied is connected but holds nothing. */
  replicaCount?: number;
  /** Set when an intact-but-unreadable draft is blocking autosave. */
  autosaveBlockedReason?: string | null;
  /** The most recent storage failure, if it has not been resolved. */
  storageFailure?: { reason: StorageFailureReason; message: string } | null;
}

export interface DurabilityState {
  level: DurabilityLevel;
  tone: DurabilityTone;
  /** Short enough for a chip. Sentence case, describes state not mechanism. */
  label: string;
  /** One sentence. On a problem it says what to do, not how bad it is. */
  detail: string;
  /** Present only when there is something the user can act on. */
  action?: "export" | "retry" | "choose-file";
  /** True when the user should not be able to dismiss this away. */
  persistent: boolean;
}

/**
 * Worst signal wins. The order below IS the specification - a failure to write
 * outranks every reassuring signal, because the entire point of this indicator
 * is that the previous behaviour let a quota failure pass unnoticed while the
 * user kept typing.
 */
export function deriveDurability(signals: DurabilitySignals): DurabilityState {
  const failure = signals.storageFailure;

  if (failure?.reason === "quota") {
    return {
      level: "at-risk",
      tone: "alert",
      label: "Not saving",
      detail:
        "There is no space left to save. Export a copy before making more changes.",
      action: "export",
      persistent: true,
    };
  }

  if (failure?.reason === "unavailable" || signals.localPersistence === "unavailable") {
    return {
      level: "at-risk",
      tone: "alert",
      label: "Not saving",
      detail:
        "This browser is not allowing storage, so changes are kept only until you close the tab. Export a copy to keep them.",
      action: "export",
      persistent: true,
    };
  }

  if (signals.autosaveBlockedReason) {
    return {
      level: "at-risk",
      tone: "alert",
      label: "Saving paused",
      detail: signals.autosaveBlockedReason,
      action: "export",
      persistent: true,
    };
  }

  if (failure) {
    return {
      level: "at-risk",
      tone: "alert",
      label: "Not saving",
      detail: failure.message,
      action: "retry",
      persistent: true,
    };
  }

  if (signals.localPersistence === "loading") {
    return {
      level: "loading",
      tone: "caution",
      label: "Opening",
      detail: "Loading this document from browser storage.",
      persistent: false,
    };
  }

  if (signals.serverSync === "offline" || signals.serverSync === "pending") {
    const queued = signals.pendingUpdates ?? 0;
    return {
      level: "local",
      tone: "caution",
      label: signals.serverSync === "offline" ? "Offline" : "Syncing",
      detail:
        signals.serverSync === "offline"
          ? queued > 0
            ? `${queued} ${queued === 1 ? "change is" : "changes are"} waiting to sync. They are saved on this device in the meantime.`
            : "Changes are saved on this device and will sync when the connection returns."
          : "Sending recent changes to the server.",
      persistent: false,
    };
  }

  if (signals.serverSync === "synced") {
    return {
      level: "synced",
      tone: "ok",
      label: "Synced",
      detail: "Saved on this device and on the server.",
      persistent: false,
    };
  }

  if (signals.fileBacked) {
    return {
      level: "file",
      tone: "ok",
      label: "Saved to file",
      detail: "Changes are written to the file you chose as you work.",
      persistent: false,
    };
  }

  return {
    level: "local",
    tone: "ok",
    label: "Saved in browser",
    detail: describeReplicas(
      "Saved on this device. Clearing browser data will remove it.",
      signals.replicaCount,
    ),
    action: "choose-file",
    persistent: false,
  };
}

function describeReplicas(base: string, replicaCount?: number): string {
  if (replicaCount === undefined) return base;
  if (replicaCount <= 1) {
    return `${base} You are the only person here with a saved copy.`;
  }
  return `${base} ${replicaCount} people here have a saved copy.`;
}

/**
 * Whether this participant is the only one holding a persisted replica, and so
 * must be warned before disconnecting (WS13-R11).
 *
 * Separate from the indicator because it gates an action rather than a
 * display, and because getting it backwards - warning everyone, or no one -
 * both defeat the purpose.
 */
export function isSoleReplicaHolder(signals: DurabilitySignals): boolean {
  if (signals.serverSync === "synced") return false;
  if (signals.fileBacked) return false;
  if (signals.localPersistence !== "active") return false;
  return (signals.replicaCount ?? 0) <= 1;
}
