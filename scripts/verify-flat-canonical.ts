/**
 * WS1 Step 5 - the flat schema is canonical (WS1-R3, WS5-R9).
 *
 * Driven by the fixture corpus rather than hand-built files, because the bug
 * this step fixes lived in exactly that gap: the existing document tests built
 * FLAT files on the belief that DiagramFile is flat, while every real file -
 * and every corpus fixture - is NESTED. Loading a real file dropped every
 * sub-diagram, and nothing noticed.
 */
import "fake-indexeddb/auto";
import { readFileSync, readdirSync } from "fs";
import { join, resolve } from "path";
import * as Y from "yjs";
import { parseDiagramFile, type DiagramFile } from "../src/domain/serialization.ts";
import { getBreadcrumbLabels } from "../src/domain/subDiagramTree.ts";
import {
  flattenSubDiagramTree,
  unflattenToSubDiagram,
  getBreadcrumbLabelsFlat,
} from "../src/collab/diagramStore.ts";
import { createYjsDiagramStore, seedYjsDiagramDoc } from "../src/collab/yjsDiagramStore.ts";
import { openDocument, replaceDocumentContents } from "../src/collab/localDocument.ts";
import type { Node, Edge } from "@xyflow/react";
import type { ArchNodeData, ArchEdgeData } from "../src/domain/types.ts";

let failures = 0;
function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  ✓ ${message}`);
  } else {
    failures++;
    console.error(`  FAIL: ${message}`);
  }
}

const root = resolve(".");
const fixtureDir = join(root, "fixtures");
const fixtures = readdirSync(fixtureDir)
  .filter((f: string) => /^schema-.*\.json$/.test(f))
  .sort()
  .map((f: string) => ({ name: f, file: parseDiagramFile(readFileSync(join(fixtureDir, f), "utf8")) }));

/** What must survive: identity, level, containment, geometry, label. */
function nodeKey(n: Node<ArchNodeData>): string {
  const d = n.data as ArchNodeData & { parentPath?: string[] };
  return JSON.stringify([n.id, d.parentPath ?? [], n.parentId ?? null, n.position, d.label ?? null]);
}
function edgeKey(e: Edge<ArchEdgeData>): string {
  const d = e.data as (ArchEdgeData & { parentPath?: string[] }) | undefined;
  return JSON.stringify([e.id, e.source, e.target, d?.parentPath ?? []]);
}
function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((v, i) => v === sb[i]);
}
function treeOf(file: DiagramFile) {
  return { nodes: file.nodes, edges: file.edges };
}

assert(fixtures.length > 0, `corpus found (${fixtures.length} fixtures)`);
assert(
  fixtures.some(({ file }) => file.nodes.some((n) => n.data.subDiagram?.nodes.length)),
  "at least one fixture actually nests a sub-diagram (otherwise this suite proves nothing)"
);

console.log("\n=== flattenSubDiagramTree is idempotent ===");
for (const { name, file } of fixtures) {
  const once = flattenSubDiagramTree(treeOf(file));
  const twice = flattenSubDiagramTree(once);
  assert(
    sameSet(once.nodes.map(nodeKey), twice.nodes.map(nodeKey)) &&
      sameSet(once.edges.map(edgeKey), twice.edges.map(edgeKey)),
    `${name}: flatten(flatten(x)) = flatten(x)`
  );
}
{
  // A nested entry's position wins over a stale tag it happens to carry.
  const stale = flattenSubDiagramTree({
    nodes: [
      {
        id: "outer",
        type: "typed",
        position: { x: 0, y: 0 },
        data: {
          nodeType: "service",
          label: "Outer",
          subDiagram: {
            nodes: [
              {
                id: "inner",
                type: "typed",
                position: { x: 0, y: 0 },
                data: { nodeType: "service", label: "Inner", parentPath: ["somewhere-else"] } as unknown as ArchNodeData,
              },
            ],
            edges: [],
          },
        },
      },
    ],
    edges: [],
  } as never);
  const inner = stale.nodes.find((n) => n.id === "inner");
  assert(
    JSON.stringify((inner?.data as { parentPath?: string[] }).parentPath) === JSON.stringify(["outer"]),
    "a nested node's tree position overrides a stale parentPath tag"
  );
}

console.log("\n=== Loading a real (nested) file keeps every level ===");
for (const { name, file } of fixtures) {
  const expected = flattenSubDiagramTree(treeOf(file));

  // Into a document that already holds something, as File > Open does.
  const doc = new Y.Doc();
  seedYjsDiagramDoc(doc, {
    nodes: [{ id: "previous", type: "typed", position: { x: 1, y: 1 }, data: { nodeType: "service", label: "Old" } }],
    edges: [],
  } as never);
  replaceDocumentContents(doc, file);
  const loaded = createYjsDiagramStore(doc).getSnapshot();
  assert(
    sameSet(loaded.nodes.map(nodeKey), expected.nodes.map(nodeKey)),
    `${name}: replaceDocumentContents keeps all ${expected.nodes.length} nodes at their levels`
  );
  assert(
    sameSet(loaded.edges.map(edgeKey), expected.edges.map(edgeKey)),
    `${name}: replaceDocumentContents keeps all ${expected.edges.length} edges at their levels`
  );

  // Round trip through the export boundary (WS5-R9).
  const rebuilt = flattenSubDiagramTree(unflattenToSubDiagram(loaded.nodes, loaded.edges));
  assert(
    sameSet(rebuilt.nodes.map(nodeKey), expected.nodes.map(nodeKey)) &&
      sameSet(rebuilt.edges.map(edgeKey), expected.edges.map(edgeKey)),
    `${name}: document -> tree -> flat is lossless`
  );
}

console.log("\n=== Opening a document seeded from a real file keeps every level ===");
for (const { name, file } of fixtures) {
  const expected = flattenSubDiagramTree(treeOf(file));
  const opened = await openDocument({ docId: `flat-${name}`, initial: file, persist: false });
  const snap = opened.stores.diagram.getSnapshot();
  assert(
    sameSet(snap.nodes.map(nodeKey), expected.nodes.map(nodeKey)),
    `${name}: openDocument seed keeps all ${expected.nodes.length} nodes at their levels`
  );
  await opened.close();
}

console.log("\n=== Flat breadcrumbs match the tree walk ===");
for (const { name, file } of fixtures) {
  const tree = treeOf(file);
  const flat = flattenSubDiagramTree(tree);
  let mismatches = 0;
  const paths: string[][] = [[]];
  for (const n of flat.nodes) {
    paths.push([...((n.data as { parentPath?: string[] }).parentPath ?? []), n.id]);
  }
  // Paths that do not resolve, or resolve only partway.
  paths.push(["no-such-node"], [...(paths[1] ?? []), "no-such-child"], ["no-such-node", ...(paths[1] ?? [])]);
  if (flat.nodes.length > 1) paths.push([flat.nodes[1].id, flat.nodes[0].id]);
  for (const p of paths) {
    const a = JSON.stringify(getBreadcrumbLabels(tree, p));
    const b = JSON.stringify(getBreadcrumbLabelsFlat(flat.nodes, p));
    if (a !== b) {
      mismatches++;
      console.error(`    ${name} ${JSON.stringify(p)}: tree=${a} flat=${b}`);
    }
  }
  assert(mismatches === 0, `${name}: ${paths.length} paths agree`);
}

console.log("\n=== WS5-R9: lossless at four levels deep ===");
{
  // The corpus nests one level. WS5-R9 asks for three or more, so build a
  // tree four levels deep, with edges and several nodes at every level.
  type AnyNode = Node<ArchNodeData>;
  const level = (prefix: string, depth: number): { nodes: AnyNode[]; edges: Edge<ArchEdgeData>[] } => {
    const nodes: AnyNode[] = [0, 1, 2].map((i) => ({
      id: `${prefix}${i}`,
      type: "typed",
      position: { x: i * 100 + depth, y: depth * 10 },
      data: {
        nodeType: "service",
        label: `${prefix}${i}`,
        ...(i === 0 && depth < 4 ? { subDiagram: level(`${prefix}${i}.`, depth + 1) } : {}),
      } as ArchNodeData,
    }));
    const edges = [
      { id: `${prefix}e`, source: `${prefix}0`, target: `${prefix}1`, type: "typed", data: { edgeType: "sync" } as ArchEdgeData },
      { id: `${prefix}f`, source: `${prefix}1`, target: `${prefix}2`, type: "typed", data: { edgeType: "sync" } as ArchEdgeData },
    ];
    return { nodes, edges };
  };
  const tree = level("n", 1);
  const flat = flattenSubDiagramTree(tree as never);
  const deepest = flat.nodes.filter((n) => ((n.data as { parentPath?: string[] }).parentPath ?? []).length === 3);
  assert(flat.nodes.length === 12 && flat.edges.length === 8 && deepest.length === 3, `four levels flatten to 12 nodes and 8 edges (${deepest.length} at depth 4)`);
  const rebuilt = unflattenToSubDiagram(flat.nodes, flat.edges);
  const strip = (x: unknown): unknown => JSON.parse(JSON.stringify(x));
  assert(JSON.stringify(strip(rebuilt)) === JSON.stringify(strip(tree)), "flatten then rebuild yields the original tree exactly");

  const deepFile = { ...fixtures[fixtures.length - 1].file, nodes: tree.nodes, edges: tree.edges } as DiagramFile;
  const doc = new Y.Doc();
  replaceDocumentContents(doc, deepFile);
  const loaded = createYjsDiagramStore(doc).getSnapshot();
  assert(sameSet(loaded.nodes.map(nodeKey), flat.nodes.map(nodeKey)) && sameSet(loaded.edges.map(edgeKey), flat.edges.map(edgeKey)), "and a file that deep loads into a document at every level");
  const back = unflattenToSubDiagram(loaded.nodes, loaded.edges);
  assert(JSON.stringify(strip(back)) === JSON.stringify(strip(tree)), "and comes back out of the document unchanged");
}

console.log("\n=== WS1-R3: flattening only at import boundaries ===");
{
  // The acceptance criterion, pinned. Adding a caller means deciding it is an
  // import boundary and saying so here.
  const allowed = new Set([
    "src/collab/diagramStore.ts", // definition, and the local store's replaceAll
    "src/collab/yjsDiagramStore.ts", // seedYjsDiagramDoc - the import boundary itself
  ]);
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(rel);
      else if (/\.(ts|tsx)$/.test(entry.name) && !/\.(verify|test|spec)\./.test(entry.name)) {
        const text = readFileSync(join(root, rel), "utf8");
        if (/\bflattenSubDiagramTree\s*\(/.test(text) && !allowed.has(rel)) offenders.push(rel);
      }
    }
  };
  walk("src");
  assert(offenders.length === 0, `no other production callers${offenders.length ? `: ${offenders.join(", ")}` : ""}`);
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll flat-canonical checks passed.");
