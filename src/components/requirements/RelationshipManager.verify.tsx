/**
 * Run with: npx tsx --tsconfig tsconfig.app.json src/components/requirements/RelationshipManager.verify.tsx
 */
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { RelationshipManager } from "./RelationshipManager";
import {
  BUILT_IN_ITEM_TYPES,
  BUILT_IN_RELATIONSHIP_TYPES,
} from "../../domain/requirementsRegistry";
import type { RequirementsDocument } from "../../domain/requirementsTypes";

let failures = 0;
function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`ok: ${message}`);
  } else {
    failures++;
    console.error(`FAIL: ${message}`);
  }
}

const testDoc: RequirementsDocument = {
  itemTypes: BUILT_IN_ITEM_TYPES,
  categories: [],
  relationshipTypes: BUILT_IN_RELATIONSHIP_TYPES,
  items: [
    { id: "REQ-1", typeId: "requirement", title: "First Requirement", body: "" },
    { id: "GOAL-1", typeId: "goal", title: "Main Goal", body: "" },
    { id: "DEP-1", typeId: "dependency", title: "Database Dependency", body: "" },
    { id: "CON-1", typeId: "constraint", title: "Time Constraint", body: "" },
  ],
  relationships: [
    { id: "rel-1", typeId: "blocks", fromItemId: "REQ-1", toItemId: "DEP-1" },
  ],
  nextSequence: {},
};

// === Test 1: Renders trigger button and existing relationships ===
{
  const html = renderToStaticMarkup(
    React.createElement(RelationshipManager, {
      itemId: "REQ-1",
      doc: testDoc,
      onAddRelationship: () => null,
      onDeleteRelationship: () => {},
      onNavigateToItem: () => {},
    })
  );

  assert(html.includes("Add relationship"), "renders 'Add relationship' button");
  assert(html.includes("Blocks"), "renders existing relationship group verb 'Blocks'");
  assert(html.includes("DEP-1: Database Dependency"), "renders existing target item chip");
}

// === Test 2: Renders for target item with inverse relationship label ===
{
  const html = renderToStaticMarkup(
    React.createElement(RelationshipManager, {
      itemId: "DEP-1",
      doc: testDoc,
      onAddRelationship: () => null,
      onDeleteRelationship: () => {},
      onNavigateToItem: () => {},
    })
  );

  assert(html.includes("Is blocked by"), "renders inverse label 'Is blocked by' from target side");
  assert(html.includes("REQ-1: First Requirement"), "renders linked item chip on target side");
}

console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILURE(S)`);
if (failures > 0) {
  throw new Error(`${failures} test(s) failed`);
}
