import type { Node, Edge } from "@xyflow/react";
import type { ArchNodeData, ArchEdgeData, SubDiagram, EdgeWaypoint } from "../domain/types";

/**
 * Deterministic pseudo-random number generator (Mulberry32).
 * Guarantees cross-platform, byte-identical sequences for a given seed.
 */
export function createPrng(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type FixtureName = "small" | "medium" | "large" | "nested" | "grouped";

export interface FixtureOptions {
  seed?: number;
  nodeCount: number;
  edgeCount: number;
  depth?: number;
  groupCount?: number;
  waypointFraction?: number;
  ensureHubNode?: boolean;
}

const NODE_TYPES = [
  "microservice",
  "database",
  "cache",
  "queue",
  "gateway",
  "storage",
  "serverless",
  "pubsub",
];

const EDGE_TYPES = ["sync", "async", "grpc", "event", "sql", "cache-read"];

/**
 * Generates a deterministic SubDiagram model with seeded PRNG.
 */
export function generateSubDiagram(options: FixtureOptions): SubDiagram {
  const seed = options.seed ?? 42;
  const rand = createPrng(seed);
  const depth = options.depth ?? 1;
  const waypointFraction = options.waypointFraction ?? 0.2;
  const groupCount = options.groupCount ?? 0;

  if (depth > 1) {
    return generateNestedDiagram(options, rand);
  }

  return generateFlatDiagram(options, rand, groupCount, waypointFraction);
}

function generateFlatDiagram(
  options: FixtureOptions,
  rand: () => number,
  groupCount: number,
  waypointFraction: number
): SubDiagram {
  const nodes: Node<ArchNodeData>[] = [];
  const edges: Edge<ArchEdgeData>[] = [];

  const groups: Node<ArchNodeData>[] = [];
  const groupIds: string[] = [];

  // 1. Create groups/boundaries if requested
  for (let g = 0; g < groupCount; g++) {
    const groupId = `group-${g}`;
    groupIds.push(groupId);
    const col = g % 4;
    const row = Math.floor(g / 4);
    const x = col * 900;
    const y = row * 700;
    const width = 800;
    const height = 600;

    groups.push({
      id: groupId,
      type: "group",
      position: { x, y },
      width,
      height,
      data: {
        nodeType: "boundary",
        label: `Boundary ${g + 1}`,
        description: `Group container ${g + 1}`,
        properties: { env: "prod", boundary: `tier-${g}` },
        tags: ["boundary", `group-${g}`],
      },
    });
  }

  // 2. Create standard nodes
  const totalNodes = options.nodeCount;
  for (let i = 0; i < totalNodes; i++) {
    const nodeId = `node-${i}`;
    let parentId: string | undefined;
    let position = { x: (i % 20) * 220 + 50, y: Math.floor(i / 20) * 160 + 50 };

    if (groups.length > 0) {
      // Distribute nodes among groups to ensure >=10 children in key groups (e.g., group-0)
      if (i < 15) {
        parentId = groupIds[0];
        position = { x: (i % 3) * 220 + 40, y: Math.floor(i / 3) * 110 + 40 };
      } else if (i < groupCount * 8) {
        const assignedGroup = groupIds[i % groupCount];
        parentId = assignedGroup;
        const subIndex = Math.floor(i / groupCount);
        position = { x: (subIndex % 3) * 220 + 40, y: Math.floor(subIndex / 3) * 110 + 40 };
      }
    }

    const typeIdx = Math.floor(rand() * NODE_TYPES.length);
    const nodeType = NODE_TYPES[typeIdx];

    nodes.push({
      id: nodeId,
      type: "typed",
      position,
      parentId,
      data: {
        nodeType,
        label: `Service ${i + 1}`,
        description: `Description for service node ${i + 1}`,
        properties: {
          runtime: "node",
          version: `1.${i % 9}.0`,
          tier: parentId ? "grouped" : "standalone",
        },
        tags: ["service", `type-${nodeType}`],
      },
    });
  }

  // Combine groups and nodes (groups first)
  const allNodes = [...groups, ...nodes];

  // 3. Create edges
  const totalEdges = options.edgeCount;
  const nodeCount = nodes.length;
  if (nodeCount >= 2) {
    let edgeIdx = 0;

    // If hub node requested, attach >=25 edges to node-0
    if (options.ensureHubNode && nodeCount >= 30) {
      const hubId = nodes[0].id;
      const hubEdgeCount = Math.min(28, totalEdges);
      for (let h = 1; h <= hubEdgeCount; h++) {
        const targetId = nodes[h].id;
        const isBent = h === 1 || rand() < waypointFraction;
        const waypoints = isBent ? generateWaypoints(rand, edgeIdx) : undefined;
        edges.push({
          id: `edge-hub-${h}`,
          source: hubId,
          target: targetId,
          type: "typed",
          data: {
            edgeType: EDGE_TYPES[edgeIdx % EDGE_TYPES.length],
            label: `Hub Traffic ${h}`,
            direction: "forward",
            waypoints,
            properties: { protocol: "tcp" },
          },
        });
        edgeIdx++;
      }
    }

    while (edgeIdx < totalEdges) {
      const srcIdx = Math.floor(rand() * nodeCount);
      let dstIdx = Math.floor(rand() * nodeCount);
      if (srcIdx === dstIdx) {
        dstIdx = (srcIdx + 1) % nodeCount;
      }
      const isBent = rand() < waypointFraction;
      const waypoints = isBent ? generateWaypoints(rand, edgeIdx) : undefined;

      edges.push({
        id: `edge-${edgeIdx}`,
        source: nodes[srcIdx].id,
        target: nodes[dstIdx].id,
        type: "typed",
        data: {
          edgeType: EDGE_TYPES[edgeIdx % EDGE_TYPES.length],
          label: `Traffic ${edgeIdx + 1}`,
          direction: "forward",
          waypoints,
          properties: { protocol: "https", timeoutMs: "5000" },
        },
      });
      edgeIdx++;
    }
  }

  return { nodes: allNodes, edges };
}

function generateWaypoints(rand: () => number, edgeIdx: number): EdgeWaypoint[] {
  const count = 1 + Math.floor(rand() * 3); // 1 to 3 waypoints
  const waypoints: EdgeWaypoint[] = [];
  for (let w = 0; w < count; w++) {
    waypoints.push({
      id: `wp-fixture-${edgeIdx}-${w}`,
      x: Math.round(rand() * 1000 + 100),
      y: Math.round(rand() * 800 + 100),
    });
  }
  return waypoints;
}

function generateNestedDiagram(options: FixtureOptions, rand: () => number): SubDiagram {
  const totalNodes = options.nodeCount;
  const totalEdges = options.edgeCount;
  const depth = options.depth ?? 4;
  const waypointFraction = options.waypointFraction ?? 0.2;

  // Distribute nodes and edges across 4 levels (root + 3 nested levels)
  const nodesPerLevel = Math.floor(totalNodes / depth);
  const edgesPerLevel = Math.floor(totalEdges / depth);

  function buildLevel(currentDepth: number, prefix: string): SubDiagram {
    const isLeaf = currentDepth >= depth;
    const levelNodeCount = isLeaf
      ? totalNodes - nodesPerLevel * (depth - 1)
      : nodesPerLevel;
    const levelEdgeCount = isLeaf
      ? totalEdges - edgesPerLevel * (depth - 1)
      : edgesPerLevel;

    const nodes: Node<ArchNodeData>[] = [];
    const edges: Edge<ArchEdgeData>[] = [];

    for (let i = 0; i < levelNodeCount; i++) {
      const nodeId = `${prefix}node-${i}`;
      const typeIdx = Math.floor(rand() * NODE_TYPES.length);
      const nodeType = NODE_TYPES[typeIdx];

      let childSubDiagram: SubDiagram | undefined;
      // First node at each non-leaf level has nested subdiagram
      if (!isLeaf && i === 0) {
        childSubDiagram = buildLevel(currentDepth + 1, `${nodeId}-child-`);
      }

      nodes.push({
        id: nodeId,
        type: "typed",
        position: { x: (i % 10) * 220 + 50, y: Math.floor(i / 10) * 160 + 50 },
        data: {
          nodeType,
          label: `Level ${currentDepth} Service ${i + 1}`,
          description: `Nested diagram node at depth ${currentDepth}`,
          subDiagram: childSubDiagram,
          hasSubDiagram: !!childSubDiagram,
          properties: { depth: String(currentDepth) },
          tags: [`depth-${currentDepth}`],
        },
      });
    }

    for (let e = 0; e < levelEdgeCount && levelNodeCount >= 2; e++) {
      const srcIdx = e % levelNodeCount;
      const dstIdx = (e + 1) % levelNodeCount;
      const isBent = rand() < waypointFraction;
      const waypoints = isBent ? generateWaypoints(rand, e) : undefined;

      edges.push({
        id: `${prefix}edge-${e}`,
        source: nodes[srcIdx].id,
        target: nodes[dstIdx].id,
        type: "typed",
        data: {
          edgeType: EDGE_TYPES[e % EDGE_TYPES.length],
          label: `Edge L${currentDepth}-${e}`,
          direction: "forward",
          waypoints,
          properties: { depth: String(currentDepth) },
        },
      });
    }

    return { nodes, edges };
  }

  return buildLevel(1, "");
}

/**
 * Standard named fixture configurations (PERF-W-2).
 */
export const STANDARD_FIXTURE_CONFIGS: Record<FixtureName, FixtureOptions> = {
  small: {
    seed: 101,
    nodeCount: 25,
    edgeCount: 30,
    depth: 1,
    waypointFraction: 0.2,
  },
  medium: {
    seed: 202,
    nodeCount: 150,
    edgeCount: 220,
    depth: 1,
    waypointFraction: 0.2,
  },
  large: {
    seed: 303,
    nodeCount: 400,
    edgeCount: 600,
    depth: 1,
    waypointFraction: 0.2,
    ensureHubNode: true,
  },
  nested: {
    seed: 404,
    nodeCount: 300,
    edgeCount: 400,
    depth: 4,
    waypointFraction: 0.2,
  },
  grouped: {
    seed: 505,
    nodeCount: 200,
    edgeCount: 250,
    groupCount: 20,
    depth: 1,
    waypointFraction: 0.2,
  },
};

/**
 * Loads or generates a standard named fixture.
 */
export function getStandardFixture(name: FixtureName): SubDiagram {
  const config = STANDARD_FIXTURE_CONFIGS[name];
  if (!config) {
    throw new Error(`Unknown standard fixture: ${name}`);
  }
  return generateSubDiagram(config);
}
