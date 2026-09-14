import {
  VERSION_ORDER,
  MIGRATIONS,
  OLDEST_VERSION,
  SchemaVersionError,
  compareVersions,
  isKnownVersion,
  migrateToCurrent,
  type RawDiagramFile,
} from "./schemaMigrations.ts";
import { SCHEMA_VERSION } from "./serialization.ts";

let failures = 0;
function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  ✓ ${message}`);
  } else {
    failures++;
    console.error(`  FAIL: ${message}`);
  }
}

console.log("=== 1. Registry covers the whole version chain ===");
{
  assert(VERSION_ORDER.length > 0, "VERSION_ORDER is populated");
  assert(
    VERSION_ORDER[VERSION_ORDER.length - 1] === SCHEMA_VERSION,
    `VERSION_ORDER ends at the current SCHEMA_VERSION (${SCHEMA_VERSION}) - ` +
      `bumping the version without appending here would leave files unopenable`,
  );
  assert(OLDEST_VERSION === VERSION_ORDER[0], "OLDEST_VERSION is the first entry");

  let contiguous = true;
  for (let i = 0; i < VERSION_ORDER.length - 1; i++) {
    const from = VERSION_ORDER[i];
    const to = VERSION_ORDER[i + 1];
    if (!MIGRATIONS.some((m) => m.from === from && m.to === to)) {
      contiguous = false;
      console.error(`    missing migration ${from} -> ${to}`);
    }
  }
  assert(contiguous, "every adjacent version pair has a registered migration");

  const froms = MIGRATIONS.map((m) => m.from);
  assert(
    new Set(froms).size === froms.length,
    "no two migrations share a `from` version",
  );
  assert(
    MIGRATIONS.every((m) => m.description.trim().length > 0),
    "every migration documents what changed",
  );
  assert(
    MIGRATIONS.length === VERSION_ORDER.length - 1,
    "there are exactly as many migrations as version transitions",
  );
}

console.log("=== 2. Version comparison ===");
{
  assert(compareVersions("0.6", "0.7") < 0, "0.6 sorts before 0.7");
  assert(compareVersions("0.7", "0.7") === 0, "equal versions compare equal");
  assert(compareVersions("0.10", "0.9") > 0, "0.10 sorts after 0.9, not before");
  assert(compareVersions("1.0", "0.99") > 0, "major version dominates");
  assert(compareVersions("1", "1.0") === 0, "missing segments are treated as zero");
  assert(isKnownVersion("0.7"), "0.7 is a known version");
  assert(!isKnownVersion("9.9"), "9.9 is not a known version");
}

console.log("=== 3. Migrating forward ===");
{
  const oldFile: RawDiagramFile = {
    schemaVersion: "0.1",
    title: "Ancient",
    nodes: [],
    edges: [],
  };
  const { file, applied } = migrateToCurrent(oldFile, SCHEMA_VERSION);
  assert(
    file.schemaVersion === SCHEMA_VERSION,
    "the result declares the current version",
  );
  assert(
    applied.length === VERSION_ORDER.length - 1,
    "every step in the chain ran",
  );
  assert(file.title === "Ancient", "content survives the chain");

  const current: RawDiagramFile = { schemaVersion: SCHEMA_VERSION, nodes: [] };
  assert(
    migrateToCurrent(current, SCHEMA_VERSION).applied.length === 0,
    "a current-version file runs no migrations",
  );
}

console.log("=== 4. A missing version is treated as the oldest ===");
{
  const noVersion: RawDiagramFile = { title: "No version", nodes: [], edges: [] };
  const { applied } = migrateToCurrent(noVersion, SCHEMA_VERSION);
  assert(
    applied.length === VERSION_ORDER.length - 1,
    "an absent schemaVersion runs the full chain from the oldest version",
  );

  const blank: RawDiagramFile = { schemaVersion: "   ", nodes: [] };
  assert(
    migrateToCurrent(blank, SCHEMA_VERSION).applied.length ===
      VERSION_ORDER.length - 1,
    "a blank schemaVersion is treated the same as an absent one",
  );
}

console.log("=== 5. Newer and unrecognised versions are refused ===");
{
  let caught: SchemaVersionError | undefined;
  try {
    migrateToCurrent({ schemaVersion: "99.0", nodes: [] }, SCHEMA_VERSION);
  } catch (error) {
    caught = error as SchemaVersionError;
  }
  assert(caught instanceof SchemaVersionError, "a newer version throws SchemaVersionError");
  assert(
    caught?.message.includes("99.0") === true &&
      caught?.message.includes(SCHEMA_VERSION),
    "the message names both the file's version and this build's",
  );
  assert(
    caught?.fileVersion === "99.0" && caught?.appVersion === SCHEMA_VERSION,
    "the error carries both versions as fields for the UI to use",
  );

  let unknownOld: SchemaVersionError | undefined;
  try {
    migrateToCurrent({ schemaVersion: "0.65", nodes: [] }, SCHEMA_VERSION);
  } catch (error) {
    unknownOld = error as SchemaVersionError;
  }
  assert(
    unknownOld instanceof SchemaVersionError,
    "an unrecognised older version is refused rather than guessed at",
  );
}

console.log("=== 6. Migrations preserve fields they don't recognise ===");
{
  const withFuture: RawDiagramFile = {
    schemaVersion: "0.6",
    nodes: [],
    edges: [],
    somethingFromANewerPatch: { keep: true },
  };
  const { file } = migrateToCurrent(withFuture, SCHEMA_VERSION);
  assert(
    (file.somethingFromANewerPatch as Record<string, unknown> | undefined)
      ?.keep === true,
    "an unrecognised top-level field survives the migration chain",
  );
}

console.log("=== 7. Migrations do not mutate their input ===");
{
  const input: RawDiagramFile = { schemaVersion: "0.1", nodes: [], edges: [] };
  migrateToCurrent(input, SCHEMA_VERSION);
  assert(
    input.schemaVersion === "0.1",
    "the caller's object is left at its original version",
  );
}

if (failures > 0) {
  console.error(`\n${failures} failure(s)`);
  throw new Error(`${failures} schema migration check(s) failed`);
}
console.log("\nAll schema migration checks passed.");
