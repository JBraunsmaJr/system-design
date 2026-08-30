import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
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
import { NODE_TYPES } from "./domain/nodeRegistry";
import { GROUP_TYPES } from "./domain/groupRegistry";
import { SHAPE_TYPES } from "./domain/shapeRegistry";
import { reorderWithGroupsFirst, toAbsolutePosition } from "./domain/graphUtils";
import { cloneNodesAndEdges } from "./domain/cloneNodes";
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
  const [activeStepId, setActiveStepId] = useState<string | null>(null);
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [isPaletteCollapsed, setIsPaletteCollapsed] = useState(false);
  const [isInspectorCollapsed, setIsInspectorCollapsed] = useState(false);
  const [scenarioPanelHeight, setScenarioPanelHeight] = useState(380);

  const onConnect = useCallback<(connection: Connection) => void>(
    (connection) => {
      setCurrentEdges((eds) =>
        addEdge<Edge<ArchEdgeData>>(
          {
            ...connection,
            id: nextId("edge"),
            type: "typed",
            data: { edgeType: "blank-solid", label: "", direction: "forward", properties: {} },
          },
          eds
        )
      );
    },
    [setCurrentEdges]
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
    (position: { x: number; y: number }): string => {
      const id = nextId("text");
      const node: Node<ArchNodeData> = {
        id,
        type: "text",
        position,
        data: {
          nodeType: "text",
          label: "",
          description: "",
          properties: {},
          tags: [],
          textColor: "#e7e9ee",
          fontSize: 16,
        },
      };
      setCurrentNodes((nds) => [...nds, node]);
      return id;
    },
    [setCurrentNodes]
  );

  const onAddShape = useCallback(
    (typeId: string, position: { x: number; y: number }) => {
      const def = SHAPE_TYPES.find((s) => s.id === typeId);
      if (!def) return;
      const node: Node<ArchNodeData> = {
        id: nextId("shape"),
        type: "shape",
        position,
        width: def.defaultWidth,
        height: def.defaultHeight,
        data: { nodeType: typeId, label: "", description: "", properties: {}, tags: [] },
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

  // --- Copy / paste --------------------------------------------------------

  // Clipboard lives in app state (not the OS clipboard) - simpler, and
  // avoids the Clipboard API's permission prompts for something that only
  // needs to work within this tab. Deliberately NOT cleared on navigation:
  // copying something at one diagram level and pasting it after drilling
  // into another is a reasonable, useful thing to do, given everything here
  // is one tree.
  const [clipboard, setClipboard] = useState<{
    nodes: Node<ArchNodeData>[];
    edges: Edge<ArchEdgeData>[];
  } | null>(null);
  // Each consecutive paste (without re-copying) offsets a bit further, so
  // repeated pastes cascade diagonally instead of stacking exactly on top
  // of each other.
  const [pasteOffset, setPasteOffset] = useState(0);

  const onCopy = useCallback(() => {
    if (selectedNodeIds.length === 0) return;
    const selectedSet = new Set(selectedNodeIds);
    // Copying a boundary brings its contents along, even if they weren't
    // individually selected - an empty duplicated boundary would feel broken.
    const groupIds = new Set(nodes.filter((n) => selectedSet.has(n.id) && n.type === "group").map((n) => n.id));
    const childNodes = nodes.filter((n) => n.parentId && groupIds.has(n.parentId) && !selectedSet.has(n.id));
    const toCopy = [...nodes.filter((n) => selectedSet.has(n.id)), ...childNodes];
    const copiedIds = new Set(toCopy.map((n) => n.id));

    // A node whose parent ISN'T also being copied (e.g. copying one child
    // without its boundary) becomes a root item in the clipboard - convert
    // its position to absolute first, since relative-to-parent coordinates
    // are meaningless without that parent coming along.
    const normalized = toCopy.map((n) => {
      if (n.parentId && !copiedIds.has(n.parentId)) {
        const absolute = toAbsolutePosition(n, nodes, n.parentId);
        return { ...n, parentId: undefined, position: absolute };
      }
      return n;
    });

    const edgesToCopy = edges.filter((e) => copiedIds.has(e.source) && copiedIds.has(e.target));
    setClipboard({ nodes: normalized, edges: edgesToCopy });
    setPasteOffset(0);
  }, [nodes, edges, selectedNodeIds]);

  const onPaste = useCallback(() => {
    if (!clipboard || clipboard.nodes.length === 0) return;
    const offset = 40 + pasteOffset;
    const { nodes: clonedNodes, edges: clonedEdges } = cloneNodesAndEdges(clipboard.nodes, clipboard.edges, {
      nextNodeId: (prefix) => nextId(prefix),
      nextEdgeId: () => nextId("edge"),
    });
    // Only root items (no parentId within the pasted set) need the position
    // offset - children are positioned relative to their (also being
    // pasted, also shifted) parent, so they move along automatically.
    // Pasted nodes are NOT marked selected - nothing should be selected
    // after a paste. That also means clearing `selected` on whatever was
    // still selected from the copy itself, which the previous version
    // missed: copying doesn't clear selection, so the ORIGINAL nodes kept
    // their own `.selected: true` the entire time, which is what made both
    // the originals and the paste appear selected together.
    const offsetNodes = clonedNodes.map((n) =>
      n.parentId ? n : { ...n, position: { x: n.position.x + offset, y: n.position.y + offset } }
    );
    setCurrentNodes((nds) =>
      reorderWithGroupsFirst([...nds.map((n) => (n.selected ? { ...n, selected: false } : n)), ...offsetNodes])
    );
    setCurrentEdges((eds) => [...eds.map((e) => (e.selected ? { ...e, selected: false } : e)), ...clonedEdges]);
    setSelectedNodeIds([]);
    setSelectedEdgeIds([]);
    setPasteOffset((p) => p + 40);
  }, [clipboard, pasteOffset, setCurrentNodes, setCurrentEdges]);

  // --- Sub-diagram navigation ---------------------------------------------

  const onDrillInto = useCallback(
    (nodeId: string) => {
      if (isPresenting) return;
      setPath((p) => [...p, nodeId]);
      setSelectedNodeIds([]);
      setSelectedEdgeIds([]);
      setActiveStepId(null);
    },
    [isPresenting]
  );

  const onNavigateToRoot = useCallback(() => {
    setPath([]);
    setSelectedNodeIds([]);
    setSelectedEdgeIds([]);
    setActiveStepId(null);
  }, []);

  const onNavigateToPathIndex = useCallback((index: number) => {
    setPath((p) => p.slice(0, index + 1));
    setSelectedNodeIds([]);
    setSelectedEdgeIds([]);
    setActiveStepId(null);
  }, []);

  // --- Scenarios (can now span multiple diagram levels - see path below) --

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
    setActiveStepId(null);
  }, []);

  // Selecting a step in the list makes it both the editor's subject AND the
  // canvas preview target at once - clicking the same one again deselects,
  // which is how you get back to seeing the undimmed diagram without
  // closing the panel.
  const onSelectStep = useCallback((stepId: string) => {
    setActiveStepId((cur) => (cur === stepId ? null : stepId));
  }, []);

  // Captures whatever's currently selected on the canvas - AND which level
  // of the tree you're currently drilled into - as a new step. That's what
  // lets a single scenario walk through several nested diagrams: advancing
  // through steps with different `path`s auto-navigates between them (see
  // the presentation-path-sync effect below). The new step becomes active
  // immediately, so you can start writing its narration without a second click.
  const onAddStep = useCallback(
    (scenarioId: string) => {
      if (selectedNodeIds.length === 0 && selectedEdgeIds.length === 0) return;
      const newStepId = nextId("step");
      setScenarios((s) =>
        s.map((sc) => {
          if (sc.id !== scenarioId) return sc;
          const step: ScenarioStep = {
            id: newStepId,
            title: `Step ${sc.steps.length + 1}`,
            narration: "",
            path: [...path],
            focusNodeIds: [...selectedNodeIds],
            focusEdgeIds: [...selectedEdgeIds],
          };
          return { ...sc, steps: [...sc.steps, step] };
        })
      );
      setActiveStepId(newStepId);
    },
    [selectedNodeIds, selectedEdgeIds, path]
  );

  // Adds/removes the current canvas selection to/from an EXISTING step's
  // focus set, rather than requiring you to delete and recreate the whole
  // step to change what it highlights. Both are unions/differences against
  // whatever's already there, not a wholesale replace.
  const onAddSelectionToStep = useCallback(
    (scenarioId: string, stepId: string) => {
      if (selectedNodeIds.length === 0 && selectedEdgeIds.length === 0) return;
      setScenarios((s) =>
        s.map((sc) =>
          sc.id !== scenarioId
            ? sc
            : {
                ...sc,
                steps: sc.steps.map((st) =>
                  st.id !== stepId
                    ? st
                    : {
                        ...st,
                        focusNodeIds: Array.from(new Set([...st.focusNodeIds, ...selectedNodeIds])),
                        focusEdgeIds: Array.from(new Set([...st.focusEdgeIds, ...selectedEdgeIds])),
                      }
                ),
              }
        )
      );
    },
    [selectedNodeIds, selectedEdgeIds]
  );

  const onRemoveSelectionFromStep = useCallback(
    (scenarioId: string, stepId: string) => {
      if (selectedNodeIds.length === 0 && selectedEdgeIds.length === 0) return;
      const removeNodes = new Set(selectedNodeIds);
      const removeEdges = new Set(selectedEdgeIds);
      setScenarios((s) =>
        s.map((sc) =>
          sc.id !== scenarioId
            ? sc
            : {
                ...sc,
                steps: sc.steps.map((st) =>
                  st.id !== stepId
                    ? st
                    : {
                        ...st,
                        focusNodeIds: st.focusNodeIds.filter((nid) => !removeNodes.has(nid)),
                        focusEdgeIds: st.focusEdgeIds.filter((eid) => !removeEdges.has(eid)),
                      }
                ),
              }
        )
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
    setActiveStepId((cur) => (cur === stepId ? null : cur));
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
    if (!activeStepId || !activeScenario) return null;
    const step = activeScenario.steps.find((st) => st.id === activeStepId);
    if (!step) return null;
    return { nodeIds: step.focusNodeIds, edgeIds: step.focusEdgeIds };
  }, [activeStepId, activeScenario]);

  const onStartPresenting = useCallback(
    (scenarioId: string) => {
      const scenario = scenarios.find((s) => s.id === scenarioId);
      if (!scenario || scenario.steps.length === 0) return;
      setActiveScenarioId(scenarioId);
      setActiveStepIndex(0);
      setPath(scenario.steps[0].path);
      setSelectedNodeIds([]);
      setSelectedEdgeIds([]);
      setActiveStepId(null);
      setIsPresenting(true);
    },
    [scenarios]
  );

  const onExitPresenting = useCallback(() => setIsPresenting(false), []);

  // Cross-diagram scenarios: each step carries its own `path`, so advancing
  // sets both the step index AND (when it differs) navigates there directly -
  // right here in the handler that causes the change, rather than reacting
  // to the mismatch after the fact in an effect.
  const onPresentNext = useCallback(() => {
    const steps = activeScenario?.steps ?? [];
    const nextIndex = Math.min(activeStepIndex + 1, Math.max(steps.length - 1, 0));
    const nextStep = steps[nextIndex];
    if (nextStep) setPath(nextStep.path);
    setActiveStepIndex(nextIndex);
  }, [activeScenario, activeStepIndex]);

  const onPresentPrev = useCallback(() => {
    const prevIndex = Math.max(activeStepIndex - 1, 0);
    const steps = activeScenario?.steps ?? [];
    const prevStep = steps[prevIndex];
    if (prevStep) setPath(prevStep.path);
    setActiveStepIndex(prevIndex);
  }, [activeScenario, activeStepIndex]);

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

  // Copy/paste: Ctrl+C / Cmd+C and Ctrl+V / Cmd+V, same guards as delete -
  // never while presenting, never while typing in a field (so normal text
  // copy/paste inside the Inspector's inputs is completely unaffected).
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (isPresenting) return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) return;
      const key = event.key.toLowerCase();
      if ((event.ctrlKey || event.metaKey) && key === "c") {
        event.preventDefault();
        onCopy();
      } else if ((event.ctrlKey || event.metaKey) && key === "v") {
        event.preventDefault();
        onPaste();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isPresenting, onCopy, onPaste]);

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
      // Diagrams saved before cross-diagram scenarios existed won't have a
      // `path` on their steps at all - default those to root so old files
      // keep working rather than crashing on a missing field.
      setScenarios(
        diagram.scenarios.map((sc) => ({
          ...sc,
          steps: sc.steps.map((st) => ({ ...st, path: st.path ?? [] })),
        }))
      );
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
        {!isPresenting && (
          <div className={`app__sidebar-wrap app__sidebar-wrap--left${isPaletteCollapsed ? " is-collapsed" : ""}`}>
            {!isPaletteCollapsed && <Palette />}
            <button
              type="button"
              className="app__sidebar-toggle app__sidebar-toggle--left"
              onClick={() => setIsPaletteCollapsed((v) => !v)}
              title={isPaletteCollapsed ? "Show component palette" : "Hide component palette"}
              aria-label={isPaletteCollapsed ? "Show component palette" : "Hide component palette"}
            >
              {isPaletteCollapsed ? <ChevronRight size={13} /> : <ChevronLeft size={13} />}
            </button>
          </div>
        )}
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
              onAddShape={onAddShape}
              onUpdateNode={onUpdateNode}
              onUpdateEdge={onUpdateEdge}
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
              isSelectMode={isSelectMode}
              onToggleSelectMode={() => setIsSelectMode((v) => !v)}
            />
          </ReactFlowProvider>
          {!isPresenting && isScenarioPanelOpen && (
            <ScenarioPanel
              scenarios={scenarios}
              activeScenarioId={activeScenario?.id ?? null}
              onSelectScenario={onSelectScenario}
              onCreateScenario={onCreateScenario}
              onRenameScenario={onRenameScenario}
              onDeleteScenario={onDeleteScenario}
              onAddStep={onAddStep}
              onAddSelectionToStep={onAddSelectionToStep}
              onRemoveSelectionFromStep={onRemoveSelectionFromStep}
              onUpdateStep={onUpdateStep}
              onDeleteStep={onDeleteStep}
              onMoveStep={onMoveStep}
              onPresent={onStartPresenting}
              canAddStep={canAddStep}
              activeStepId={activeStepId}
              onSelectStep={onSelectStep}
              root={root}
              currentPath={path}
              height={scenarioPanelHeight}
              onHeightChange={setScenarioPanelHeight}
              onClose={() => {
                setIsScenarioPanelOpen(false);
                setActiveStepId(null);
              }}
            />
          )}
        </div>
        {!isPresenting && (
          <div
            className={`app__sidebar-wrap app__sidebar-wrap--right${isInspectorCollapsed ? " is-collapsed" : ""}`}
          >
            <button
              type="button"
              className="app__sidebar-toggle app__sidebar-toggle--right"
              onClick={() => setIsInspectorCollapsed((v) => !v)}
              title={isInspectorCollapsed ? "Show inspector" : "Hide inspector"}
              aria-label={isInspectorCollapsed ? "Show inspector" : "Hide inspector"}
            >
              {isInspectorCollapsed ? <ChevronLeft size={13} /> : <ChevronRight size={13} />}
            </button>
            {!isInspectorCollapsed && (
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
        )}
      </div>
    </div>
  );
}

export default App;
