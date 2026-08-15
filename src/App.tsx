import { useCallback, useRef, useState, type ChangeEvent } from "react";
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
          />
        </ReactFlowProvider>
        <Inspector
          selectedNode={selectedNode}
          selectedEdge={selectedEdge}
          onUpdateNode={onUpdateNode}
          onUpdateEdge={onUpdateEdge}
        />
      </div>
    </div>
  );
}

export default App;
