import * as Y from "yjs";
import { Position } from "@xyflow/react";
import {
  flattenSubDiagramTree,
  unflattenToSubDiagram,
  getNodesAtPath,
  getEdgesAtPath,
} from "../collab/diagramStore";
import { createYjsDiagramStore, seedYjsDiagramDoc } from "../collab/yjsDiagramStore";
import { computeEffectiveZIndices, type ZOrderBox } from "../domain/zOrder";
import { computeAlignment, type AlignBox } from "../domain/alignmentGuides";
import {
  buildOrthogonalRoute,
  getSegmentInsertions,
  type Point,
} from "../domain/edgeRouting";
import { getContainmentRelation } from "../domain/edgeContainment";
import { generateSubDiagram } from "./fixtures";

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

/**
 * Measures median execution time across multiple runs after warm-up iterations.
 */
function measureMedianDuration(fn: () => void, iterations: number = 7, warmups: number = 2): number {
  for (let w = 0; w < warmups; w++) {
    fn();
  }

  const durations: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    fn();
    const end = performance.now();
    durations.push(end - start); // ms
  }

  durations.sort((a, b) => a - b);
  const mid = Math.floor(durations.length / 2);
  return durations[mid];
}

console.log("\n=== Layer 1 Algorithmic Complexity Guards (PERF-L1) ===\n");

// 1. flattenSubDiagramTree scaling (O(N))
{
  console.log("1. flattenSubDiagramTree Scaling Guard:");
  const smallTree = generateSubDiagram({ nodeCount: 50, edgeCount: 60, depth: 3, seed: 1 });
  const largeTree = generateSubDiagram({ nodeCount: 400, edgeCount: 480, depth: 3, seed: 1 }); // 8x scale

  // Repeat operation multiple times inside measurement loop to obtain measurable duration
  const REPS = 50;
  const tSmall = measureMedianDuration(() => {
    for (let r = 0; r < REPS; r++) flattenSubDiagramTree(smallTree);
  });
  const tLarge = measureMedianDuration(() => {
    for (let r = 0; r < REPS; r++) flattenSubDiagramTree(largeTree);
  });

  const ratio = tLarge / Math.max(0.0001, tSmall);
  // 8x growth in input size: linear O(N) should scale ~8x, well below O(N^2) (64x)
  assert(ratio < 25, `flattenSubDiagramTree scales sub-quadratically (8x size -> ${ratio.toFixed(2)}x time)`);
}

// 2. unflattenToSubDiagram scaling (O(N))
{
  console.log("\n2. unflattenToSubDiagram Scaling Guard:");
  const smallFlat = flattenSubDiagramTree(generateSubDiagram({ nodeCount: 50, edgeCount: 60, depth: 3, seed: 2 }));
  const largeFlat = flattenSubDiagramTree(generateSubDiagram({ nodeCount: 400, edgeCount: 480, depth: 3, seed: 2 })); // 8x scale

  const REPS = 50;
  const tSmall = measureMedianDuration(() => {
    for (let r = 0; r < REPS; r++) unflattenToSubDiagram(smallFlat.nodes, smallFlat.edges);
  });
  const tLarge = measureMedianDuration(() => {
    for (let r = 0; r < REPS; r++) unflattenToSubDiagram(largeFlat.nodes, largeFlat.edges);
  });

  const ratio = tLarge / Math.max(0.0001, tSmall);
  assert(ratio < 25, `unflattenToSubDiagram scales sub-quadratically (8x size -> ${ratio.toFixed(2)}x time)`);
}

// 3. getNodesAtPath & getEdgesAtPath scaling (O(N))
{
  console.log("\n3. getNodesAtPath & getEdgesAtPath Scaling Guard:");
  const smallFlat = flattenSubDiagramTree(generateSubDiagram({ nodeCount: 50, edgeCount: 60, depth: 1, seed: 3 }));
  const largeFlat = flattenSubDiagramTree(generateSubDiagram({ nodeCount: 400, edgeCount: 480, depth: 1, seed: 3 }));

  const REPS = 200;
  const tSmallNodes = measureMedianDuration(() => {
    for (let r = 0; r < REPS; r++) getNodesAtPath(smallFlat.nodes, []);
  });
  const tLargeNodes = measureMedianDuration(() => {
    for (let r = 0; r < REPS; r++) getNodesAtPath(largeFlat.nodes, []);
  });
  const nodeRatio = tLargeNodes / Math.max(0.0001, tSmallNodes);
  assert(nodeRatio < 25, `getNodesAtPath scales linearly (8x size -> ${nodeRatio.toFixed(2)}x time)`);

  const tSmallEdges = measureMedianDuration(() => {
    for (let r = 0; r < REPS; r++) getEdgesAtPath(smallFlat.edges, []);
  });
  const tLargeEdges = measureMedianDuration(() => {
    for (let r = 0; r < REPS; r++) getEdgesAtPath(largeFlat.edges, []);
  });
  const edgeRatio = tLargeEdges / Math.max(0.0001, tSmallEdges);
  assert(edgeRatio < 25, `getEdgesAtPath scales linearly (8x size -> ${edgeRatio.toFixed(2)}x time)`);
}

// 4. computeEffectiveZIndices scaling (O(N))
{
  console.log("\n4. computeEffectiveZIndices Scaling Guard:");
  const makeBoxes = (count: number): ZOrderBox[] =>
    Array.from({ length: count }, (_, i) => ({
      id: `box-${i}`,
      x: (i % 20) * 100,
      y: Math.floor(i / 20) * 80,
      width: 150 + (i % 5) * 20,
      height: 100 + (i % 3) * 10,
    }));

  const smallBoxes = makeBoxes(50);
  const largeBoxes = makeBoxes(400); // 8x scale

  const REPS = 100;
  const tSmall = measureMedianDuration(() => {
    for (let r = 0; r < REPS; r++) computeEffectiveZIndices(smallBoxes);
  });
  const tLarge = measureMedianDuration(() => {
    for (let r = 0; r < REPS; r++) computeEffectiveZIndices(largeBoxes);
  });

  const ratio = tLarge / Math.max(0.0001, tSmall);
  assert(ratio < 25, `computeEffectiveZIndices scales linearly (8x size -> ${ratio.toFixed(2)}x time)`);
}

// 5. computeAlignment scaling (O(N))
{
  console.log("\n5. computeAlignment Scaling Guard:");
  const makeAlignBoxes = (count: number): AlignBox[] =>
    Array.from({ length: count }, (_, i) => ({
      id: `node-${i}`,
      x: (i % 20) * 200,
      y: Math.floor(i / 20) * 150,
      width: 180,
      height: 120,
    }));

  const movingBox: AlignBox = { id: "moving", x: 205, y: 155, width: 180, height: 120 };
  const smallCandidates = makeAlignBoxes(50);
  const largeCandidates = makeAlignBoxes(400); // 8x scale

  const REPS = 200;
  const tSmall = measureMedianDuration(() => {
    for (let r = 0; r < REPS; r++) computeAlignment(movingBox, smallCandidates);
  });
  const tLarge = measureMedianDuration(() => {
    for (let r = 0; r < REPS; r++) computeAlignment(movingBox, largeCandidates);
  });

  const ratio = tLarge / Math.max(0.0001, tSmall);
  assert(ratio < 25, `computeAlignment scales linearly with candidates (8x size -> ${ratio.toFixed(2)}x time)`);
}

// 6. buildOrthogonalRoute and getSegmentInsertions scaling (O(W))
{
  console.log("\n6. buildOrthogonalRoute & getSegmentInsertions Scaling Guard:");
  const makePoints = (count: number): Point[] =>
    Array.from({ length: count }, (_, i) => ({
      x: (i + 1) * 100,
      y: ((i % 2) + 1) * 150,
    }));

  const source: Point = { x: 0, y: 0 };
  const target: Point = { x: 2000, y: 2000 };
  const smallWaypoints = makePoints(4);
  const largeWaypoints = makePoints(32); // 8x scale

  const REPS = 200;
  const tSmallRoute = measureMedianDuration(() => {
    for (let r = 0; r < REPS; r++) {
      buildOrthogonalRoute(source, Position.Right, smallWaypoints, target, Position.Left);
    }
  });
  const tLargeRoute = measureMedianDuration(() => {
    for (let r = 0; r < REPS; r++) {
      buildOrthogonalRoute(source, Position.Right, largeWaypoints, target, Position.Left);
    }
  });
  const routeRatio = tLargeRoute / Math.max(0.0001, tSmallRoute);
  assert(routeRatio < 25, `buildOrthogonalRoute scales linearly in waypoints (8x size -> ${routeRatio.toFixed(2)}x time)`);

  const tSmallInsertions = measureMedianDuration(() => {
    for (let r = 0; r < REPS; r++) {
      getSegmentInsertions(source, Position.Right, smallWaypoints, target, Position.Left);
    }
  });
  const tLargeInsertions = measureMedianDuration(() => {
    for (let r = 0; r < REPS; r++) {
      getSegmentInsertions(source, Position.Right, largeWaypoints, target, Position.Left);
    }
  });
  const insertRatio = tLargeInsertions / Math.max(0.0001, tSmallInsertions);
  assert(insertRatio < 25, `getSegmentInsertions scales linearly in waypoints (8x size -> ${insertRatio.toFixed(2)}x time)`);
}

// 7. getContainmentRelation scaling (O(D))
{
  console.log("\n7. getContainmentRelation Scaling Guard:");
  // Parent hierarchy map: node-k -> node-(k-1) -> ... -> root
  const makeParentMap = () => {
    const parentOf = (id: string): string | undefined => {
      const match = id.match(/node-(\d+)/);
      if (!match) return undefined;
      const num = parseInt(match[1], 10);
      return num > 0 ? `node-${num - 1}` : undefined;
    };
    return parentOf;
  };

  const parentMap = makeParentMap();

  const REPS = 500;
  const tSmall = measureMedianDuration(() => {
    for (let r = 0; r < REPS; r++) {
      getContainmentRelation("node-0", "node-4", parentMap);
    }
  });
  const tLarge = measureMedianDuration(() => {
    for (let r = 0; r < REPS; r++) {
      getContainmentRelation("node-0", "node-32", parentMap);
    }
  });

  const ratio = tLarge / Math.max(0.0001, tSmall);
  assert(ratio < 25, `getContainmentRelation scales linearly with tree depth (8x depth -> ${ratio.toFixed(2)}x time)`);
}

// 8. PERF-L1-5: moveEdgeWaypoint single snapshot rebuild & linear scaling
{
  console.log("\n8. PERF-L1-5 Store Operation Cost Guard:");
  const doc = new Y.Doc();
  const baseFixture = generateSubDiagram({
    nodeCount: 10,
    edgeCount: 10,
    depth: 1,
    waypointFraction: 1.0,
    seed: 88,
  });
  seedYjsDiagramDoc(doc, baseFixture);
  const store = createYjsDiagramStore(doc);

  let rebuildCount = 0;
  store.subscribe(() => {
    rebuildCount++;
  });

  const initialSnapshot = store.getSnapshot();
  const bentEdge = initialSnapshot.edges.find((e) => (e.data?.waypoints?.length ?? 0) > 0)!;
  const firstWaypoint = bentEdge.data!.waypoints![0];

  rebuildCount = 0;
  store.moveEdgeWaypoint(bentEdge.id, firstWaypoint.id, { x: firstWaypoint.x + 10, y: firstWaypoint.y + 10 });

  assert(rebuildCount === 1, `moveEdgeWaypoint triggers exactly 1 snapshot rebuild (actual: ${rebuildCount})`);

  // Assert snapshot rebuild scales linearly in total node count
  const smallDoc = new Y.Doc();
  seedYjsDiagramDoc(smallDoc, generateSubDiagram({ nodeCount: 50, edgeCount: 50, depth: 1, seed: 91 }));
  createYjsDiagramStore(smallDoc);

  const largeDoc = new Y.Doc();
  seedYjsDiagramDoc(largeDoc, generateSubDiagram({ nodeCount: 400, edgeCount: 400, depth: 1, seed: 91 })); // 8x scale
  createYjsDiagramStore(largeDoc);

  const REPS = 50;
  const tSmall = measureMedianDuration(() => {
    for (let r = 0; r < REPS; r++) {
      smallDoc.transact(() => {
        smallDoc.getMap("nodes").set("dummy-trigger", new Y.Map());
        smallDoc.getMap("nodes").delete("dummy-trigger");
      });
    }
  });

  const tLarge = measureMedianDuration(() => {
    for (let r = 0; r < REPS; r++) {
      largeDoc.transact(() => {
        largeDoc.getMap("nodes").set("dummy-trigger", new Y.Map());
        largeDoc.getMap("nodes").delete("dummy-trigger");
      });
    }
  });

  const ratio = tLarge / Math.max(0.0001, tSmall);
  assert(ratio < 30, `Yjs snapshot rebuild scales sub-quadratically in node count (8x size -> ${ratio.toFixed(2)}x time)`);
}

console.log("\n==================================================");
console.log(`Layer 1 Verification: ${passedCount} passed, ${failedCount} failed`);
console.log("==================================================\n");

if (failedCount > 0) {
  throw new Error(`Layer 1 Verification failed with ${failedCount} failure(s)`);
}
