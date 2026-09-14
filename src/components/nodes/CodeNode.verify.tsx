/**
 * Run with: npx tsx --tsconfig tsconfig.app.json src/components/nodes/CodeNode.verify.tsx
 */
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { ReactFlowProvider } from "@xyflow/react";
import { CodeNode } from "./CodeNode";
import { CanvasContext } from "../CanvasContext";

let failures = 0;
function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`ok: ${message}`);
  } else {
    failures++;
    console.error(`FAIL: ${message}`);
  }
}

// --- Test 1: CodeNode renders display mode when not editing ---
{
  const nodeProps = {
    id: "code-1",
    type: "code" as const,
    data: {
      nodeType: "code",
      label: "Payload",
      codeContent: '{\n  "status": "ok"\n}',
      codeLanguage: "json",
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
        React.createElement(CodeNode, nodeProps as never)
      )
    )
  );

  assert(html.includes("code-node"), "CodeNode renders code-node container class");
  assert(html.includes("Payload"), "CodeNode renders title label");
  assert(html.includes("JSON"), "CodeNode renders language label");
  assert(html.includes("code-node__display"), "CodeNode renders display mode");
}

// --- Test 2: CodeNode renders textarea editor when editing ---
{
  const nodeProps = {
    id: "code-2",
    type: "code" as const,
    data: {
      nodeType: "code",
      label: "Script",
      codeContent: 'const x = 10;\nconst y = 20;',
      codeLanguage: "javascript",
      tags: [],
    },
    selected: true,
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
            editingLabelNodeId: "code-2",
            setEditingLabelNodeId: () => {},
            onChangeTextNode: () => {},
            onChangeCodeNode: () => {},
            onAdoptIntoGroup: () => {},
          },
        },
        React.createElement(CodeNode, nodeProps as never)
      )
    )
  );

  assert(html.includes("code-node__editor-textarea"), "CodeNode renders textarea when editing");
  assert(html.includes("const x = 10;"), "CodeNode textarea contains initial code content");
}

console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILURE(S)`);
if (failures > 0) throw new Error(`${failures} test(s) failed`);
