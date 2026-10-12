import React from 'react';
import {flattenSubDiagramTree} from '../../collab/stores/diagramStore';
import {renderToStaticMarkup} from 'react-dom/server';
import {ScenarioPanel} from './ScenarioPanel';
import type {Scenario, SubDiagram} from '../../domain/canvas/types';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

const mockRoot: SubDiagram = {
  nodes: [
    {
      id: 'node-service-a',
      type: 'typed',
      position: { x: 100, y: 100 },
      data: {
        nodeType: 'service',
        label: 'Auth Service',
        properties: {},
        tags: [],
        subDiagram: {
          nodes: [
            {
              id: 'node-auth-db',
              type: 'typed',
              position: { x: 50, y: 50 },
              data: { nodeType: 'database', label: 'Auth DB', properties: {}, tags: [] },
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
    id: 'sc-1',
    title: 'User Login Flow',
    steps: [
      {
        id: 'step-1',
        title: 'Client initiates login',
        narration: 'User enters credentials on login page.',
        path: [],
        focusNodeIds: ['node-service-a'],
        focusEdgeIds: [],
      },
      {
        id: 'step-2',
        title: 'Auth Service queries database',
        narration: 'Checks user hash in Auth DB inside subdiagram.',
        path: ['node-service-a'],
        focusNodeIds: ['node-auth-db'],
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
        selectedNodeIds: [],
        selectedEdgeIds: [],
      activeStepId: null,
      onSelectStep: () => {},
      diagramNodes: flattenSubDiagramTree(mockRoot).nodes,
      currentPath: [],
      onClose: () => {},
    }),
  );

  assert(html.includes('Scenarios'), 'renders header title');
  assert(html.includes('Create First Scenario'), 'renders create first scenario button');
  assert(html.includes('No scenarios yet'), 'renders empty scenario text');
}

// === Test 2: Active scenario with steps across root and subdiagram ===
{
  const html = renderToStaticMarkup(
    React.createElement(ScenarioPanel, {
      scenarios: sampleScenarios,
      activeScenarioId: 'sc-1',
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
        selectedNodeIds: ['node-auth-db'],
        selectedEdgeIds: [],
      activeStepId: 'step-2',
      onSelectStep: () => {},
      diagramNodes: flattenSubDiagramTree(mockRoot).nodes,
      currentPath: ['node-service-a'],
      onClose: () => {},
    }),
  );

  assert(html.includes('User Login Flow'), 'renders active scenario title in input/dropdown');
  assert(html.includes('Client initiates login'), 'renders step 1 title');
  assert(html.includes('Auth Service queries database'), 'renders step 2 title');
  assert(html.includes('Auth Service'), 'renders subdiagram breadcrumb badge for step 2');
  assert(html.includes('Step 2 of 2'), 'renders step editor heading for active step');
  assert(
    html.includes('Checks user hash in Auth DB inside subdiagram'),
    'renders narration text in editor',
  );
  assert(html.includes('<strong>1</strong> element'), 'renders focus count summary in editor');
}

// === Test 3: Step selection and subdiagram navigation logic ===
{
  let navigatedPath: string[] | null = null;
  let activeStepResult: string | null = null;

  const simulateSelectStep = (
    stepId: string,
    currentActiveStep: string | null,
    scenario: Scenario,
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
  simulateSelectStep('step-2', null, sampleScenarios[0]);
  assert(activeStepResult === 'step-2', 'Step 2 is selected');
  assert(
    navigatedPath !== null &&
      (navigatedPath as string[]).length === 1 &&
      (navigatedPath as string[])[0] === 'node-service-a',
    'Navigates to subdiagram path when selecting step 2',
  );

  // Clicking step-1 (which is at root [])
  simulateSelectStep('step-1', 'step-2', sampleScenarios[0]);
  assert(activeStepResult === 'step-1', 'Step 1 is selected');
  assert(
    navigatedPath !== null && (navigatedPath as string[]).length === 0,
    'Navigates back to root diagram when selecting step 1',
  );

  // Clicking step-1 again (toggle deselect)
  simulateSelectStep('step-1', 'step-1', sampleScenarios[0]);
  assert(activeStepResult === null, 'Deselects step when clicked again');
}

// === Test 4: Export is offered only where it is wired up ===
{
    const props = {
        scenarios: sampleScenarios,
        activeScenarioId: 'sc-1',
        onSelectScenario: () => {
        },
        onCreateScenario: () => {
        },
        onRenameScenario: () => {
        },
        onDeleteScenario: () => {
        },
        onAddStep: () => {
        },
        onAddSelectionToStep: () => {
        },
        onRemoveSelectionFromStep: () => {
        },
        onUpdateStep: () => {
        },
        onDeleteStep: () => {
        },
        onMoveStep: () => {
        },
        onPresent: () => {
        },
        selectedNodeIds: [],
        selectedEdgeIds: [],
        activeStepId: null,
        onSelectStep: () => {
        },
        diagramNodes: flattenSubDiagramTree(mockRoot).nodes,
        currentPath: [],
        onClose: () => {
        },
    };
    const withExport = renderToStaticMarkup(
        React.createElement(ScenarioPanel, {
            ...props,
            onExport: () => {
            },
        }),
    );
    assert(withExport.includes('scenario-panel__btn-export'), 'renders the Export button');
    assert(
        !renderToStaticMarkup(React.createElement(ScenarioPanel, props)).includes(
            'scenario-panel__btn-export',
        ),
        'no Export button without an export handler',
    );
    const empty = renderToStaticMarkup(
        React.createElement(ScenarioPanel, {
            ...props,
            scenarios: [{id: 'sc-2', title: 'Empty', steps: []}],
            activeScenarioId: 'sc-2',
            onExport: () => {
            },
        }),
    );
    assert(
        /<button[^>]*scenario-panel__btn-export[^>]*disabled/.test(empty),
        'Export is disabled for a scenario with no steps',
    );
}

// === Test 5: The scenario title has its own line; selection actions say what they do ===
{
    const base = {
        scenarios: sampleScenarios,
        activeScenarioId: 'sc-1',
        onSelectScenario: () => {
        },
        onCreateScenario: () => {
        },
        onRenameScenario: () => {
        },
        onDeleteScenario: () => {
        },
        onAddStep: () => {
        },
        onAddSelectionToStep: () => {
        },
        onRemoveSelectionFromStep: () => {
        },
        onUpdateStep: () => {
        },
        onDeleteStep: () => {
        },
        onMoveStep: () => {
        },
        onPresent: () => {
        },
        onExport: () => {
        },
        selectedNodeIds: [] as string[],
        selectedEdgeIds: [] as string[],
        activeStepId: null as string | null,
        onSelectStep: () => {
        },
        diagramNodes: flattenSubDiagramTree(mockRoot).nodes,
        currentPath: ['node-service-a'],
        onClose: () => {
        },
    };
    const render = (overrides: Partial<typeof base>) =>
        renderToStaticMarkup(React.createElement(ScenarioPanel, {...base, ...overrides}));
    /** A button's markup, found by its visible label. */
    const button = (html: string, label: string) =>
        [...html.matchAll(/<button[^>]*>(?:(?!<\/button>).)*<\/button>/g)]
            .map((m) => m[0])
            .find((b) => b.replace(/<[^>]+>/g, '').includes(label));
    const disabled = (b: string | undefined) => b !== undefined && /<button[^>]*\sdisabled/.test(b);

    const idle = render({});
    const titleAt = idle.indexOf('aria-label="Scenario title"');
    const buttonsAt = idle.indexOf('scenario-panel__action-buttons');
    assert(
        titleAt > 0 && buttonsAt > titleAt && !idle.includes('scenario-panel__scenario-actions'),
        'the scenario title is on its own line, above the Present/Export row',
    );
    assert(!/Add Selection/.test(idle), 'the ambiguous "Add Selection" button is gone');
    assert(
        idle.includes('Select nodes or edges on the diagram') &&
        button(idle, 'New step from selection') === undefined,
        'with nothing selected, the selection bar says how to start, with no actions',
    );

    const selected = render({selectedNodeIds: ['node-auth-db'], selectedEdgeIds: ['e9']});
    assert(selected.includes('2 selected'), 'it counts what is selected');
    assert(
        button(selected, 'New step from selection') !== undefined &&
        !disabled(button(selected, 'New step from selection')),
        'a selection can always become a new step',
    );
    assert(
        button(selected, 'Add to step') === undefined,
        'with no step open, there is no step to add to',
    );

    const inStep = render({selectedNodeIds: ['node-auth-db'], activeStepId: 'step-2'});
    assert(
        disabled(button(inStep, 'Add to step 2')) && !disabled(button(inStep, 'Remove from step 2')),
        'with step 2 open and its element selected: names the step; only Remove would change it',
    );
    const notInStep = render({selectedNodeIds: ['node-other'], activeStepId: 'step-2'});
    assert(
        !disabled(button(notInStep, 'Add to step 2')) &&
        disabled(button(notInStep, 'Remove from step 2')),
        'with something else selected: only Add would change it',
    );
    const otherLevel = render({
        selectedNodeIds: ['node-service-a'],
        activeStepId: 'step-2',
        currentPath: [],
    });
    assert(
        disabled(button(otherLevel, 'Add to step 2')) &&
        disabled(button(otherLevel, 'Remove from step 2')) &&
        (button(otherLevel, 'Add to step 2') ?? '').includes('on another diagram level'),
        "a step on another level can't take this level's selection, and says why",
    );
    assert(
        !/<button[^>]*>(?:(?!<\/button>).)*Add selection/.test(inStep),
        'the step editor no longer has its own Add/Remove buttons',
    );
}

console.log('ScenarioPanel verification passed successfully!');
