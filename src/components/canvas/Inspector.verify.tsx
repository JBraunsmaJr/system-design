/**
 * Run with: npx tsx --tsconfig tsconfig.app.json src/components/Inspector.verify.tsx
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { Inspector } from './Inspector';
import type { Edge, Node } from '@xyflow/react';
import type { ArchEdgeData, ArchNodeData } from '../../domain/canvas/types';
import { EMPTY_REQUIREMENTS_DOCUMENT } from '../../domain/requirements/requirementsTypes';

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
    id: 'e1',
    source: 'n1',
    target: 'n2',
    data: {
      edgeType: 'generic',
      label: 'My Edge',
      direction: 'forward',
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
    />,
  );

  assert(
    html.includes('<div class="panel-header">Edge</div>') ||
      html.includes('<div class="panel-header">Inspector</div>'),
    'Renders Edge panel header',
  );
  assert(!html.includes('Bends / Waypoints'), 'Does not render waypoint section when no waypoints');
}

// 2. Inspector with selected edge having waypoints renders list and individual remove buttons
{
  const edgeWithWaypoints: Edge<ArchEdgeData> = {
    id: 'e2',
    source: 'n1',
    target: 'n2',
    data: {
      edgeType: 'generic',
      label: 'Connected',
      direction: 'forward',
      properties: {},
      waypoints: [
        { id: 'wp-1', x: 120, y: 250 },
        { id: 'wp-2', x: 340, y: 250 },
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
    />,
  );

  assert(html.includes('Bends / Waypoints (2)'), 'Renders waypoints header with count');
  assert(html.includes('Bend 1'), 'Renders Bend 1 label');
  assert(html.includes('(120, 250)'), 'Renders Bend 1 coordinates');
  assert(html.includes('Bend 2'), 'Renders Bend 2 label');
  assert(html.includes('(340, 250)'), 'Renders Bend 2 coordinates');
  assert(
    html.includes('aria-label="Remove Bend 1"'),
    'Renders accessible remove button for Bend 1',
  );
  assert(
    html.includes('aria-label="Remove Bend 2"'),
    'Renders accessible remove button for Bend 2',
  );
  assert(html.includes('Straighten edge (remove all bends)'), 'Renders straighten edge button');
}

// 3. Inspector with node having no sub-diagram shows "Create sub-diagram"
{
  const nodeWithoutSub: Node<ArchNodeData> = {
    id: 'n1',
    type: 'typed',
    position: { x: 0, y: 0 },
    data: {
      nodeType: 'service',
      label: 'Service A',
      properties: {},
      tags: [],
    },
  };

  const html = renderToStaticMarkup(
    <Inspector
      selectedNode={nodeWithoutSub}
      selectedEdge={null}
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
    />,
  );

  assert(
    html.includes('Create sub-diagram'),
    'Renders "Create sub-diagram" when node has no sub-diagram',
  );
  assert(
    html.includes('class="inspector__identity-name">Service A<'),
    'the header names the selected node',
  );
  assert(
    html.indexOf('Create sub-diagram') < html.indexOf('<span>Label</span>'),
    'the sub-diagram button comes before the fields, not after them',
  );
  for (const title of ['Requirements', 'Properties', 'Tags', 'Appearance and order']) {
    assert(html.includes(`class="inspector-section__title">${title}<`), `has a ${title} section`);
  }
  assert(!html.includes('class="inspector-section__count"'), 'an empty section shows no count');
  assert(
    !html.includes('color-field') && html.includes('Add property'),
    'appearance starts folded; the other sections start open',
  );

  assert(
    !html.includes('Open sub-diagram'),
    'Does not render "Open sub-diagram" when node has no sub-diagram',
  );
  assert(
    !html.includes('Deleting this node also deletes its sub-diagram'),
    'Does not render sub-diagram deletion hint',
  );
}

// 4. Inspector with node having populated sub-diagram (subDiagramNodeCount > 0) shows "Open sub-diagram (N)" and count hint
{
  const nodeWithSub: Node<ArchNodeData> = {
    id: 'n2',
    type: 'typed',
    position: { x: 0, y: 0 },
    data: {
      nodeType: 'service',
      label: 'Service B',
      properties: {},
      tags: [],
      hasSubDiagram: true,
      subDiagramNodeCount: 3,
    },
  };

  const html = renderToStaticMarkup(
    <Inspector
      selectedNode={nodeWithSub}
      selectedEdge={null}
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
    />,
  );

  assert(
    html.includes('Open sub-diagram (3)'),
    'Renders "Open sub-diagram (3)" when node has 3 sub-diagram nodes',
  );
  assert(
    !html.includes('Create sub-diagram'),
    'Does not render "Create sub-diagram" when sub-diagram exists',
  );
  assert(
    html.includes('Deleting this node also deletes its sub-diagram (3 nodes inside).'),
    'Renders sub-diagram deletion hint with correct node count pluralization',
  );
}

// 5. Inspector with node having 1 sub-diagram node shows singular hint
{
  const nodeWithOneChild: Node<ArchNodeData> = {
    id: 'n3',
    type: 'typed',
    position: { x: 0, y: 0 },
    data: {
      nodeType: 'service',
      label: 'Service C',
      properties: {},
      tags: [],
      hasSubDiagram: true,
      subDiagramNodeCount: 1,
    },
  };

  const html = renderToStaticMarkup(
    <Inspector
      selectedNode={nodeWithOneChild}
      selectedEdge={null}
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
    />,
  );

  assert(
    html.includes('Open sub-diagram (1)'),
    'Renders "Open sub-diagram (1)" for 1 sub-diagram node',
  );
  assert(
    html.includes('Deleting this node also deletes its sub-diagram (1 node inside).'),
    'Renders singular "1 node inside" in deletion hint',
  );
}

// 6. Inspector with node having hasSubDiagram=true but subDiagramNodeCount=0
{
  const nodeWithEmptySub: Node<ArchNodeData> = {
    id: 'n4',
    type: 'typed',
    position: { x: 0, y: 0 },
    data: {
      nodeType: 'service',
      label: 'Service D',
      properties: {},
      tags: [],
      hasSubDiagram: true,
      subDiagramNodeCount: 0,
    },
  };

  const html = renderToStaticMarkup(
    <Inspector
      selectedNode={nodeWithEmptySub}
      selectedEdge={null}
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
    />,
  );

  assert(
    html.includes('Open sub-diagram'),
    'Renders "Open sub-diagram" without count when count is 0',
  );
  assert(
    !html.includes('Create sub-diagram'),
    'Does not render "Create sub-diagram" when hasSubDiagram is true',
  );
}

// 7. Group node does not render sub-diagram drill button or sub-diagram deletion hint
{
  const groupNode: Node<ArchNodeData> = {
    id: 'g1',
    type: 'group',
    position: { x: 0, y: 0 },
    data: {
      nodeType: 'boundary',
      label: 'Boundary 1',
      properties: {},
      tags: [],
      hasSubDiagram: true,
      subDiagramNodeCount: 5,
    },
  };

  const html = renderToStaticMarkup(
    <Inspector
      selectedNode={groupNode}
      selectedEdge={null}
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
    />,
  );

  assert(!html.includes('inspector__drill'), 'Group node does not render drill button');
  assert(
    html.includes('Deleting a boundary keeps the nodes inside it'),
    'Group node renders boundary release hint',
  );
}

// Sections count what they hold.
{
  const html = renderToStaticMarkup(
    <Inspector
      selectedNode={{
        id: 'n1',
        type: 'typed',
        position: { x: 0, y: 0 },
        data: {
          nodeType: 'service',
          label: 'Service A',
          properties: { runtime: 'Go', replicas: '3' },
          tags: ['edge'],
          linkedRequirementIds: ['REQ-1', 'REQ-2', 'REQ-3'],
        },
      }}
      selectedEdge={null}
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
    />,
  );
  const counts = [...html.matchAll(/class="inspector-section__count">(\d+)</g)].map((m) => m[1]);
  assert(counts.join() === '3,2,1', 'requirements, properties and tags show how many they hold');
}

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILURE(S)`);
if (failures > 0) throw new Error(`${failures} test(s) failed`);
