import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import {
  ReactFlowProvider,
  useNodesState,
  useEdgesState,
  addEdge,
  type Node,
  type Edge,
  type Connection,
  type OnSelectionChangeFunc,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Toolbar } from "./components/Toolbar";
import { Palette } from "./components/Palette";
import { Canvas } from "./components/Canvas";
import { Inspector } from "./components/Inspector";
import { NODE_TYPES } from "./domain/nodeRegistry";
import { GROUP_TYPES } from "./domain/groupRegistry";
import { reorderWithGroupsFirst, toAbsolutePosition } from "./domain/graphUtils";
import { toDiagramFile, downloadDiagram, parseDiagramFile } from "./domain/serialization";
import type { ArchNodeData, ArchEdgeData } from "./domain/types";
import "./App.css";

let idSeed = 0;
const nextId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${idSeed++}`;

function App() {
  const [title, setTitle] = useState("Untitled Diagram");
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<ArchNodeData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge<ArchEdgeData>>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const onConnect = useCallback<(connection: Connection) => void>(
    (connection) => {
      setEdges((eds) =>
        addEdge<Edge<ArchEdgeData>>(
          {
            ...connection,
            id: nextId("edge"),
            type: "typed",
            data: { edgeType: "generic", label: "", properties: {} },
          },
          eds
        )
      );
    },
    [setEdges]
  );

  const onAddNode = useCallback(
    (typeId: string, position: { x: number; y: number }) => {
      const def = NODE_TYPES.find((n) => n.id === typeId);
      if (!def) return;
      const node: Node<ArchNodeData> = {
        id: nextId("node"),
        type: "typed",
        position,
        data: { nodeType: typeId, label: def.label, description: "", properties: {}, tags: [] },
      };
      setNodes((nds) => [...nds, node]);
    },
    [setNodes]
  );

  const onAddGroup = useCallback(
    (typeId: string, position: { x: number; y: number }) => {
      const def = GROUP_TYPES.find((g) => g.id === typeId);
      if (!def) return;
      const node: Node<ArchNodeData> = {
        id: nextId("group"),
        type: "group",
        position,
        width: 320,
        height: 220,
        data: { nodeType: typeId, label: def.label, description: "", properties: {}, tags: [] },
      };
      setNodes((nds) => reorderWithGroupsFirst([...nds, node]));
    },
    [setNodes]
  );

  // Called when a regular node is dropped after dragging - see Canvas.tsx's
  // onNodeDragStop. newParentId is the group it now overlaps, or null if it's
  // no longer over any group. Converts position to/from parent-relative
  // coordinates so the node visually stays where the user dropped it.
  const onReparentNode = useCallback(
    (nodeId: string, newParentId: string | null) => {
      setNodes((nds) => {
        const node = nds.find((n) => n.id === nodeId);
        if (!node) return nds;
        const currentParentId = node.parentId ?? null;
        if (currentParentId === newParentId) return nds;

        const absolute = toAbsolutePosition(node, nds, node.parentId);
        const newParent = newParentId ? nds.find((n) => n.id === newParentId) : undefined;
        const nextPosition = newParent
          ? { x: absolute.x - newParent.position.x, y: absolute.y - newParent.position.y }
          : absolute;

        const updated = nds.map((n) =>
          n.id === nodeId ? { ...n, parentId: newParentId ?? undefined, position: nextPosition } : n
        );
        return reorderWithGroupsFirst(updated);
      });
    },
    [setNodes]
  );

  const onSelectionChange = useCallback<OnSelectionChangeFunc>(({ nodes: selNodes, edges: selEdges }) => {
    setSelectedNodeId((selNodes[0]?.id as string) ?? null);
    setSelectedEdgeId((selEdges[0]?.id as string) ?? null);
  }, []);

  const onUpdateNode = useCallback(
    (id: string, patch: Partial<ArchNodeData>) => {
      setNodes((nds) => nds.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n)));
    },
    [setNodes]
  );

  const onUpdateEdge = useCallback(
    (id: string, patch: Partial<ArchEdgeData>) => {
      setEdges((eds) =>
        eds.map((e) => (e.id === id ? { ...e, data: { ...(e.data as ArchEdgeData), ...patch } } : e))
      );
    },
    [setEdges]
  );

  // Deleting a node also drops any edges attached to it. Deleting a group
  // releases the nodes inside it (converted back to absolute position)
  // rather than deleting them - see the hint text in Inspector.tsx.
  const onDeleteNode = useCallback(
    (id: string) => {
      setNodes((nds) => {
        const target = nds.find((n) => n.id === id);
        if (!target) return nds;
        const released = nds
          .filter((n) => n.id !== id)
          .map((n) => {
            if (n.parentId !== id) return n;
            const absolute = toAbsolutePosition(n, nds, id);
            return { ...n, parentId: undefined, position: absolute };
          });
        return reorderWithGroupsFirst(released);
      });
      setEdges((eds) => eds.filter((e) => e.source !== id && e.target !== id));
      setSelectedNodeId((cur) => (cur === id ? null : cur));
    },
    [setNodes, setEdges]
  );

  const onDeleteEdge = useCallback(
    (id: string) => {
      setEdges((eds) => eds.filter((e) => e.id !== id));
      setSelectedEdgeId((cur) => (cur === id ? null : cur));
    },
    [setEdges]
  );

  // Canvas.tsx disables React Flow's built-in delete-key handling
  // (deleteKeyCode={null}) so this is the single source of truth for
  // keyboard deletion too - it reuses the exact same onDeleteNode/onDeleteEdge
  // logic as the Inspector's Delete button, including the group-release
  // behavior above.
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key !== "Backspace" && event.key !== "Delete") return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) return;
      if (selectedNodeId) {
        onDeleteNode(selectedNodeId);
      } else if (selectedEdgeId) {
        onDeleteEdge(selectedEdgeId);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [selectedNodeId, selectedEdgeId, onDeleteNode, onDeleteEdge]);

  const onNew = useCallback(() => {
    if (nodes.length > 0 && !window.confirm("Clear the current diagram? Unsaved changes will be lost.")) {
      return;
    }
    setNodes([]);
    setEdges([]);
    setTitle("Untitled Diagram");
  }, [nodes.length, setNodes, setEdges]);

  const onSave = useCallback(() => {
    downloadDiagram(toDiagramFile(title, nodes, edges));
  }, [title, nodes, edges]);

  const onLoadClick = useCallback(() => fileInputRef.current?.click(), []);

  const onFileSelected = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file) return;
      try {
        const text = await file.text();
        const diagram = parseDiagramFile(text);
        setNodes(diagram.nodes);
        setEdges(diagram.edges);
        setTitle(diagram.title);
      } catch (err) {
        window.alert(`Couldn't open that file: ${(err as Error).message}`);
      }
    },
    [setNodes, setEdges]
  );

  const selectedNode = nodes.find((n) => n.id === selectedNodeId) ?? null;
  const selectedEdge = edges.find((e) => e.id === selectedEdgeId) ?? null;

  return (
    <div className="app">
      <Toolbar title={title} onTitleChange={setTitle} onNew={onNew} onSave={onSave} onLoadClick={onLoadClick} />
      <input
        ref={fileInputRef}
        type="file"
        accept="application/json"
        style={{ display: "none" }}
        onChange={onFileSelected}
      />
      <div className="app__body">
        <Palette />
        <ReactFlowProvider>
          <Canvas
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onSelectionChange={onSelectionChange}
            onAddNode={onAddNode}
            onAddGroup={onAddGroup}
            onReparentNode={onReparentNode}
          />
        </ReactFlowProvider>
        <Inspector
          selectedNode={selectedNode}
          selectedEdge={selectedEdge}
          onUpdateNode={onUpdateNode}
          onUpdateEdge={onUpdateEdge}
          onDeleteNode={onDeleteNode}
          onDeleteEdge={onDeleteEdge}
        />
      </div>
    </div>
  );
}

export default App;
