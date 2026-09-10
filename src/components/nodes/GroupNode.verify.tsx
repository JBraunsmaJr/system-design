/**
 * Run with: npx tsx --tsconfig tsconfig.app.json src/components/nodes/GroupNode.verify.tsx
 */
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { ReactFlowProvider } from "@xyflow/react";
import { GroupNode } from "./GroupNode";
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

// --- Test 1: GroupNode renders boundary frame and label ---
{
  const nodeProps = {
    id: "group-1",
    type: "group" as const,
    data: {
      nodeType: "region",
      label: "US East Region",
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
            editingLabelNodeId: null,
            setEditingLabelNodeId: () => {},
            onChangeTextNode: () => {},
            onChangeCodeNode: () => {},
            onAdoptIntoGroup: () => {},
          },
        },
        React.createElement(GroupNode, nodeProps as never)
      )
    )
  );

  assert(html.includes("US East Region"), "GroupNode renders label text");
  assert(html.includes("group-node"), "GroupNode renders group-node container class");
  assert(html.includes("is-selected"), "GroupNode renders selected class when selected is true");
  assert(html.includes("group-node__edge-hit"), "GroupNode renders clickable edge hit strips");
}

console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILURE(S)`);
