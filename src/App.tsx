import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
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
import { ScenarioPanel } from "./components/ScenarioPanel";
import { NODE_TYPES } from "./domain/nodeRegistry";
import { GROUP_TYPES } from "./domain/groupRegistry";
import { reorderWithGroupsFirst, toAbsolutePosition } from "./domain/graphUtils";
import { toDiagramFile, downloadDiagram, parseDiagramFile } from "./domain/serialization";
import { exportDiagramAsPng, exportDiagramAsSvg } from "./domain/imageExport";
import type { ArchNodeData, ArchEdgeData, Scenario, ScenarioStep } from "./domain/types";
import "./App.css";

let idSeed = 0;
const nextId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${idSeed++}`;

function App() {
  const [title, setTitle] = useState("Untitled Diagram");
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<ArchNodeData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge<ArchEdgeData>>([]);
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [selectedEdgeIds, setSelectedEdgeIds] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [activeScenarioId, setActiveScenarioId] = useState<string | null>(null);
  const [activeStepIndex, setActiveStepIndex] = useState(0);
  const [isPresenting, setIsPresenting] = useState(false);
  const [isScenarioPanelOpen, setIsScenarioPanelOpen] = useState(false);

  const onConnect = useCallback<(connection: Connection) => void>(
    (connection) => {
      setEdges((eds) =>
        addEdge<Edge<ArchEdgeData>>(
          {
            ...connection,
            id: nextId("edge"),
            type: "typed",
            data: { edgeType: "generic", label: "", direction: "forward", properties: {} },
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

  // Called after dragging a regular node - see Canvas.tsx's onNodeDragStop.
  // newParentId is the group it now overlaps, or null if it's no longer over
  // any group. Converts position to/from parent-relative coordinates so the
  // node visually stays where the user dropped it.
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
    setSelectedNodeIds(selNodes.map((n) => n.id));
    setSelectedEdgeIds(selEdges.map((e) => e.id));
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
      setSelectedNodeIds((cur) => cur.filter((n) => n !== id));
    },
    [setNodes, setEdges]
  );

  const onDeleteEdge = useCallback(
    (id: string) => {
      setEdges((eds) => eds.filter((e) => e.id !== id));
      setSelectedEdgeIds((cur) => cur.filter((e) => e !== id));
    },
    [setEdges]
  );

  const onDeleteSelection = useCallback(() => {
    selectedEdgeIds.forEach(onDeleteEdge);
    selectedNodeIds.forEach(onDeleteNode);
  }, [selectedNodeIds, selectedEdgeIds, onDeleteNode, onDeleteEdge]);

  // --- Scenarios ---------------------------------------------------------

  const onCreateScenario = useCallback(() => {
    const id = nextId("scenario");
    setScenarios((s) => [...s, { id, title: `Scenario ${s.length + 1}`, steps: [] }]);
    setActiveScenarioId(id);
  }, []);

  const onRenameScenario = useCallback((id: string, newTitle: string) => {
    setScenarios((s) => s.map((sc) => (sc.id === id ? { ...sc, title: newTitle } : sc)));
  }, []);

  const onDeleteScenario = useCallback((id: string) => {
    setScenarios((s) => s.filter((sc) => sc.id !== id));
    setActiveScenarioId((cur) => (cur === id ? null : cur));
  }, []);

  // Captures whatever's currently selected on the canvas as a new step.
  const onAddStep = useCallback(
    (scenarioId: string) => {
      if (selectedNodeIds.length === 0 && selectedEdgeIds.length === 0) return;
      setScenarios((s) =>
        s.map((sc) => {
          if (sc.id !== scenarioId) return sc;
          const step: ScenarioStep = {
            id: nextId("step"),
            title: `Step ${sc.steps.length + 1}`,
            narration: "",
            focusNodeIds: [...selectedNodeIds],
            focusEdgeIds: [...selectedEdgeIds],
          };
          return { ...sc, steps: [...sc.steps, step] };
        })
      );
    },
    [selectedNodeIds, selectedEdgeIds]
  );

  const onUpdateStep = useCallback((scenarioId: string, stepId: string, patch: Partial<ScenarioStep>) => {
    setScenarios((s) =>
      s.map((sc) =>
        sc.id === scenarioId
          ? { ...sc, steps: sc.steps.map((st) => (st.id === stepId ? { ...st, ...patch } : st)) }
          : sc
      )
    );
  }, []);

  const onDeleteStep = useCallback((scenarioId: string, stepId: string) => {
    setScenarios((s) =>
      s.map((sc) => (sc.id === scenarioId ? { ...sc, steps: sc.steps.filter((st) => st.id !== stepId) } : sc))
    );
  }, []);

  const onMoveStep = useCallback((scenarioId: string, stepId: string, direction: "up" | "down") => {
    setScenarios((s) =>
      s.map((sc) => {
        if (sc.id !== scenarioId) return sc;
        const index = sc.steps.findIndex((st) => st.id === stepId);
        const swapWith = direction === "up" ? index - 1 : index + 1;
        if (index === -1 || swapWith < 0 || swapWith >= sc.steps.length) return sc;
        const steps = [...sc.steps];
        [steps[index], steps[swapWith]] = [steps[swapWith], steps[index]];
        return { ...sc, steps };
      })
    );
  }, []);

  const activeScenario = useMemo(
    () => scenarios.find((s) => s.id === activeScenarioId) ?? null,
    [scenarios, activeScenarioId]
  );

  const onStartPresenting = useCallback(
    (scenarioId: string) => {
      const scenario = scenarios.find((s) => s.id === scenarioId);
      if (!scenario || scenario.steps.length === 0) return;
      setActiveScenarioId(scenarioId);
      setActiveStepIndex(0);
      setSelectedNodeIds([]);
      setSelectedEdgeIds([]);
      setIsPresenting(true);
    },
    [scenarios]
  );

  const onExitPresenting = useCallback(() => setIsPresenting(false), []);

  const onPresentNext = useCallback(() => {
    setActiveStepIndex((i) => {
      const total = activeScenario?.steps.length ?? 0;
      return Math.min(i + 1, Math.max(total - 1, 0));
    });
  }, [activeScenario]);

  const onPresentPrev = useCallback(() => {
    setActiveStepIndex((i) => Math.max(i - 1, 0));
  }, []);

  const presentation = useMemo(() => {
    if (!isPresenting || !activeScenario) return null;
    const step = activeScenario.steps[activeStepIndex];
    if (!step) return null;
    return { scenario: activeScenario, step, stepIndex: activeStepIndex };
  }, [isPresenting, activeScenario, activeStepIndex]);

  // Delete key: acts on whatever's currently multi-selected, but never while
  // presenting, and never while typing in a field.
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (isPresenting) return;
      if (event.key !== "Backspace" && event.key !== "Delete") return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) return;
      if (selectedNodeIds.length > 0 || selectedEdgeIds.length > 0) {
        onDeleteSelection();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isPresenting, selectedNodeIds, selectedEdgeIds, onDeleteSelection]);

  // Presentation navigation: arrow keys / space / escape.
  useEffect(() => {
    if (!isPresenting) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === "ArrowRight" || event.key === " ") {
        event.preventDefault();
        onPresentNext();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        onPresentPrev();
      } else if (event.key === "Escape") {
        onExitPresenting();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isPresenting, onPresentNext, onPresentPrev, onExitPresenting]);

  // --- File / diagram lifecycle ------------------------------------------

  const onNew = useCallback(() => {
    if (nodes.length > 0 && !window.confirm("Clear the current diagram? Unsaved changes will be lost.")) {
      return;
    }
    setNodes([]);
    setEdges([]);
    setScenarios([]);
    setActiveScenarioId(null);
    setActiveStepIndex(0);
    setIsPresenting(false);
    setTitle("Untitled Diagram");
  }, [nodes.length, setNodes, setEdges]);

  const onSave = useCallback(() => {
    downloadDiagram(toDiagramFile(title, nodes, edges, scenarios));
  }, [title, nodes, edges, scenarios]);

  const onExportPng = useCallback(() => {
    exportDiagramAsPng(nodes, title).catch((err) => window.alert((err as Error).message));
  }, [nodes, title]);

  const onExportSvg = useCallback(() => {
    exportDiagramAsSvg(nodes, title).catch((err) => window.alert((err as Error).message));
  }, [nodes, title]);

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
        setScenarios(diagram.scenarios);
        setActiveScenarioId(null);
        setActiveStepIndex(0);
        setIsPresenting(false);
        setTitle(diagram.title);
      } catch (err) {
        window.alert(`Couldn't open that file: ${(err as Error).message}`);
      }
    },
    [setNodes, setEdges]
  );

  const selectedNodeId = selectedNodeIds[0] ?? null;
  const selectedEdgeId = selectedEdgeIds[0] ?? null;
  const selectedNode = nodes.find((n) => n.id === selectedNodeId) ?? null;
  const selectedEdge = edges.find((e) => e.id === selectedEdgeId) ?? null;
  const canAddStep = selectedNodeIds.length > 0 || selectedEdgeIds.length > 0;

  return (
    <div className="app">
      {!isPresenting && (
        <Toolbar
          title={title}
          onTitleChange={setTitle}
          onNew={onNew}
          onSave={onSave}
          onLoadClick={onLoadClick}
          isScenarioPanelOpen={isScenarioPanelOpen}
          onToggleScenarioPanel={() => setIsScenarioPanelOpen((v) => !v)}
          onExportPng={onExportPng}
          onExportSvg={onExportSvg}
          canExport={nodes.length > 0}
        />
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept="application/json"
        style={{ display: "none" }}
        onChange={onFileSelected}
      />
      <div className="app__body">
        {!isPresenting && <Palette />}
        <div className="app__canvas-column">
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
              presentation={presentation}
              onPresentNext={onPresentNext}
              onPresentPrev={onPresentPrev}
              onExitPresenting={onExitPresenting}
            />
          </ReactFlowProvider>
          {!isPresenting && isScenarioPanelOpen && (
            <ScenarioPanel
              scenarios={scenarios}
              activeScenarioId={activeScenarioId}
              onSelectScenario={setActiveScenarioId}
              onCreateScenario={onCreateScenario}
              onRenameScenario={onRenameScenario}
              onDeleteScenario={onDeleteScenario}
              onAddStep={onAddStep}
              onUpdateStep={onUpdateStep}
              onDeleteStep={onDeleteStep}
              onMoveStep={onMoveStep}
              onPresent={onStartPresenting}
              canAddStep={canAddStep}
              onClose={() => setIsScenarioPanelOpen(false)}
            />
          )}
        </div>
        {!isPresenting && (
          <Inspector
            selectedNode={selectedNode}
            selectedEdge={selectedEdge}
            onUpdateNode={onUpdateNode}
            onUpdateEdge={onUpdateEdge}
            onDeleteNode={onDeleteNode}
            onDeleteEdge={onDeleteEdge}
          />
        )}
      </div>
    </div>
  );
}

export default App;
