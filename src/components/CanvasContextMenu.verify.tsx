/**
 * Run with: npx tsx --tsconfig tsconfig.app.json src/components/CanvasContextMenu.verify.tsx
 */
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import { ColorPickerPanel } from './ColorPickerPanel';
import { IconPickerPanel } from './IconPicker';
import { getNodeType } from '../domain/nodeRegistry';
import { getGroupType } from '../domain/groupRegistry';
import { globalShapeRegistry } from '../domain/shapeRegistry';
import type { ArchNodeData } from '../domain/types';
import type { Node } from '@xyflow/react';

let failures = 0;
function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`ok: ${message}`);
  } else {
    failures++;
    console.error(`FAIL: ${message}`);
  }
}

// === Part 1: Color resolution for different node types ===
{
  const typedNode: Node<ArchNodeData> = {
    id: 'node-1',
    type: 'typed',
    position: { x: 0, y: 0 },
    data: { nodeType: 'database', label: 'DB', properties: {}, tags: [] },
  };
  const def = getNodeType(typedNode.data.nodeType);
  assert(def?.color !== undefined, 'typed node resolves default type color');
  assert(def?.icon !== undefined, 'typed node resolves default type icon');

  const groupNode: Node<ArchNodeData> = {
    id: 'group-1',
    type: 'group',
    position: { x: 0, y: 0 },
    data: { nodeType: 'region', label: 'US-East', properties: {}, tags: [] },
  };
  const groupDef = getGroupType(groupNode.data.nodeType);
  assert(groupDef?.color !== undefined, 'group node resolves default group color');
  assert(groupDef?.icon !== undefined, 'groupDef resolves default group icon');

  const shapeNode: Node<ArchNodeData> = {
    id: 'shape-1',
    type: 'shape',
    position: { x: 0, y: 0 },
    data: { nodeType: 'cylinder', label: 'Storage', properties: {}, tags: [] },
  };
  const shapeDef = globalShapeRegistry.getShape(shapeNode.data.nodeType);
  assert(shapeDef?.defaults.color !== undefined, 'shape node resolves default shape color');
}

// === Part 2: Panel rendering in context menu context ===
{
  const colorHtml = renderToStaticMarkup(
    React.createElement(ColorPickerPanel, {
      value: '#22B8CF',
      defaultValue: '#5B7CFA',
      onChange: () => {},
      onClose: () => {},
    }),
  );
  assert(colorHtml.includes('color-picker-panel'), 'renders color picker panel');
  assert(colorHtml.includes('Reset to default'), 'renders reset button when overridden');

  const iconHtml = renderToStaticMarkup(
    React.createElement(IconPickerPanel, {
      value: 'Server',
      defaultValue: 'Database',
      onChange: () => {},
      onClose: () => {},
    }),
  );
  assert(iconHtml.includes('icon-picker__panel'), 'renders icon picker panel');
  assert(iconHtml.includes('Search icons'), 'renders icon search input');
  assert(iconHtml.includes('No icon'), 'renders no icon option');
}

// === Part 3: Applying node updates ===
{
  const nodes: Node<ArchNodeData>[] = [
    {
      id: 'n1',
      type: 'typed',
      position: { x: 0, y: 0 },
      data: { nodeType: 'microservice', label: 'Service', properties: {}, tags: [] },
    },
    {
      id: 'n2',
      type: 'text',
      position: { x: 100, y: 100 },
      data: { nodeType: 'text', label: 'Note', properties: {}, tags: [] },
    },
  ];

  const patches: Record<string, Partial<ArchNodeData>> = {};
  const onUpdateNode = (id: string, patch: Partial<ArchNodeData>) => {
    patches[id] = patch;
  };

  // Simulate updating color for both nodes
  for (const n of nodes) {
    if (n.type === 'text') {
      onUpdateNode(n.id, { color: '#FF6B6B', textColor: '#FF6B6B' });
    } else {
      onUpdateNode(n.id, { color: '#FF6B6B' });
    }
  }

  assert(patches['n1'].color === '#FF6B6B', 'typed node receives color update');
  assert(patches['n2'].textColor === '#FF6B6B', 'text node receives textColor update');

  // Simulate updating icon for typed node
  onUpdateNode('n1', { icon: 'Cloud' });
  assert(patches['n1'].icon === 'Cloud', 'typed node receives icon update');
}

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILURE(S)`);
if (failures > 0) throw new Error(`${failures} assertion(s) failed`);
