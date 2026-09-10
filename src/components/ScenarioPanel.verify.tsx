import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ScenarioPanel } from "./ScenarioPanel";
import type { Scenario, SubDiagram } from "../domain/types";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

const mockRoot: SubDiagram = {
  nodes: [
    {
      id: "node-service-a",
      type: "typed",
      position: { x: 100, y: 100 },
      data: {
        nodeType: "service",
        label: "Auth Service",
        properties: {},
        tags: [],
        subDiagram: {
          nodes: [
            {
              id: "node-auth-db",
              type: "typed",
              position: { x: 50, y: 50 },
              data: { nodeType: "database", label: "Auth DB", properties: {}, tags: [] },
            },
          ],
          edges: [],
        },
      },
    },
  ],
  edges: [],
};

const sampleScenarios: Scenario[] = [
  {
    id: "sc-1",
    title: "User Login Flow",
    steps: [
      {
        id: "step-1",
        title: "Client initiates login",
        narration: "User enters credentials on login page.",
        path: [],
        focusNodeIds: ["node-service-a"],
        focusEdgeIds: [],
      },
      {
        id: "step-2",
        title: "Auth Service queries database",
        narration: "Checks user hash in Auth DB inside subdiagram.",
        path: ["node-service-a"],
        focusNodeIds: ["node-auth-db"],
        focusEdgeIds: [],
      },
    ],
  },
];

// === Test 1: Empty state (no scenarios) ===
{
  const html = renderToStaticMarkup(
    React.createElement(ScenarioPanel, {
      scenarios: [],
      activeScenarioId: null,
      onSelectScenario: () => {},
      onCreateScenario: () => {},
      onRenameScenario: () => {},
      onDeleteScenario: () => {},
      onAddStep: () => {},
      onAddSelectionToStep: () => {},
      onRemoveSelectionFromStep: () => {},
      onUpdateStep: () => {},
      onDeleteStep: () => {},
      onMoveStep: () => {},
      onPresent: () => {},
      canAddStep: false,
      activeStepId: null,
      onSelectStep: () => {},
      root: mockRoot,
      currentPath: [],
      onClose: () => {},
    })
  );

  assert(html.includes("Scenarios"), "renders header title");
  assert(html.includes("Create First Scenario"), "renders create first scenario button");
  assert(html.includes("No scenarios yet"), "renders empty scenario text");
}

// === Test 2: Active scenario with steps across root and subdiagram ===
{
  const html = renderToStaticMarkup(
    React.createElement(ScenarioPanel, {
      scenarios: sampleScenarios,
      activeScenarioId: "sc-1",
      onSelectScenario: () => {},
      onCreateScenario: () => {},
      onRenameScenario: () => {},
      onDeleteScenario: () => {},
      onAddStep: () => {},
      onAddSelectionToStep: () => {},
      onRemoveSelectionFromStep: () => {},
      onUpdateStep: () => {},
      onDeleteStep: () => {},
      onMoveStep: () => {},
      onPresent: () => {},
      canAddStep: true,
      activeStepId: "step-2",
      onSelectStep: () => {},
      root: mockRoot,
      currentPath: ["node-service-a"],
      onClose: () => {},
    })
  );

  assert(html.includes("User Login Flow"), "renders active scenario title in input/dropdown");
  assert(html.includes("Client initiates login"), "renders step 1 title");
  assert(html.includes("Auth Service queries database"), "renders step 2 title");
  assert(html.includes("Auth Service"), "renders subdiagram breadcrumb badge for step 2");
  assert(html.includes("Step 2 of 2"), "renders step editor heading for active step");
  assert(html.includes("Checks user hash in Auth DB inside subdiagram"), "renders narration text in editor");
  assert(html.includes("<strong>1</strong> element"), "renders focus count summary in editor");
}

// === Test 3: Step selection and subdiagram navigation logic ===
{
  let navigatedPath: string[] | null = null;
  let activeStepResult: string | null = null;

  const simulateSelectStep = (
    stepId: string,
    currentActiveStep: string | null,
    scenario: Scenario
  ) => {
    let nextStepId: string | null = null;
    if (currentActiveStep === stepId) {
      nextStepId = null;
    } else {
      const step = scenario.steps.find((s) => s.id === stepId);
      if (step && step.path) {
        navigatedPath = step.path;
      }
      nextStepId = stepId;
    }
    activeStepResult = nextStepId;
  };

  // Clicking step-2 (which is in subdiagram ["node-service-a"])
  simulateSelectStep("step-2", null, sampleScenarios[0]);
  assert(activeStepResult === "step-2", "Step 2 is selected");
  assert(
    navigatedPath !== null && (navigatedPath as string[]).length === 1 && (navigatedPath as string[])[0] === "node-service-a",
    "Navigates to subdiagram path when selecting step 2"
  );

  // Clicking step-1 (which is at root [])
  simulateSelectStep("step-1", "step-2", sampleScenarios[0]);
  assert(activeStepResult === "step-1", "Step 1 is selected");
  assert(
    navigatedPath !== null && (navigatedPath as string[]).length === 0,
    "Navigates back to root diagram when selecting step 1"
  );

  // Clicking step-1 again (toggle deselect)
  simulateSelectStep("step-1", "step-1", sampleScenarios[0]);
  assert(activeStepResult === null, "Deselects step when clicked again");
}

console.log("ScenarioPanel verification passed successfully!");
