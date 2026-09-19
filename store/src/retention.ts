/**
 * How long a deleted document is kept (WS10-R4, §20 OQ-6).
 *
 * One deployment-wide setting, so a team under a records schedule and a team
 * under none run the same build:
 *
 *   immediate     delete purges at once; nothing is retained
 *   7d / 1y / …   deleted documents are restorable for that period
 *   indefinite    kept until an administrator purges them
 *
 * The default is 30 days: long enough to undo a mistake, short enough that a
 * deployment does not accumulate data it never decided to keep. A legal hold
 * (WS10-R8) prevents purge in every mode, including `immediate`.
 */
export type RetentionPeriod = { kind: "immediate" } | { kind: "duration"; ms: number; label: string } | { kind: "indefinite" };

export const DEFAULT_RETENTION = "30d";

const UNITS: Record<string, number> = {
  d: 86_400_000,
  w: 7 * 86_400_000,
  m: 30 * 86_400_000,
  y: 365 * 86_400_000,
};

export class RetentionConfigError extends Error {}

/**
 * Anything unparseable is an error, not a silent default: a deployment that
 * meant to keep records for seven years should not discover it kept them for
 * thirty days because of a typo.
 */
export function parseRetentionPeriod(raw: string | undefined | null): RetentionPeriod {
  const value = (raw ?? DEFAULT_RETENTION).trim().toLowerCase();
  if (value === "immediate") return { kind: "immediate" };
  if (value === "indefinite" || value === "forever") return { kind: "indefinite" };
  const match = /^(\d+)\s*([dwmy])$/.exec(value);
  if (!match) {
    throw new RetentionConfigError(
      `Unrecognised retention period "${raw}". Use "immediate", a duration such as 30d, 12w, 6m or 7y, or "indefinite".`,
    );
  }
  const amount = Number(match[1]);
  if (amount <= 0) throw new RetentionConfigError(`A retention period must be greater than zero (got "${raw}").`);
  return { kind: "duration", ms: amount * UNITS[match[2]], label: `${amount}${match[2]}` };
}

/** When a document deleted now becomes eligible for purge, or null where it
 * never does on its own. */
export function purgeDueAt(period: RetentionPeriod, deletedAt: Date): Date | null {
  if (period.kind === "immediate") return deletedAt;
  if (period.kind === "indefinite") return null;
  return new Date(deletedAt.getTime() + period.ms);
}

export function describeRetention(period: RetentionPeriod): string {
  if (period.kind === "immediate") return "Deleted documents are removed immediately and cannot be restored.";
  if (period.kind === "indefinite") return "Deleted documents are kept until an administrator purges them.";
  return `Deleted documents are kept, and can be restored, for ${period.label} before being purged.`;
}
