/**
 * Run with: npx tsx --tsconfig tsconfig.app.json src/domain/diagramDocumentation.verify.ts
 */
import {
  hasDocumentation,
  formatPropertyValue,
  extractNodeDocumentation,
  extractEdgeDocumentation,
  computeDocumentationPopupPosition,
} from "./diagramDocumentation";
import type { Node, Edge } from "@xyflow/react";
import type { ArchNodeData, ArchEdgeData } from "./types";

let failures = 0;
function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`ok: ${message}`);
  } else {
    failures++;
    console.error(`FAIL: ${message}`);
  }
}

// === Requirement TR-003 & Section 9 Unit Tests: hasDocumentation ===

// 1. undefined or null documentation returns false
assert(!hasDocumentation(undefined), "hasDocumentation returns false for undefined documentation");
assert(!hasDocumentation({}), "hasDocumentation returns false for empty documentation object");

// 2. empty descriptions, properties, and tags return false
assert(
  !hasDocumentation({ description: "", properties: {}, tags: [] }),
  "hasDocumentation returns false for empty strings, objects, arrays"
);
assert(
  !hasDocumentation({ description: "   \n\t  ", properties: { " ": " " }, tags: ["", "  "] }),
  "hasDocumentation returns false for whitespace-only description, properties, and tags"
);
assert(
  !hasDocumentation({ properties: { key: "", emptyObj: {}, emptyArr: [] } }),
  "hasDocumentation returns false for properties with only empty values"
);

// 3. hasDocumentation returns true for each supported content type individually
assert(
  hasDocumentation({ description: "Valid service description" }),
  "hasDocumentation returns true for non-empty description"
);
assert(
  hasDocumentation({ tags: ["production"] }),
  "hasDocumentation returns true for non-empty tags"
);
assert(
  hasDocumentation({ properties: { Port: 443 } }),
  "hasDocumentation returns true for number property"
);
assert(
  hasDocumentation({ properties: { Enabled: true } }),
  "hasDocumentation returns true for boolean property (true)"
);
assert(
  hasDocumentation({ properties: { Disabled: false } }),
  "hasDocumentation returns true for boolean property (false)"
);
assert(
  hasDocumentation({ properties: { Protocol: "HTTPS" } }),
  "hasDocumentation returns true for string property"
);
assert(
  hasDocumentation({ properties: { Config: { timeout: 30 } } }),
  "hasDocumentation returns true for non-empty object property"
);

// === Requirement TR-005: Property formatting ===
assert(formatPropertyValue("text") === "text", "formatPropertyValue formats string correctly");
assert(formatPropertyValue(443) === "443", "formatPropertyValue formats number correctly");
assert(formatPropertyValue(true) === "true", "formatPropertyValue formats boolean true");
assert(formatPropertyValue(false) === "false", "formatPropertyValue formats boolean false");
assert(formatPropertyValue(null) === "null", "formatPropertyValue formats null correctly");
assert(formatPropertyValue(["a", "b", "c"]) === "a, b, c", "formatPropertyValue formats array correctly");

// Circular reference safety
const circularObj: Record<string, unknown> = { name: "test" };
circularObj.self = circularObj;
const formattedCircular = formatPropertyValue(circularObj);
assert(typeof formattedCircular === "string" && formattedCircular.includes("[Circular]"), "formatPropertyValue handles circular references safely without throwing");

// === Extraction tests ===
const sampleNode: Node<ArchNodeData> = {
  id: "node-1",
  type: "typed",
  position: { x: 0, y: 0 },
  data: {
    nodeType: "microservice",
    label: "API Gateway",
    description: "Routes incoming requests",
    properties: { Protocol: "HTTPS", Port: "443" },
    tags: ["Gateway", "Security"],
  },
};

const extractedNode = extractNodeDocumentation(sampleNode);
assert(extractedNode.title === "API Gateway", "extractNodeDocumentation extracts label as title");
assert(extractedNode.subtitle?.includes("Microservice") === true, "extractNodeDocumentation extracts subtitle");
assert(extractedNode.documentation.description === "Routes incoming requests", "extractNodeDocumentation extracts description");
assert(hasDocumentation(extractedNode.documentation), "extractedNodeDocumentation hasDocumentation is true");

const sampleEdge: Edge<ArchEdgeData> = {
  id: "edge-1",
  source: "node-1",
  target: "node-2",
  type: "typed",
  data: {
    edgeType: "sync",
    label: "gRPC Call",
    properties: { Timeout: "5s" },
  },
};

const extractedEdge = extractEdgeDocumentation(sampleEdge);
assert(extractedEdge.title === "gRPC Call", "extractEdgeDocumentation extracts label as title");
assert(hasDocumentation(extractedEdge.documentation), "extractedEdgeDocumentation hasDocumentation is true");

// === Positioning tests ===
const viewport = { width: 1000, height: 800 };
const popupSize = { width: 300, height: 200 };

// Center position
const centerPos = computeDocumentationPopupPosition({ x: 100, y: 100 }, popupSize, viewport, 10);
assert(centerPos.left === 110 && centerPos.top === 110, "computeDocumentationPopupPosition places offset by gap in open space");

// Right edge overflow
const rightEdgePos = computeDocumentationPopupPosition({ x: 950, y: 100 }, popupSize, viewport, 10);
assert(rightEdgePos.left < 950, "computeDocumentationPopupPosition adjusts left position near right edge");

// Bottom edge overflow
const bottomEdgePos = computeDocumentationPopupPosition({ x: 100, y: 750 }, popupSize, viewport, 10);
assert(bottomEdgePos.top < 750, "computeDocumentationPopupPosition flips above near bottom edge");

console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILURE(S)`);
if (failures > 0) throw new Error(`${failures} test(s) failed`);
