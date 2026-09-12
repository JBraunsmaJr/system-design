import {
  getStandardFixture,
  generateSubDiagram,
} from "./fixtures";
import { flattenSubDiagramTree } from "../collab/diagramStore";

let passedCount = 0;
let failedCount = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    passedCount++;
    console.log(`  ✓ ${message}`);
  } else {
    failedCount++;
    console.error(`  ✗ ${message}`);
  }
}

console.log("\n=== Fixture Generator Verification (PERF-W) ===\n");

// 1. Seeded determinism
{
  console.log("1. Determinism across repeated generations:");
  const run1 = JSON.stringify(generateSubDiagram({ nodeCount: 100, edgeCount: 150, seed: 12345 }));
  const run2 = JSON.stringify(generateSubDiagram({ nodeCount: 100, edgeCount: 150, seed: 12345 }));
  assert(run1 === run2, "Identical seed produces byte-identical serialized JSON");

  const diffSeed = JSON.stringify(generateSubDiagram({ nodeCount: 100, edgeCount: 150, seed: 54321 }));
  assert(run1 !== diffSeed, "Different seed produces distinct diagram structure");
}

// 2. Standard named fixtures sizes
{
  console.log("\n2. Standard Fixture Sizes (PERF-W-2):");

  const small = getStandardFixture("small");
  assert(small.nodes.length === 25, `Small fixture has 25 nodes (actual: ${small.nodes.length})`);
  assert(small.edges.length === 30, `Small fixture has 30 edges (actual: ${small.edges.length})`);

  const medium = getStandardFixture("medium");
  assert(medium.nodes.length === 150, `Medium fixture has 150 nodes (actual: ${medium.nodes.length})`);
  assert(medium.edges.length === 220, `Medium fixture has 220 edges (actual: ${medium.edges.length})`);

  const large = getStandardFixture("large");
  assert(large.nodes.length === 400, `Large fixture has 400 nodes (actual: ${large.nodes.length})`);
  assert(large.edges.length === 600, `Large fixture has 600 edges (actual: ${large.edges.length})`);

  const nested = getStandardFixture("nested");
  const flattenedNested = flattenSubDiagramTree(nested);
  assert(flattenedNested.nodes.length === 300, `Nested fixture has 300 total nodes (actual: ${flattenedNested.nodes.length})`);
  assert(flattenedNested.edges.length === 400, `Nested fixture has 400 total edges (actual: ${flattenedNested.edges.length})`);

  const grouped = getStandardFixture("grouped");
  const groupNodes = grouped.nodes.filter((n) => n.type === "group");
  const standardNodes = grouped.nodes.filter((n) => n.type !== "group");
  assert(groupNodes.length === 20, `Grouped fixture has 20 boundary groups (actual: ${groupNodes.length})`);
  assert(standardNodes.length === 200, `Grouped fixture has 200 standard nodes (actual: ${standardNodes.length})`);
  assert(grouped.edges.length === 250, `Grouped fixture has 250 edges (actual: ${grouped.edges.length})`);
}

// 3. Waypoint coverage (PERF-W-3)
{
  console.log("\n3. Waypoint Coverage (PERF-W-3):");
  const large = getStandardFixture("large");
  const bentEdges = large.edges.filter((e) => (e.data?.waypoints?.length ?? 0) > 0);
  const bentPercentage = (bentEdges.length / large.edges.length) * 100;
  assert(
    bentEdges.length > 50 && bentPercentage >= 10 && bentPercentage <= 30,
    `Large fixture contains ~20% edges with waypoints (actual: ${bentEdges.length}/${large.edges.length} = ${bentPercentage.toFixed(1)}%)`
  );
  const sampleBent = bentEdges[0];
  const wpCount = sampleBent.data?.waypoints?.length ?? 0;
  assert(wpCount >= 1 && wpCount <= 4, `Bent edge has realistic bend count (actual: ${wpCount})`);
}

// 4. Scenario requirements support
{
  console.log("\n4. Scenario Hub & Group support:");
  const large = getStandardFixture("large");
  const hubId = "node-0";
  const hubEdges = large.edges.filter((e) => e.source === hubId || e.target === hubId);
  assert(hubEdges.length >= 25, `Large fixture contains hub node with >=25 attached edges (actual: ${hubEdges.length})`);

  const grouped = getStandardFixture("grouped");
  const group0Children = grouped.nodes.filter((n) => n.parentId === "group-0");
  assert(group0Children.length >= 10, `Grouped fixture contains boundary with >=10 children (actual: ${group0Children.length})`);
}

console.log("\n==================================================");
console.log(`Fixture Verification: ${passedCount} passed, ${failedCount} failed`);
console.log("==================================================\n");

if (failedCount > 0) {
  throw new Error(`Fixture Verification failed with ${failedCount} failure(s)`);
}
