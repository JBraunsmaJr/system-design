/**
 * WS4-R5 and WS4-R7, pinned in the source.
 *
 *  R5  Garbage collection stays enabled: no Y.Doc is constructed with
 *      `gc: false`. History comes from DiagramFile snapshots, not Yjs.
 *  R7  Compaction and rebase are distinct: no function in the codebase
 *      performs both.
 */
import { readFileSync, readdirSync } from "fs";
import { join, resolve } from "path";

let failures = 0;
function check(condition: boolean, message: string) {
  if (condition) console.log(`  ✓ ${message}`);
  else {
    failures++;
    console.error(`  FAIL: ${message}`);
  }
}

const root = resolve(".");
function sources(dir: string, out: { path: string; text: string }[] = []) {
  for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) sources(rel, out);
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push({ path: rel, text: readFileSync(join(root, rel), "utf8") });
  }
  return out;
}
const files = [...sources("src"), ...sources("scripts")].filter((f) => f.path !== "scripts/verify-crdt-invariants.ts");

console.log("=== WS4-R5: gc stays on ===");
{
  const offenders = files.filter((f) => /\bgc\s*:\s*false\b/.test(f.text)).map((f) => f.path);
  check(offenders.length === 0, `no Y.Doc is built with gc: false${offenders.length ? ` (${offenders.join(", ")})` : ""}`);
  const constructed = files.filter((f) => /new\s+Y\.Doc\s*\(/.test(f.text)).length;
  check(constructed > 0, `the check actually sees Y.Doc construction (${constructed} files)`);
}

console.log("\n=== WS4-R7: compaction and rebase are separate operations ===");
{
  // Every function body that mentions both a compaction and a rebase call.
  const both: string[] = [];
  for (const f of files) {
    if (/\.verify\.|scripts\//.test(f.path)) continue;
    // Split into top-level-ish chunks at function / method boundaries.
    // Also at `const name =` declarations, so two separate callbacks in one
    // component are not read as one operation.
    const chunks = f.text.split(
      /\n(?=\s*(?:export\s+)?(?:async\s+)?(?:function\b|(?:const|let)\s+[A-Za-z_]+\s*=|[A-Za-z_]+\s*\([^)]*\)\s*\{|[A-Za-z_]+:\s*(?:async\s*)?\())/
    );
    for (const chunk of chunks) {
      const compacts = /\.compact\s*(?:\?\.)?\s*\(/.test(chunk);
      const rebases = /\brebaseDocument\s*(?:\?\.)?\s*\(|\.rebase\s*(?:\?\.)?\s*\(/.test(chunk);
      if (compacts && rebases) both.push(`${f.path}: ${chunk.trim().split("\n")[0].slice(0, 80)}`);
    }
  }
  check(both.length === 0, `no function calls both${both.length ? `:\n    ${both.join("\n    ")}` : ""}`);
  const library = readFileSync(join(root, "src/collab/documentLibrary.ts"), "utf8");
  check(/async compact\(/.test(library) && /async rebase\(/.test(library), "both exist, as separate library operations");
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll CRDT invariant checks passed.");
