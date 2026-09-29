import { type RefObject } from 'react';
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { type Node } from '@xyflow/react';
import { getNodeType } from '../../domain/canvas/nodeRegistry';
import { getGroupType } from '../../domain/canvas/groupRegistry';
import { globalShapeRegistry } from '../../domain/canvas/shapeRegistry';
import type { ArchNodeData } from '../../domain/canvas/types';
import type { CanvasProps } from './Canvas';

// Clamped so the menu and submenus never open partly off-screen.
export const CONTEXT_MENU_WIDTH = 184;
export const CONTEXT_MENU_HEIGHT = 240;

/**
 * The right-click menu's state: what it targets, which submenu is open,
 * the color and icon changes it applies, and dismissing it. Moved
 * unchanged from Canvas.tsx; its markup is CanvasContextMenu.
 *
 * Performance contract: runs inside Canvas's render, called at the exact
 * position its code had in Canvas.tsx, so it adds no component, no render,
 * and no change to the order effects run in. Destructure the result and
 * depend on its members - never on the returned object, which is new on
 * every render.
 */
export function useCanvasContextMenu({
  isPresenting,
  nodes,
  nodesRef,
  onUpdateNode,
}: Pick<CanvasProps, 'nodes' | 'onUpdateNode'> & {
  isPresenting: boolean;
  nodesRef: RefObject<Node<ArchNodeData>[]>;
}) {
  /**
   * Right-click menu state. Position is in VIEWPORT coordinates (the menu
   * is portaled to document.body and fixed-positioned), not flow
   * coordinates - it should stay under the cursor, not pinned to a spot
   * on the canvas that moves when you pan.
   */
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    targetIds: string[];
  } | null>(null);
  const [activeSubmenu, setActiveSubmenu] = useState<'color' | 'icon' | null>(null);

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
    setActiveSubmenu(null);
  }, []);

  const openContextMenu = useCallback(
    (event: ReactMouseEvent, nodeId: string | null) => {
      if (isPresenting) return; // the locked slideshow view has nothing to arrange
      event.preventDefault();

      const selectedIds = nodesRef.current.filter((n) => n.selected).map((n) => n.id);
      // Right-clicking inside a multi-selection acts on the whole
      // selection; right-clicking a node outside it acts on just that
      // node, which is what every other editor does and avoids silently
      // reordering something off-screen.
      const targetIds =
        nodeId === null ? selectedIds : selectedIds.includes(nodeId) ? selectedIds : [nodeId];
      if (targetIds.length === 0) return;

      // Clamped so the menu never opens partly off-screen.
      const left = Math.min(event.clientX, window.innerWidth - CONTEXT_MENU_WIDTH - 8);
      const top = Math.min(event.clientY, window.innerHeight - CONTEXT_MENU_HEIGHT - 8);
      setActiveSubmenu(null);
      setContextMenu({ x: Math.max(8, left), y: Math.max(8, top), targetIds });
    },
    [isPresenting, nodesRef],
  );

  const handleColorChange = useCallback(
    (color: string | undefined) => {
      if (!contextMenu) return;
      for (const id of contextMenu.targetIds) {
        const node = nodesRef.current.find((n) => n.id === id);
        if (node?.type === 'text') {
          onUpdateNode(id, { color, textColor: color });
        } else {
          onUpdateNode(id, { color });
        }
      }
      closeContextMenu();
    },
    [contextMenu, onUpdateNode, closeContextMenu, nodesRef],
  );

  const handleIconChange = useCallback(
    (icon: string | undefined) => {
      if (!contextMenu) return;
      for (const id of contextMenu.targetIds) {
        onUpdateNode(id, { icon });
      }
      closeContextMenu();
    },
    [contextMenu, onUpdateNode, closeContextMenu],
  );

  const targetPrimaryNode = useMemo(() => {
    if (!contextMenu || contextMenu.targetIds.length === 0) return undefined;
    return nodes.find((n) => n.id === contextMenu.targetIds[0]);
  }, [contextMenu, nodes]);

  const targetCurrentColor = useMemo(() => {
    if (!targetPrimaryNode) return undefined;
    return (
      targetPrimaryNode.data.color ??
      (targetPrimaryNode.type === 'text' ? targetPrimaryNode.data.textColor : undefined)
    );
  }, [targetPrimaryNode]);

  const targetDefaultColor = useMemo(() => {
    if (!targetPrimaryNode) return '#5B7CFA';
    if (targetPrimaryNode.type === 'typed') {
      return getNodeType(targetPrimaryNode.data.nodeType)?.color ?? '#98A2B3';
    }
    if (targetPrimaryNode.type === 'group') {
      return getGroupType(targetPrimaryNode.data.nodeType)?.color ?? '#7C8598';
    }
    if (targetPrimaryNode.type === 'shape') {
      return (
        globalShapeRegistry.getShape(targetPrimaryNode.data.nodeType)?.defaults.color ?? '#5B7CFA'
      );
    }
    if (targetPrimaryNode.type === 'code') {
      return '#22B8CF';
    }
    if (targetPrimaryNode.type === 'text') {
      return '#e7e9ee';
    }
    return '#5B7CFA';
  }, [targetPrimaryNode]);

  const targetCurrentIcon = useMemo(() => {
    if (!targetPrimaryNode) return undefined;
    return targetPrimaryNode.data.icon;
  }, [targetPrimaryNode]);

  const targetDefaultIcon = useMemo(() => {
    if (!targetPrimaryNode) return undefined;
    if (targetPrimaryNode.type === 'typed') {
      return getNodeType(targetPrimaryNode.data.nodeType)?.icon;
    }
    if (targetPrimaryNode.type === 'group') {
      return getGroupType(targetPrimaryNode.data.nodeType)?.icon;
    }
    if (targetPrimaryNode.type === 'shape') {
      return globalShapeRegistry.getShape(targetPrimaryNode.data.nodeType)?.iconId;
    }
    return undefined;
  }, [targetPrimaryNode]);

  /**
   * Both handlers are memoized rather than written inline on the
   * ReactFlow element, because React Flow hands onNodeContextMenu down
   * to EVERY NodeWrapper (which is memo'd) and puts onMoveStart in its
   * own store. An inline arrow is a new identity on every render, so it
   * would break the memo on every node at once and push a store update
   * each render - turning any Canvas re-render into a re-render of the
   * whole graph.
   */
  const onNodeContextMenu = useCallback(
    (event: ReactMouseEvent, node: Node<ArchNodeData>) => openContextMenu(event, node.id),
    [openContextMenu],
  );
  const onSelectionContextMenu = useCallback(
    (event: ReactMouseEvent) => openContextMenu(event, null),
    [openContextMenu],
  );

  useEffect(() => {
    if (!contextMenu) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeContextMenu();
    };
    // Any click anywhere dismisses, including one that lands on the menu
    // itself - the item's own onClick has already run by then.
    document.addEventListener('click', closeContextMenu);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('click', closeContextMenu);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [contextMenu, closeContextMenu]);

  return {
    contextMenu,
    activeSubmenu,
    setActiveSubmenu,
    closeContextMenu,
    handleColorChange,
    handleIconChange,
    targetCurrentColor,
    targetDefaultColor,
    targetCurrentIcon,
    targetDefaultIcon,
    onNodeContextMenu,
    onSelectionContextMenu,
  };
}
