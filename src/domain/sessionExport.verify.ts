import * as Y from "yjs";
import { createYjsDiagramStore, seedYjsDiagramDoc } from "../collab/yjsDiagramStore";
import { createYjsRequirementsStore, seedYjsRequirementsDoc } from "../collab/yjsRequirementsStore";
import { unflattenToSubDiagram } from "../collab/diagramStore";
import { toDiagramFile } from "./serialization";
import { toMarkdownDocument } from "./requirementsExport";
import { EMPTY_TEAM_DOCUMENT } from "./teamTypes";
import type { SubDiagram } from "./types";
import type { RequirementsDocument } from "./requirementsTypes";

import { BUILT_IN_ITEM_TYPES, BUILT_IN_RELATIONSHIP_TYPES } from "./requirementsRegistry";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
  console.log(`ok: ${message}`);
}

function testSessionExportIncludesSessionChanges() {
  // 1. Initial state before session
  const initialRoot: SubDiagram = {
    nodes: [
      {
        id: "node-1",
        type: "typed",
        position: { x: 100, y: 100 },
        data: {
          nodeType: "custom",
          label: "Initial Node",
          description: "",
          properties: {},
          tags: [],
        },
      },
    ],
    edges: [],
  };

  const initialReqs: RequirementsDocument = {
    items: [],
    categories: [],
    itemTypes: BUILT_IN_ITEM_TYPES,
    relationshipTypes: BUILT_IN_RELATIONSHIP_TYPES,
    relationships: [],
    nextSequence: {},
  };

  // 2. Start a session
  const doc = new Y.Doc();
  seedYjsDiagramDoc(doc, initialRoot);
  seedYjsRequirementsDoc(doc, initialReqs);

  const diagramStore = createYjsDiagramStore(doc);
  const requirementsStore = createYjsRequirementsStore(doc);

  // 3. Make changes during session: add node-2 and requirement-1
  diagramStore.addNode([], "typed", { x: 200, y: 200 }, {
    nodeType: "custom",
    label: "Session Node",
    description: "Added during session",
    properties: {},
    tags: [],
  });

  const reqId = requirementsStore.addItem("requirement");
  requirementsStore.updateItem(reqId, { title: "Session Requirement", body: "Req body" });

  // 4. Derive live state from stores (simulating App.tsx liveRoot and requirementsSnapshot)
  const diagramSnapshot = diagramStore.getSnapshot();
  const requirementsSnapshot = requirementsStore.getSnapshot();
  const liveRoot = unflattenToSubDiagram(diagramSnapshot.nodes, diagramSnapshot.edges);

  // 5. Serialize diagram to file
  const exportedFile = toDiagramFile(
    "Test Diagram",
    liveRoot.nodes,
    liveRoot.edges,
    [],
    requirementsSnapshot,
    [],
    EMPTY_TEAM_DOCUMENT,
    []
  );

  assert(exportedFile.nodes.length === 2, "exported diagram contains both initial node and node added during session");
  assert(
    exportedFile.nodes.some((n) => n.data.label === "Session Node"),
    "exported diagram contains the node added during collaborative session"
  );
  assert(
    exportedFile.requirements.items.length === 1,
    "exported diagram contains requirement added during session"
  );

  // 6. Export requirements markdown
  const markdown = toMarkdownDocument("Test Diagram", requirementsSnapshot);
  assert(markdown.includes("Session Requirement"), "exported markdown includes requirement added during session");
}

testSessionExportIncludesSessionChanges();
console.log("\nALL SESSION EXPORT TESTS PASSED\n");
