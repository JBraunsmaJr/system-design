import type { Node, Edge } from "@xyflow/react";
import type { ArchNodeData, ArchEdgeData } from "./types";
import { EMPTY_REQUIREMENTS_DOCUMENT } from "./requirementsTypes";
import { EMPTY_TEAM_DOCUMENT } from "./teamTypes";
import { toDiagramFile, parseDiagramFile } from "./serialization";
import { globalShapeRegistry, type ShapeDefinition } from "./shapeRegistry";
import { globalIconRegistry, type IconDefinition } from "./iconRegistry";
import { globalAssetLibraryManager, type AssetLibrary } from "./assetLibrary";

let failures = 0;
function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  ✓ ${message}`);
  } else {
    failures++;
    console.error(`  FAIL: ${message}`);
  }
}

console.log("=== 1. Testing Diagram Serialization with Asset Fallbacks ===");
{
  // 1. Create a custom icon
  const customIcon: IconDefinition = {
    id: "acme.payment-hub",
    name: "Acme Payment Hub",
    category: "Acme Assets",
    version: 1,
    source: {
      type: "svg",
      data: '<svg viewBox="0 0 24 24"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>',
    },
    libraryId: "acme-lib",
  };
  globalIconRegistry.registerIcon(customIcon);

  // 2. Create a custom shape
  const customShape: ShapeDefinition = {
    id: "acme.payment-service",
    name: "Payment Service",
    category: "Acme Assets",
    version: 1,
    geometry: { type: "rounded-rectangle", radius: 10 },
    defaults: { width: 180, height: 110, color: "#0FA36B" },
    iconId: "acme.payment-hub",
    libraryId: "acme-lib",
  };
  globalShapeRegistry.registerShape(customShape);

  // 3. Place node on diagram referencing the custom shape
  const nodes: Node<ArchNodeData>[] = [
    {
      id: "node-payment-1",
      type: "shape",
      position: { x: 100, y: 100 },
      data: {
        nodeType: "acme.payment-service",
        label: "Payment Cluster",
        properties: { env: "production" },
        tags: ["pci", "banking"],
        icon: "acme.payment-hub",
      },
    },
  ];

  // 4. Save diagram
  const file = toDiagramFile("Acme Architecture", nodes, [], [], EMPTY_REQUIREMENTS_DOCUMENT, [], EMPTY_TEAM_DOCUMENT);
  assert(file.shapeFallbacks !== undefined, "toDiagramFile generates shapeFallbacks");
  assert(file.shapeFallbacks?.["acme.payment-service"] !== undefined, "shapeFallbacks contains 'acme.payment-service'");
  assert(file.iconFallbacks !== undefined, "toDiagramFile generates iconFallbacks");
  assert(file.iconFallbacks?.["acme.payment-hub"] !== undefined, "iconFallbacks contains 'acme.payment-hub'");

  // 5. Simulate opening in a clean environment without 'acme-lib'
  globalShapeRegistry.unregisterShape("acme.payment-service");
  globalIconRegistry.unregisterIcon("acme.payment-hub");
  assert(globalShapeRegistry.getShape("acme.payment-service") === undefined, "Shape absent prior to loading");
  assert(globalIconRegistry.getIcon("acme.payment-hub") === undefined, "Icon absent prior to loading");

  const serializedString = JSON.stringify(file);
  const loaded = parseDiagramFile(serializedString);

  assert(loaded.nodes.length === 1, "Loaded diagram has 1 node");
  assert(globalShapeRegistry.getShape("acme.payment-service") !== undefined, "Shape fallback automatically restored in registry");
  assert(globalIconRegistry.getIcon("acme.payment-hub") !== undefined, "Icon fallback automatically restored in registry");
  assert(globalShapeRegistry.getShape("acme.payment-service")?.name === "Payment Service", "Restored shape retains name");
}

console.log("\n=== 2. Testing Definition of Done Workflow (Requirements Section 21) ===");
{
  // Step 1-4: Create custom library and add SVG icon
  const myLib: AssetLibrary = {
    format: "system-design-library",
    version: 1,
    library: {
      id: "fintech-core",
      name: "Fintech Core",
      description: "Core banking shapes and icons",
      version: 1,
    },
    icons: [
      {
        id: "fintech.ledger",
        name: "Ledger Icon",
        category: "Banking",
        tags: ["ledger", "blockchain", "accounting"],
        version: 1,
        source: {
          type: "svg",
          data: '<svg viewBox="0 0 24 24"><path d="M4 4 h16 v16 h-16 Z"/></svg>',
        },
      },
    ],
    shapes: [
      {
        id: "fintech.ledger-node",
        name: "Ledger Node",
        category: "Banking",
        tags: ["ledger", "immutability"],
        version: 1,
        geometry: { type: "hexagon" },
        defaults: { width: 150, height: 100, color: "#9061F9" },
        iconId: "fintech.ledger",
      },
    ],
    enabled: true,
  };

  globalAssetLibraryManager.addOrUpdateLibrary(myLib);

  // Step 5-7: Search and select custom icon
  const foundIcons = globalIconRegistry.searchIcons("ledger");
  assert(foundIcons.length > 0 && foundIcons[0].id === "fintech.ledger", "Found custom icon via search");

  // Step 8-12: Place shape on diagram and connect nodes
  const testNodes: Node<ArchNodeData>[] = [
    {
      id: "ledger-1",
      type: "shape",
      position: { x: 50, y: 50 },
      data: {
        nodeType: "fintech.ledger-node",
        label: "Main Ledger",
        properties: {},
        tags: [],
      },
    },
    {
      id: "client-1",
      type: "typed",
      position: { x: 300, y: 50 },
      data: {
        nodeType: "client",
        label: "Mobile App",
        properties: {},
        tags: [],
      },
    },
  ];

  const testEdges: Edge<ArchEdgeData>[] = [
    {
      id: "edge-1",
      source: "client-1",
      target: "ledger-1",
      data: {
        edgeType: "sync",
        label: "Post Transaction",
        properties: {},
      },
    },
  ];

  // Step 13-15: Save and reload
  const diagramFile = toDiagramFile("Fintech Diagram", testNodes, testEdges, [], EMPTY_REQUIREMENTS_DOCUMENT, [], EMPTY_TEAM_DOCUMENT);
  const reloaded = parseDiagramFile(JSON.stringify(diagramFile));

  assert(reloaded.nodes.length === 2, "Diagram reloaded with 2 nodes");
  assert(reloaded.edges.length === 1, "Diagram reloaded with 1 edge");
  assert(reloaded.edges[0].data?.label === "Post Transaction", "Edge connection preserved");

  // Clean up
  globalAssetLibraryManager.deleteLibrary("fintech-core");
}

console.log("\n--------------------------------------------------");
if (failures === 0) {
  console.log("All AssetSerialization tests passed successfully!\n");
} else {
  throw new Error(`${failures} failure(s) in AssetSerialization tests.`);
}
