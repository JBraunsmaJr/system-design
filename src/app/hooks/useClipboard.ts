import { useCallback, useState, type Dispatch, type SetStateAction } from 'react';
import type { Node, Edge } from '@xyflow/react';
import {
  getNodesAtPath,
  getEdgesAtPath,
  type DiagramStore,
} from '../../collab/stores/diagramStore';
import { getDescendantIds, toAbsolutePosition } from '../../domain/canvas/graphUtils';
import type { DiagramPath } from '../../domain/canvas/subDiagramTree';
import type { ArchNodeData, ArchEdgeData } from '../../domain/canvas/types';

export interface UseClipboardOptions {
  nodes: Node<ArchNodeData>[];
  edges: Edge<ArchEdgeData>[];
  selectedNodeIds: string[];
  diagramStore: DiagramStore;
  path: DiagramPath;
  setSelectedNodeIds: Dispatch<SetStateAction<string[]>>;
  setSelectedEdgeIds: Dispatch<SetStateAction<string[]>>;
}

/**
 * Copy and paste within the tab, including nested sub-diagram content.
 * Moved unchanged from App.tsx; onPaste now lists the two setters it
 * receives (React setters, so this changes no identity).
 *
 * onCopy and onPaste are only read by the keyboard shortcut effect, never
 * rendered, so their identity changing with `nodes` costs a listener swap,
 * not a render - as it always did.
 *
 * Performance contract (see src/app/README.md): this hook runs inside App's
 * render, so it adds no component, no render and no commit. Every value it
 * returns is either React state, a ref, or memoised with the same
 * dependencies it had in App.tsx. Callers destructure the result and depend
 * on the individual members - never on the returned object, which is new on
 * every render.
 */
export function useClipboard({
  nodes,
  edges,
  selectedNodeIds,
  diagramStore,
  path,
  setSelectedNodeIds,
  setSelectedEdgeIds,
}: UseClipboardOptions) {
  // --- Copy / paste --------------------------------------------------------

  // Clipboard lives in app state (not the OS clipboard) - simpler, and
  // avoids the Clipboard API's permission prompts for something that only
  // needs to work within this tab. Deliberately NOT cleared on navigation:
  // copying something at one diagram level and pasting it after drilling
  // into another is a reasonable, useful thing to do, given everything here
  // is one tree.
  //
  // relativePath on each clipboard item is relative to the COPY
  // operation's own root, not the diagram's global path - [] for a
  // top-level copied item, [oldNodeId] for something one level inside a
  // copied node's own sub-diagram, and so on. This is what lets copying
  // a node with a populated sub-diagram bring its nested content along:
  // the flattened nodes/edges this component reads only ever cover the
  // CURRENTLY VIEWED level, so a copied node's own nested descendants
  // (which live at deeper parentPath values in the global flat space,
  // not in the node's own data field the way the old recursive-tree
  // model kept them) have to be gathered explicitly, one level at a
  // time, from the store's full snapshot.
  const [clipboard, setClipboard] = useState<{
    nodes: (Node<ArchNodeData> & { relativePath: string[] })[];
    edges: (Edge<ArchEdgeData> & { relativePath: string[] })[];
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
    // Boundaries nest, so that means everything inside it at any depth.
    const containedIds = new Set<string>();
    for (const n of nodes) {
      if (!selectedSet.has(n.id) || n.type !== 'group') continue;
      for (const d of getDescendantIds(n.id, nodes)) containedIds.add(d);
    }
    const childNodes = nodes.filter((n) => containedIds.has(n.id) && !selectedSet.has(n.id));
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

    const topLevelEdges = edges.filter((e) => copiedIds.has(e.source) && copiedIds.has(e.target));

    const { nodes: allNodes, edges: allEdges } = diagramStore.getSnapshot();
    function gatherDescendants(
      nodeId: string,
      relativePath: string[],
    ): {
      nodes: (Node<ArchNodeData> & { relativePath: string[] })[];
      edges: (Edge<ArchEdgeData> & { relativePath: string[] })[];
    } {
      const childPath = [...relativePath, nodeId];
      const levelNodes = getNodesAtPath(allNodes, [...path, ...childPath]);
      const levelEdges = getEdgesAtPath(allEdges, [...path, ...childPath]);
      let result = {
        nodes: levelNodes.map((n) => ({ ...n, relativePath: childPath })),
        edges: levelEdges.map((e) => ({ ...e, relativePath: childPath })),
      };
      for (const child of levelNodes) {
        const deeper = gatherDescendants(child.id, childPath);
        result = {
          nodes: [...result.nodes, ...deeper.nodes],
          edges: [...result.edges, ...deeper.edges],
        };
      }
      return result;
    }

    let descendantNodes: (Node<ArchNodeData> & { relativePath: string[] })[] = [];
    let descendantEdges: (Edge<ArchEdgeData> & { relativePath: string[] })[] = [];
    for (const n of normalized) {
      const gathered = gatherDescendants(n.id, []);
      descendantNodes = [...descendantNodes, ...gathered.nodes];
      descendantEdges = [...descendantEdges, ...gathered.edges];
    }

    setClipboard({
      nodes: [...normalized.map((n) => ({ ...n, relativePath: [] })), ...descendantNodes],
      edges: [...topLevelEdges.map((e) => ({ ...e, relativePath: [] })), ...descendantEdges],
    });
    setPasteOffset(0);
  }, [nodes, edges, selectedNodeIds, diagramStore, path]);

  const onPaste = useCallback(() => {
    if (!clipboard || clipboard.nodes.length === 0) return;
    const offset = 40 + pasteOffset;

    // A node depends on its relativePath ancestors (tree-level nesting)
    // AND its parentId (group containment - a SAME-level dependency, one
    // a depth-only sort can't correctly order: a group's own child could
    // otherwise get processed before the group itself, if it happened to
    // come first in the underlying storage order) both having their new
    // ids assigned first. Repeatedly processing whatever's ready handles
    // both kinds of dependency, and any depth, without needing a full
    // topological sort. Always terminates: every parentId that survives
    // into the clipboard is guaranteed to also be IN the clipboard -
    // onCopy strips parentId whenever the parent isn't also being
    // copied, and gatherDescendants always copies an entire nested level
    // wholesale, so a node's own group (if any) at that level is never
    // left out.
    const remaining = [...clipboard.nodes];
    const idMap = new Map<string, string>();
    const remapPath = (relativePath: string[]) =>
      relativePath.map((oldId) => idMap.get(oldId) ?? oldId);

    const rootPastedIds: string[] = [];
    while (remaining.length > 0) {
      const readyIndex = remaining.findIndex(
        (n) =>
          n.relativePath.every((ancestorId) => idMap.has(ancestorId)) &&
          (!n.parentId || idMap.has(n.parentId)),
      );
      if (readyIndex === -1) break; // shouldn't happen - see comment above - but never hang if it somehow does
      const [n] = remaining.splice(readyIndex, 1);

      const isTopLevel = n.relativePath.length === 0;
      const shouldOffset = isTopLevel && !n.parentId;
      const position = shouldOffset
        ? { x: n.position.x + offset, y: n.position.y + offset }
        : n.position;
      const newParentId = n.parentId ? idMap.get(n.parentId) : undefined;
      const newId = diagramStore.addNode(
        [...path, ...remapPath(n.relativePath)],
        n.type ?? 'typed',
        position,
        n.data,
      );
      idMap.set(n.id, newId);
      if (newParentId !== undefined) diagramStore.updateParentId(newId, newParentId, position);
      if (n.width !== undefined || n.height !== undefined)
        diagramStore.updateDimensions(newId, n.width, n.height);
      if (isTopLevel) rootPastedIds.push(newId);
    }

    const newEdgeIds: string[] = [];
    for (const e of clipboard.edges) {
      const newSource = idMap.get(e.source);
      const newTarget = idMap.get(e.target);
      if (!newSource || !newTarget) continue; // shouldn't happen - every edge's endpoints were copied along with it
      const newEdgeId = diagramStore.addEdge(
        [...path, ...remapPath(e.relativePath)],
        newSource,
        newTarget,
        e.data ?? { edgeType: 'blank-solid', label: '', direction: 'forward', properties: {} },
        e.sourceHandle,
        e.targetHandle,
      );
      newEdgeIds.push(newEdgeId);
    }

    // The pasted result becomes the new selection - matches how paste
    // behaves elsewhere (Figma, PowerPoint, etc.), letting the person
    // immediately nudge/move what they just pasted. Only top-level items
    // are marked selected, matching how a normal click or rubber-band
    // selection already treats a group (the group itself gets selected,
    // not each individual child), relying on React Flow's built-in
    // parent-child dragging to move a selected group's contents together.
    setSelectedNodeIds(rootPastedIds);
    setSelectedEdgeIds(newEdgeIds);
    setPasteOffset((p) => p + 40);
  }, [clipboard, pasteOffset, diagramStore, path, setSelectedNodeIds, setSelectedEdgeIds]);

  return { onCopy, onPaste };
}
