import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import {
  ReactFlowProvider,
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
  type Node,
  type Edge,
  type Connection,
  type OnNodesChange,
  type OnEdgesChange,
  type OnSelectionChangeFunc,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Toolbar } from "./components/Toolbar";
import { Palette } from "./components/Palette";
import { Canvas } from "./components/Canvas";
import { Inspector } from "./components/Inspector";
import { ScenarioPanel } from "./components/ScenarioPanel";
import { NODE_TYPES, getNodeType } from "./domain/nodeRegistry";
import { GROUP_TYPES } from "./domain/groupRegistry";
import { reorderWithGroupsFirst, toAbsolutePosition } from "./domain/graphUtils";
import {
  getSubDiagramAtPath,
  updateSubDiagramAtPath,
  getBreadcrumbLabels,
  type DiagramPath,
} from "./domain/subDiagramTree";
import { toDiagramFile, downloadDiagram, parseDiagramFile } from "./domain/serialization";
import { exportDiagramAsPng, exportDiagramAsSvg } from "./domain/imageExport";
import type { ArchNodeData, ArchEdgeData, Scenario, ScenarioStep, SubDiagram } from "./domain/types";
import "./App.css";

let idSeed = 0;
const nextId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${idSeed++}`;

const EMPTY_DIAGRAM: SubDiagram = { nodes: [], edges: [] };

function App() {
  const [title, setTitle] = useState("Untitled Diagram");

  // `root` is the ENTIRE diagram tree - every node's data can carry its own
  // nested subDiagram, recursively, all within this one object (and so all
  // within one JSON file on save/load - see serialization.ts). `path` is how
  // deep the user has drilled in; the canvas only ever sees the nodes/edges
  // at that one level, derived below. See domain/subDiagramTree.ts for the
  // (get/update)SubDiagramAtPath mechanics this all rests on.
  const [root, setRoot] = useState<SubDiagram>(EMPTY_DIAGRAM);
  const [path, setPath] = useState<DiagramPath>([]);

  const { nodes, edges } = useMemo(() => getSubDiagramAtPath(root, path), [root, path]);
  const breadcrumbLabels = useMemo(() => getBreadcrumbLabels(root, path), [root, path]);

  const setCurrentNodes = useCallback(
    (updater: (nodes: Node<ArchNodeData>[]) => Node<ArchNodeData>[]) => {
      setRoot((r) => updateSubDiagramAtPath(r, path, (sd) => ({ ...sd, nodes: updater(sd.nodes) })));
    },
    [path]
  );

  const setCurrentEdges = useCallback(
    (updater: (edges: Edge<ArchEdgeData>[]) => Edge<ArchEdgeData>[]) => {
      setRoot((r) => updateSubDiagramAtPath(r, path, (sd) => ({ ...sd, edges: updater(sd.edges) })));
    },
    [path]
  );

  const onNodesChange = useCallback<OnNodesChange<Node<ArchNodeData>>>(
    (changes) => setCurrentNodes((nds) => applyNodeChanges(changes, nds)),
    [setCurrentNodes]
  );

  const onEdgesChange = useCallback<OnEdgesChange<Edge<ArchEdgeData>>>(
    (changes) => setCurrentEdges((eds) => applyEdgeChanges(changes, eds)),
    [setCurrentEdges]
  );

  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [selectedEdgeIds, setSelectedEdgeIds] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [activeScenarioId, setActiveScenarioId] = useState<string | null>(null);
  const [activeStepIndex, setActiveStepIndex] = useState(0);
  const [isPresenting, setIsPresenting] = useState(false);
  const [isScenarioPanelOpen, setIsScenarioPanelOpen] = useState(false);
  // Which step (if any) is being previewed from ScenarioPanel without
  // actually entering full Presentation Mode - see onTogglePreviewStep.
  const [previewStepId, setPreviewStepId] = useState<string | null>(null);

  const onConnect = useCallback<(connection: Connection) => void>(
    (connection) => {
      const sourceNode = nodes.find((n) => n.id === connection.source);
      const targetNode = nodes.find((n) => n.id === connection.target);
      const sourceCategory = getNodeType(sourceNode?.data.nodeType ?? "")?.category;
      const targetCategory = getNodeType(targetNode?.data.nodeType ?? "")?.category;
      const defaultEdgeType = sourceCategory === "logic" || targetCategory === "logic" ? "next" : "generic";

      setCurrentEdges((eds) =>
        addEdge<Edge<ArchEdgeData>>(
          {
            ...connection,
            id: nextId("edge"),
            type: "typed",
            data: { edgeType: defaultEdgeType, label: "", direction: "forward", properties: {} },
          },
          eds
        )
      );
    },
    [nodes, setCurrentEdges]
  );

  const onAddNode = useCallback(
    (typeId: string, position: { x: number; y: number }) => {
      const def = NODE_TYPES.find((n) => n.id === typeId);
      if (!def) return;
      const node: Node<ArchNodeData> = {
        id: nextId("node"),
        type: "typed",
        position,
        data: {
          nodeType: typeId,
          label: def.label,
          description: "",
          properties: { ...(def.defaultProperties ?? {}) },
          tags: [],
        },
      };
      setCurrentNodes((nds) => [...nds, node]);
    },
    [setCurrentNodes]
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
      setCurrentNodes((nds) => reorderWithGroupsFirst([...nds, node]));
    },
    [setCurrentNodes]
  );

  const onAddText = useCallback(
    (position: { x: number; y: number }) => {
      const node: Node<ArchNodeData> = {
        id: nextId("text"),
        type: "text",
        position,
        data: {
          nodeType: "text",
          label: "Text",
          description: "",
          properties: {},
          tags: [],
          textColor: "#e7e9ee",
          fontSize: 16,
        },
      };
      setCurrentNodes((nds) => [...nds, node]);
    },
    [setCurrentNodes]
  );

  // Called after dragging a regular node - see Canvas.tsx's onNodeDragStop.
  // newParentId is the group it now overlaps, or null if it's no longer over
  // any group. Converts position to/from parent-relative coordinates so the
  // node visually stays where the user dropped it.
  const onReparentNode = useCallback(
    (nodeId: string, newParentId: string | null) => {
      setCurrentNodes((nds) => {
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
    [setCurrentNodes]
  );

  // Called after dragging a *boundary* - see Canvas.tsx's onNodeDragStop.
  // `nodeIds` are whichever nodes now fall fully inside it and aren't
  // already its children. Any node already parented to a different group
  // gets moved over (its position is re-derived relative to the new parent,
  // same math as onReparentNode).
  const onAdoptIntoGroup = useCallback(
    (groupId: string, nodeIds: string[]) => {
      setCurrentNodes((nds) => {
        const group = nds.find((n) => n.id === groupId);
        if (!group) return nds;
        const idsToAdopt = new Set(nodeIds);
        const updated = nds.map((n) => {
          if (!idsToAdopt.has(n.id) || n.id === groupId) return n;
          const absolute = toAbsolutePosition(n, nds, n.parentId);
          const relative = { x: absolute.x - group.position.x, y: absolute.y - group.position.y };
          return { ...n, parentId: groupId, position: relative };
        });
        return reorderWithGroupsFirst(updated);
      });
    },
    [setCurrentNodes]
  );

  const onSelectionChange = useCallback<OnSelectionChangeFunc>(({ nodes: selNodes, edges: selEdges }) => {
    setSelectedNodeIds(selNodes.map((n) => n.id));
    setSelectedEdgeIds(selEdges.map((e) => e.id));
  }, []);

  const onUpdateNode = useCallback(
    (id: string, patch: Partial<ArchNodeData>) => {
      setCurrentNodes((nds) => nds.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n)));
    },
    [setCurrentNodes]
  );

  const onUpdateEdge = useCallback(
    (id: string, patch: Partial<ArchEdgeData>) => {
      setCurrentEdges((eds) =>
        eds.map((e) => (e.id === id ? { ...e, data: { ...(e.data as ArchEdgeData), ...patch } } : e))
      );
    },
    [setCurrentEdges]
  );

  // Deleting a node also drops any edges attached to it. Deleting a group
  // releases the nodes inside it (converted back to absolute position)
  // rather than deleting them - see the hint text in Inspector.tsx. Deleting
  // a node that has a populated sub-diagram asks for confirmation first,
  // since that would take everything nested inside it along with it.
  const onDeleteNode = useCallback(
    (id: string) => {
      const target = nodes.find((n) => n.id === id);
      const nestedCount = target?.data.subDiagram?.nodes.length ?? 0;
      if (nestedCount > 0) {
        const ok = window.confirm(
          `"${target?.data.label}" contains a sub-diagram with ${nestedCount} node${nestedCount === 1 ? "" : "s"} inside. Delete it and everything inside?`
        );
        if (!ok) return;
      }
      setCurrentNodes((nds) => {
        const removedTarget = nds.find((n) => n.id === id);
        if (!removedTarget) return nds;
        const released = nds
          .filter((n) => n.id !== id)
          .map((n) => {
            if (n.parentId !== id) return n;
            const absolute = toAbsolutePosition(n, nds, id);
            return { ...n, parentId: undefined, position: absolute };
          });
        return reorderWithGroupsFirst(released);
      });
      setCurrentEdges((eds) => eds.filter((e) => e.source !== id && e.target !== id));
      setSelectedNodeIds((cur) => cur.filter((n) => n !== id));
    },
    [nodes, setCurrentNodes, setCurrentEdges]
  );

  const onDeleteEdge = useCallback(
    (id: string) => {
      setCurrentEdges((eds) => eds.filter((e) => e.id !== id));
      setSelectedEdgeIds((cur) => cur.filter((e) => e !== id));
    },
    [setCurrentEdges]
  );

  const onDeleteSelection = useCallback(() => {
    selectedEdgeIds.forEach(onDeleteEdge);
    selectedNodeIds.forEach(onDeleteNode);
  }, [selectedNodeIds, selectedEdgeIds, onDeleteNode, onDeleteEdge]);

  // --- Sub-diagram navigation ---------------------------------------------

  const onDrillInto = useCallback(
    (nodeId: string) => {
      if (isPresenting) return;
      setPath((p) => [...p, nodeId]);
      setSelectedNodeIds([]);
      setSelectedEdgeIds([]);
      setPreviewStepId(null);
    },
    [isPresenting]
  );

  const onNavigateToRoot = useCallback(() => {
    setPath([]);
    setSelectedNodeIds([]);
    setSelectedEdgeIds([]);
    setPreviewStepId(null);
  }, []);

  const onNavigateToPathIndex = useCallback((index: number) => {
    setPath((p) => p.slice(0, index + 1));
    setSelectedNodeIds([]);
    setSelectedEdgeIds([]);
    setPreviewStepId(null);
  }, []);

  // --- Scenarios (root-level only - see SubDiagram's doc comment) --------

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

  const onSelectScenario = useCallback((id: string) => {
    setActiveScenarioId(id);
    setPreviewStepId(null);
  }, []);

  // Toggling the same step again turns preview off; picking a different
  // step switches straight to it.
  const onTogglePreviewStep = useCallback((stepId: string) => {
    setPreviewStepId((cur) => (cur === stepId ? null : stepId));
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
    setPreviewStepId((cur) => (cur === stepId ? null : cur));
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

  // Falls back to the first scenario when nothing's been explicitly picked
  // yet (e.g. right after loading a file, or before ever touching the
  // dropdown) - this MUST match whatever ScenarioPanel displays, or the
  // preview toggle silently does nothing while the panel looks fine. See
  // the activeScenarioId prop passed to ScenarioPanel below - it receives
  // this already-resolved id rather than the raw state, so there's only one
  // place deciding the fallback.
  const activeScenario = useMemo(
    () => scenarios.find((s) => s.id === activeScenarioId) ?? scenarios[0] ?? null,
    [scenarios, activeScenarioId]
  );

  const previewFocus = useMemo(() => {
    if (!previewStepId || !activeScenario) return null;
    const step = activeScenario.steps.find((st) => st.id === previewStepId);
    if (!step) return null;
    return { nodeIds: step.focusNodeIds, edgeIds: step.focusEdgeIds };
  }, [previewStepId, activeScenario]);

  const onStartPresenting = useCallback(
    (scenarioId: string) => {
      const scenario = scenarios.find((s) => s.id === scenarioId);
      if (!scenario || scenario.steps.length === 0) return;
      setActiveScenarioId(scenarioId);
      setActiveStepIndex(0);
      setSelectedNodeIds([]);
      setSelectedEdgeIds([]);
      setPreviewStepId(null);
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

  // --- File / diagram lifecycle -------------------------------------------

  const onNew = useCallback(() => {
    if (root.nodes.length > 0 && !window.confirm("Clear the current diagram? Unsaved changes will be lost.")) {
      return;
    }
    setRoot(EMPTY_DIAGRAM);
    setPath([]);
    setScenarios([]);
    setActiveScenarioId(null);
    setActiveStepIndex(0);
    setIsPresenting(false);
    setTitle("Untitled Diagram");
  }, [root.nodes.length]);

  // Always saves the full tree from the root, regardless of which level
  // you're currently viewing - a save from inside a drilled-down sub-diagram
  // must not lose everything above/beside it.
  const onSave = useCallback(() => {
    downloadDiagram(toDiagramFile(title, root.nodes, root.edges, scenarios));
  }, [title, root, scenarios]);

  // Exports export the CURRENT view (whatever level you're looking at),
  // unlike Save - drilling into a node and exporting just that sub-diagram
  // as its own image is a reasonable, likely common thing to want.
  const onExportPng = useCallback(() => {
    exportDiagramAsPng(nodes, title).catch((err) => window.alert((err as Error).message));
  }, [nodes, title]);

  const onExportSvg = useCallback(() => {
    exportDiagramAsSvg(nodes, title).catch((err) => window.alert((err as Error).message));
  }, [nodes, title]);

  const onLoadClick = useCallback(() => fileInputRef.current?.click(), []);

  const onFileSelected = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const text = await file.text();
      const diagram = parseDiagramFile(text);
      setRoot({ nodes: diagram.nodes, edges: diagram.edges });
      setPath([]);
      setScenarios(diagram.scenarios);
      setActiveScenarioId(null);
      setActiveStepIndex(0);
      setIsPresenting(false);
      setTitle(diagram.title);
    } catch (err) {
      window.alert(`Couldn't open that file: ${(err as Error).message}`);
    }
  }, []);

  const selectedNodeId = selectedNodeIds[0] ?? null;
  const selectedEdgeId = selectedEdgeIds[0] ?? null;
  const selectedNode = nodes.find((n) => n.id === selectedNodeId) ?? null;
  const selectedEdge = edges.find((e) => e.id === selectedEdgeId) ?? null;
  const canAddStep = selectedNodeIds.length > 0 || selectedEdgeIds.length > 0;
  const atRoot = path.length === 0;

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
          scenariosDisabled={!atRoot}
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
              onAddText={onAddText}
              onReparentNode={onReparentNode}
              onAdoptIntoGroup={onAdoptIntoGroup}
              presentation={presentation}
              previewFocus={previewFocus}
              onPresentNext={onPresentNext}
              onPresentPrev={onPresentPrev}
              onExitPresenting={onExitPresenting}
              breadcrumbLabels={breadcrumbLabels}
              onDrillInto={onDrillInto}
              onNavigateToRoot={onNavigateToRoot}
              onNavigateToPathIndex={onNavigateToPathIndex}
            />
          </ReactFlowProvider>
          {!isPresenting && isScenarioPanelOpen && atRoot && (
            <ScenarioPanel
              scenarios={scenarios}
              activeScenarioId={activeScenario?.id ?? null}
              onSelectScenario={onSelectScenario}
              onCreateScenario={onCreateScenario}
              onRenameScenario={onRenameScenario}
              onDeleteScenario={onDeleteScenario}
              onAddStep={onAddStep}
              onUpdateStep={onUpdateStep}
              onDeleteStep={onDeleteStep}
              onMoveStep={onMoveStep}
              onPresent={onStartPresenting}
              canAddStep={canAddStep}
              previewStepId={previewStepId}
              onTogglePreviewStep={onTogglePreviewStep}
              onClose={() => {
                setIsScenarioPanelOpen(false);
                setPreviewStepId(null);
              }}
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
            onDrillInto={onDrillInto}
          />
        )}
      </div>
    </div>
  );
}

export default App;
