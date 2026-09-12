/**
 * Run with: npx tsx --tsconfig tsconfig.app.json src/components/Inspector.verify.tsx
 */
import { renderToStaticMarkup } from "react-dom/server";
import { Inspector } from "./Inspector";
import type { Edge } from "@xyflow/react";
import type { ArchEdgeData } from "../domain/types";
import { EMPTY_REQUIREMENTS_DOCUMENT } from "../domain/requirementsTypes";

let failures = 0;
function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`ok: ${message}`);
  } else {
    failures++;
    console.error(`FAIL: ${message}`);
  }
}

// 1. Inspector with selected edge having no waypoints
{
  const edge: Edge<ArchEdgeData> = {
    id: "e1",
    source: "n1",
    target: "n2",
    data: {
      edgeType: "generic",
      label: "My Edge",
      direction: "forward",
      properties: {},
    },
  };

  const html = renderToStaticMarkup(
    <Inspector
      selectedNode={null}
      selectedEdge={edge}
      onUpdateNode={() => {}}
      onUpdateEdge={() => {}}
      onClearEdgeWaypoints={() => {}}
      onRemoveEdgeWaypoint={() => {}}
      onDeleteNode={() => {}}
      onDeleteEdge={() => {}}
      onDrillInto={() => {}}
      requirements={EMPTY_REQUIREMENTS_DOCUMENT}
      onNavigateToRequirement={() => {}}
      onZOrderCommand={() => {}}
    />
  );

  assert(html.includes("Inspector") || html.includes("Edge"), "Renders Edge panel header");
  assert(!html.includes("Bends / Waypoints"), "Does not render waypoint section when no waypoints");
}

// 2. Inspector with selected edge having waypoints renders list and individual remove buttons
{
  const edgeWithWaypoints: Edge<ArchEdgeData> = {
    id: "e2",
    source: "n1",
    target: "n2",
    data: {
      edgeType: "generic",
      label: "Connected",
      direction: "forward",
      properties: {},
      waypoints: [
        { id: "wp-1", x: 120, y: 250 },
        { id: "wp-2", x: 340, y: 250 },
      ],
    },
  };

  const html = renderToStaticMarkup(
    <Inspector
      selectedNode={null}
      selectedEdge={edgeWithWaypoints}
      onUpdateNode={() => {}}
      onUpdateEdge={() => {}}
      onClearEdgeWaypoints={() => {}}
      onRemoveEdgeWaypoint={() => {}}
      onDeleteNode={() => {}}
      onDeleteEdge={() => {}}
      onDrillInto={() => {}}
      requirements={EMPTY_REQUIREMENTS_DOCUMENT}
      onNavigateToRequirement={() => {}}
      onZOrderCommand={() => {}}
    />
  );

  assert(html.includes("Bends / Waypoints (2)"), "Renders waypoints header with count");
  assert(html.includes("Bend 1"), "Renders Bend 1 label");
  assert(html.includes("(120, 250)"), "Renders Bend 1 coordinates");
  assert(html.includes("Bend 2"), "Renders Bend 2 label");
  assert(html.includes("(340, 250)"), "Renders Bend 2 coordinates");
  assert(html.includes('aria-label="Remove Bend 1"'), "Renders accessible remove button for Bend 1");
  assert(html.includes('aria-label="Remove Bend 2"'), "Renders accessible remove button for Bend 2");
  assert(html.includes("Straighten edge (remove all bends)"), "Renders straighten edge button");
}

console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILURE(S)`);
if (failures > 0) throw new Error(`${failures} test(s) failed`);
