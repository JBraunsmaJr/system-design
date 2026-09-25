/**
 * Run with: npx tsx --tsconfig tsconfig.app.json src/components/nodes/TypedNode.verify.tsx
 */
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { TypedNode } from './TypedNode';
import { CanvasContext } from '../CanvasContext';

let failures = 0;
function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`ok: ${message}`);
  } else {
    failures++;
    (globalThis as unknown as { process: { exitCode: number } }).process.exitCode = 1;
    console.error(`FAIL: ${message}`);
  }
}

// --- Test 1: TypedNode renders property chips with explicit key and value elements ---
{
  const nodeProps = {
    id: 'node-ec2',
    type: 'typed' as const,
    data: {
      nodeType: 'aws_ec2',
      label: 'AWS EC2',
      properties: {
        instanceType: 't3.micro',
      },
      tags: [],
    },
    selected: false,
    zIndex: 1,
    isConnectable: true,
    positionAbsoluteX: 100,
    positionAbsoluteY: 100,
    dragging: false,
    selectable: true,
    deletable: true,
    draggable: true,
  };

  const html = renderToStaticMarkup(
    React.createElement(
      ReactFlowProvider,
      null,
      React.createElement(
        CanvasContext.Provider,
        {
          value: {
            isPresenting: false,
            onDrillInto: () => {},
            editingLabelNodeId: null,
            setEditingLabelNodeId: () => {},
            onChangeTextNode: () => {},
            onChangeCodeNode: () => {},
            onAdoptIntoGroup: () => {},
          },
        },
        React.createElement(TypedNode, nodeProps as never),
      ),
    ),
  );

  assert(html.includes('prop-chip'), 'TypedNode renders prop-chip container');
  assert(html.includes('prop-chip__key'), 'TypedNode renders prop-chip__key element');
  assert(html.includes('instanceType:'), 'TypedNode renders property key');
  assert(html.includes('prop-chip__val'), 'TypedNode renders prop-chip__val element');
  assert(html.includes('t3.micro'), 'TypedNode renders full property value');
}

// --- Test 2: TypedNode handles multiple properties and overflow tooltip ---
{
  const nodeProps = {
    id: 'node-s3',
    type: 'typed' as const,
    data: {
      nodeType: 'aws_s3',
      label: 'AWS S3',
      properties: {
        bucketName: 'production-assets',
        storageClass: 'Standard',
        versioning: 'Enabled',
      },
      tags: [],
    },
    selected: false,
    zIndex: 1,
    isConnectable: true,
    positionAbsoluteX: 100,
    positionAbsoluteY: 100,
    dragging: false,
    selectable: true,
    deletable: true,
    draggable: true,
  };

  const html = renderToStaticMarkup(
    React.createElement(
      ReactFlowProvider,
      null,
      React.createElement(
        CanvasContext.Provider,
        {
          value: {
            isPresenting: false,
            onDrillInto: () => {},
            editingLabelNodeId: null,
            setEditingLabelNodeId: () => {},
            onChangeTextNode: () => {},
            onChangeCodeNode: () => {},
            onAdoptIntoGroup: () => {},
          },
        },
        React.createElement(TypedNode, nodeProps as never),
      ),
    ),
  );

  assert(html.includes('production-assets'), 'renders first property value');
  assert(html.includes('Standard'), 'renders second property value');
  assert(html.includes('+1'), 'renders +1 overflow chip when more than 2 properties');
  assert(html.includes('prop-chip__tooltip'), 'renders tooltip for overflow properties');
  assert(html.includes('versioning:'), 'tooltip includes hidden property key');
  assert(html.includes('Enabled'), 'tooltip includes hidden property value');
}

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILURE(S)`);
