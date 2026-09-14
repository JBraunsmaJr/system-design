/**
 * WS5-R5 / WS5-R7 — every file any released version wrote must still load,
 * with no field silently dropped.
 *
 * Fixtures in fixtures/ are GENERATED, not hand-written: scripts/generate-fixtures.sh
 * checks out each historical commit and calls that version's own toDiagramFile.
 * Never edit them by hand - a hand-edited fixture encodes what we currently
 * believe an old version wrote, which is exactly the assumption under test.
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseDiagramFile, SCHEMA_VERSION } from "../src/domain/serialization";

let failures = 0;
function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  ✓ ${message}`);
  } else {
    failures++;
    console.error(`  FAIL: ${message}`);
  }
}

const fixturesDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "../fixtures",
);

/** Walks both objects, reporting any leaf present in `before` but absent after. */
function findDroppedPaths(
  before: unknown,
  after: unknown,
  path = "",
  dropped: string[] = [],
): string[] {
  if (before === null || typeof before !== "object") return dropped;

  if (Array.isArray(before)) {
    if (!Array.isArray(after)) {
      dropped.push(path);
      return dropped;
    }
    if (after.length !== before.length) {
      dropped.push(`${path}[length ${before.length} -> ${after.length}]`);
    }
    before.forEach((item, i) =>
      findDroppedPaths(item, after[i], `${path}[${i}]`, dropped),
    );
    return dropped;
  }

  const afterObj = after as Record<string, unknown> | undefined;
  for (const [key, value] of Object.entries(
    before as Record<string, unknown>,
  )) {
    const childPath = path ? `${path}.${key}` : key;
    // updatedAt is regenerated on load in some versions; not a data loss.
    if (childPath === "metadata.updatedAt") continue;
    if (afterObj === undefined || afterObj[key] === undefined) {
      dropped.push(childPath);
      continue;
    }
    findDroppedPaths(value, afterObj[key], childPath, dropped);
  }
  return dropped;
}

const fixtures = readdirSync(fixturesDir)
  .filter((f: string) => f.startsWith("schema-") && f.endsWith(".json"))
  .sort();

console.log("=== 1. Every released schema version still loads ===");
assert(fixtures.length > 0, "fixture corpus is present");

for (const name of fixtures) {
  const raw = readFileSync(join(fixturesDir, name), "utf8");
  const original = JSON.parse(raw) as Record<string, unknown>;
  let parsed: Record<string, unknown> | undefined;

  try {
    parsed = parseDiagramFile(raw) as unknown as Record<string, unknown>;
    assert(true, `${name} loads without throwing`);
  } catch (error) {
    assert(false, `${name} loads without throwing (${String(error)})`);
    continue;
  }

  const dropped = findDroppedPaths(original, parsed);
  assert(
    dropped.length === 0,
    `${name} preserves every field${dropped.length ? ` (dropped: ${dropped.slice(0, 5).join(", ")}${dropped.length > 5 ? ` and ${dropped.length - 5} more` : ""})` : ""}`,
  );
}

console.log("=== 2. The current version is represented in the corpus ===");
assert(
  fixtures.some((f: string) => f === `schema-${SCHEMA_VERSION}.json`),
  `a fixture exists for the current version (${SCHEMA_VERSION})`,
);

console.log("=== 3. Files from a newer version are refused, not half-loaded ===");
{
  const base = JSON.parse(
    readFileSync(join(fixturesDir, `schema-${SCHEMA_VERSION}.json`), "utf8"),
  );
  let refused = false;
  let message = "";
  try {
    parseDiagramFile(JSON.stringify({ ...base, schemaVersion: "99.0" }));
  } catch (error) {
    refused = true;
    message = String((error as Error).message);
  }
  assert(refused, "a file declaring version 99.0 is refused");
  assert(
    refused && message.includes("99.0") && message.includes(SCHEMA_VERSION),
    "the refusal names both the file's version and the application's",
  );
}

console.log("=== 4. A missing schemaVersion is treated as the oldest ===");
{
  const base = JSON.parse(
    readFileSync(join(fixturesDir, "schema-0.1.json"), "utf8"),
  ) as Record<string, unknown>;
  delete base.schemaVersion;
  let loaded: boolean;
  try {
    parseDiagramFile(JSON.stringify(base));
    loaded = true;
  } catch {
    loaded = false;
  }
  assert(loaded, "a file with no schemaVersion still loads");
}

console.log("=== 5. Unknown fields from a newer minor version survive ===");
{
  const base = JSON.parse(
    readFileSync(join(fixturesDir, `schema-${SCHEMA_VERSION}.json`), "utf8"),
  );
  const withFuture = {
    ...base,
    nodes: base.nodes.map((n: Record<string, unknown>, i: number) =>
      i === 0
        ? {
            ...n,
            data: { ...(n.data as object), futureNodeField: "keep me" },
          }
        : n,
    ),
  };
  let preserved: boolean;
  try {
    const parsed = parseDiagramFile(JSON.stringify(withFuture));
    const firstNodeData = parsed.nodes?.[0]?.data as
      | Record<string, unknown>
      | undefined;
    preserved = firstNodeData?.futureNodeField === "keep me";
  } catch {
    preserved = false;
  }
  assert(
    preserved,
    "an unrecognised node field is preserved rather than dropped on load",
  );
}

if (failures > 0) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log("\nAll schema compatibility checks passed.");
