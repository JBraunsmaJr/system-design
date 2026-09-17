/**
 * Ordered, append-only migration chain for the diagram file format.
 *
 * Every version the application has ever written must keep opening - see
 * fixtures/README.md for the corpus that enforces it. The rules here are
 * deliberately strict because the failure mode is silent: a file that loads
 * with a field quietly missing looks fine until the user re-saves over their
 * only good copy.
 *
 * Rules:
 *  - VERSION_ORDER is append-only. Never remove, reorder, or renumber an entry,
 *    even for a version that only ever existed in development.
 *  - Every adjacent pair in VERSION_ORDER needs a MIGRATIONS entry, even if the
 *    change was purely additive and the migration is a no-op. An explicit
 *    no-op documents that the step was considered; a missing one is
 *    indistinguishable from an oversight.
 *  - Migrations receive and return a loose record. They run BEFORE the
 *    per-section normalizers in serialization.ts, so they see raw file shapes
 *    rather than domain types.
 *  - Migrations must not drop keys they don't recognise. A file written by a
 *    newer patch release may legitimately carry fields this build has never
 *    heard of, and preserving them is what makes a round trip through an older
 *    build non-destructive.
 */

export type RawDiagramFile = Record<string, unknown>;

/**
 * Every schema version ever written, oldest first.
 *
 * 0.1-0.5 were never tagged and existed in development only; they are listed
 * so that any file produced during that period still has a path forward.
 * 0.6 shipped in v0.9 through v0.91.3, 0.7 in v0.92 onward.
 */
export const VERSION_ORDER = [
  "0.1",
  "0.2",
  "0.3",
  "0.4",
  "0.5",
  "0.6",
  "0.7",
] as const;

export type SchemaVersion = (typeof VERSION_ORDER)[number];

/** The version assumed for a file that carries no schemaVersion at all. */
export const OLDEST_VERSION: SchemaVersion = VERSION_ORDER[0];

export interface Migration {
  from: SchemaVersion;
  to: SchemaVersion;
  /** Human-readable note; surfaced in errors and useful when bisecting. */
  description: string;
  migrate: (file: RawDiagramFile) => RawDiagramFile;
}

/**
 * Compares dotted numeric version strings. Used only to classify versions that
 * are NOT in VERSION_ORDER, so we can tell "from the future" apart from
 * "unrecognised".
 */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((n) => Number.parseInt(n, 10));
  const pb = b.split(".").map((n) => Number.parseInt(n, 10));
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const va = Number.isFinite(pa[i]) ? pa[i] : 0;
    const vb = Number.isFinite(pb[i]) ? pb[i] : 0;
    if (va !== vb) return va < vb ? -1 : 1;
  }
  return 0;
}

export function isKnownVersion(version: string): version is SchemaVersion {
  return (VERSION_ORDER as readonly string[]).includes(version);
}

/**
 * Every format change so far has been additive: one new top-level field per
 * version, which the per-section normalizers already default when absent. The
 * migrations are therefore no-ops, and are written out explicitly rather than
 * inferred so that the first NON-additive change has an obvious home and an
 * obvious precedent for how to write it.
 */
export const MIGRATIONS: Migration[] = [
  {
    from: "0.1",
    to: "0.2",
    description: "Added scenarios; absent means no scenarios.",
    migrate: (file) => file,
  },
  {
    from: "0.2",
    to: "0.3",
    description: "Added nested sub-diagrams under node data; no file change.",
    migrate: (file) => file,
  },
  {
    from: "0.3",
    to: "0.4",
    description: "Added requirements; absent means an empty document.",
    migrate: (file) => file,
  },
  {
    from: "0.4",
    to: "0.5",
    description: "Added programIncrements; absent means none.",
    migrate: (file) => file,
  },
  {
    from: "0.5",
    to: "0.6",
    description: "Added team; absent means an empty team document.",
    migrate: (file) => file,
  },
  {
    from: "0.6",
    to: "0.7",
    description:
      "Added milestones and shape/icon fallback maps; all absent-safe.",
    migrate: (file) => file,
  },
];

/** Thrown when a file cannot be brought forward to the current version. */
export class SchemaVersionError extends Error {
  readonly fileVersion: string;
  readonly appVersion: string;

  constructor(message: string, fileVersion: string, appVersion: string) {
    super(message);
    this.name = "SchemaVersionError";
    this.fileVersion = fileVersion;
    this.appVersion = appVersion;
  }
}

function findMigration(from: SchemaVersion): Migration | undefined {
  return MIGRATIONS.find((m) => m.from === from);
}

/**
 * Brings a raw parsed file forward to `targetVersion`, applying each
 * registered migration in order.
 *
 * Refuses rather than guesses when the file is from a newer version: a
 * best-effort load of a format we have never seen is how fields get silently
 * dropped and then permanently lost on the next save.
 */
export function migrateToCurrent(
  file: RawDiagramFile,
  targetVersion: string,
): { file: RawDiagramFile; applied: Migration[] } {
  const declared = file.schemaVersion;
  const fileVersion =
    typeof declared === "string" && declared.trim() !== ""
      ? declared.trim()
      : OLDEST_VERSION;

  if (fileVersion === targetVersion) {
    return { file, applied: [] };
  }

  if (!isKnownVersion(fileVersion)) {
    if (compareVersions(fileVersion, targetVersion) > 0) {
      throw new SchemaVersionError(
        `This file was created by a newer version of the application ` +
          `(file format ${fileVersion}, this build supports up to ${targetVersion}). ` +
          `Update the application to open it.`,
        fileVersion,
        targetVersion,
      );
    }
    throw new SchemaVersionError(
      `Unrecognised file format version ${fileVersion} ` +
        `(this build supports ${VERSION_ORDER[0]} through ${targetVersion}).`,
      fileVersion,
      targetVersion,
    );
  }

  if (!isKnownVersion(targetVersion)) {
    throw new SchemaVersionError(
      `Unknown target version ${targetVersion}.`,
      fileVersion,
      targetVersion,
    );
  }

  if (compareVersions(fileVersion, targetVersion) > 0) {
    throw new SchemaVersionError(
      `This file was created by a newer version of the application ` +
        `(file format ${fileVersion}, this build supports up to ${targetVersion}). ` +
        `Update the application to open it.`,
      fileVersion,
      targetVersion,
    );
  }

  let current: RawDiagramFile = file;
  let version: SchemaVersion = fileVersion;
  const applied: Migration[] = [];

  while (version !== targetVersion) {
    const migration = findMigration(version);
    if (!migration) {
      throw new SchemaVersionError(
        `No migration registered from file format ${version}. ` +
          `This is a bug: every adjacent pair in VERSION_ORDER needs a MIGRATIONS entry.`,
        fileVersion,
        targetVersion,
      );
    }
    current = migration.migrate(current);
    applied.push(migration);
    version = migration.to;
  }

  return { file: { ...current, schemaVersion: targetVersion }, applied };
}
