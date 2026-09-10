/**
 * Run with: npx tsx --tsconfig tsconfig.app.json src/components/documentation/useDiagramHoverDocumentation.verify.ts
 */
import type { Node, Edge } from "@xyflow/react";
import type { ArchNodeData, ArchEdgeData } from "../../domain/types";
import {
  hasDocumentation,
  extractNodeDocumentation,
  extractEdgeDocumentation,
  DEFAULT_HOVER_DELAY,
  DEFAULT_LEAVE_DELAY,
} from "../../domain/diagramDocumentation";

let failures = 0;
function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`ok: ${message}`);
  } else {
    failures++;
    console.error(`FAIL: ${message}`);
  }
}

// === Interaction & Lifecycle Simulation Tests ===

const node1: Node<ArchNodeData> = {
  id: "node-1",
  type: "typed",
  position: { x: 50, y: 50 },
  data: {
    nodeType: "microservice",
    label: "Auth Service",
    description: "Handles JWT authentication",
    properties: { Port: "8080", RateLimit: "100req/s" },
    tags: ["Auth", "Core"],
  },
};

const node2: Node<ArchNodeData> = {
  id: "node-2",
  type: "typed",
  position: { x: 200, y: 50 },
  data: {
    nodeType: "database",
    label: "User DB",
    description: "PostgreSQL Database",
    properties: { Engine: "PostgreSQL 15" },
    tags: ["Data"],
  },
};

const emptyNode: Node<ArchNodeData> = {
  id: "node-empty",
  type: "typed",
  position: { x: 350, y: 50 },
  data: {
    nodeType: "custom",
    label: "Empty Node",
    description: "   ",
    properties: {},
    tags: [],
  },
};

const edge1: Edge<ArchEdgeData> = {
  id: "edge-1",
  source: "node-1",
  target: "node-2",
  type: "typed",
  data: {
    edgeType: "sync",
    label: "DB Connection",
    properties: { PoolSize: "10" },
  },
};

// 1. Hover target selection and extraction
{
  const doc1 = extractNodeDocumentation(node1);
  assert(hasDocumentation(doc1.documentation), "node1 has documentation");
  assert(doc1.title === "Auth Service", "node1 title is Auth Service");
  assert(doc1.documentation.properties?.Port === "8080", "node1 properties extracted");

  const docEmpty = extractNodeDocumentation(emptyNode);
  assert(!hasDocumentation(docEmpty.documentation), "emptyNode hasDocumentation is false");

  const docEdge = extractEdgeDocumentation(edge1);
  assert(hasDocumentation(docEdge.documentation), "edge1 has documentation");
  assert(docEdge.title === "DB Connection", "edge1 title is DB Connection");
}

// 2. Timing constants
assert(DEFAULT_HOVER_DELAY === 300, "DEFAULT_HOVER_DELAY is 300ms");
assert(DEFAULT_LEAVE_DELAY === 150, "DEFAULT_LEAVE_DELAY is 150ms");

// 3. Live updates: changing node properties updates extracted documentation
{
  const updatedNode: Node<ArchNodeData> = {
    ...node1,
    data: {
      ...node1.data,
      description: "Updated description for auth service",
      properties: { Port: "9090" },
    },
  };
  const updatedDoc = extractNodeDocumentation(updatedNode);
  assert(
    updatedDoc.documentation.description === "Updated description for auth service",
    "Live updates reflect new description"
  );
  assert(
    updatedDoc.documentation.properties?.Port === "9090",
    "Live updates reflect new properties"
  );
}

// 4. Switching between two documented elements
{
  const extracted1 = extractNodeDocumentation(node1);
  const extracted2 = extractNodeDocumentation(node2);
  assert(extracted1.title !== extracted2.title, "Elements have distinct documentation");
  assert(extracted2.title === "User DB", "node2 documentation extracted correctly");
}

// 5. Test interaction lifecycle and edge cases
{
  const extractedDoc = extractNodeDocumentation(node1);
  assert(hasDocumentation(extractedDoc.documentation), "Extracted node1 documentation is valid and meaningful");

  const emptyDoc = extractNodeDocumentation(emptyNode);
  assert(!hasDocumentation(emptyDoc.documentation), "Empty node documentation is not meaningful");
}

console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILURE(S)`);
if (failures > 0) throw new Error(`${failures} test(s) failed`);
