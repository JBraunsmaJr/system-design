import { useCallback, useState, type Dispatch, type SetStateAction } from 'react';
import type { Node, Edge } from '@xyflow/react';
import { getNodesAtPath } from '../../collab/stores/diagramStore';
import type { ToastType } from '../../common/components/toast/Toast';
import { captureDiagramSnapshot, captureNodeSubsetSnapshot } from '../../domain/canvas/imageExport';
import { aggregateSrdData } from '../../domain/srd/srdDataAggregator';
import { downloadSrdMarkdown } from '../../domain/srd/srdMarkdownExport';
import { applyDocumentState, framingFor, toRenderConfig } from '../../domain/srd/srdSettings';
import type {
  SrdDataContext,
  SrdDocumentState,
  SrdSnapshotFraming,
} from '../../domain/srd/srdTypes';
import type { DiagramPath } from '../../domain/canvas/subDiagramTree';
import type { ArchNodeData, ArchEdgeData } from '../../domain/canvas/types';
import type {
  RequirementItem,
  RequirementsDocument,
} from '../../domain/requirements/requirementsTypes';
import type { ProgramIncrement } from '../../domain/timeline/programIncrements';
import type { TeamDocument } from '../../domain/timeline/teamTypes';
import type { Milestone } from '../../domain/timeline/milestones';

export interface UseSrdExportOptions {
  path: DiagramPath;
  setPath: Dispatch<SetStateAction<DiagramPath>>;
  title: string;
  diagramSnapshot: { nodes: Node<ArchNodeData>[]; edges: Edge<ArchEdgeData>[] };
  requirementsSnapshot: RequirementsDocument;
  milestonesSnapshot: Milestone[];
  programIncrementsSnapshot: ProgramIncrement[];
  teamSnapshot: TeamDocument;
  /** The document's SRD: its framing drives the initial snapshot capture,
   * and its settings and metadata drive the markdown export. */
  srdSnapshot: SrdDocumentState;
  showToast: (message: string, type?: ToastType, description?: string) => void;
}

/**
 * The Solution Requirement Document: gathering its data and snapshots,
 * the print modal, and the markdown export. Moved unchanged from App.tsx;
 * prepareSrdData now lists setPath (a React setter, so no identity change).
 *
 * Performance contract (see src/app/README.md): this hook runs inside App's
 * render, so it adds no component, no render and no commit. Every value it
 * returns is either React state, a ref, or memoized with the same
 * dependencies it had in App.tsx. Callers destructure the result and depend
 * on the individual members - never on the returned object, which is new on
 * every render.
 */
export function useSrdExport({
  path,
  setPath,
  title,
  diagramSnapshot,
  requirementsSnapshot,
  milestonesSnapshot,
  programIncrementsSnapshot,
  teamSnapshot,
  srdSnapshot,
  showToast,
}: UseSrdExportOptions) {
  const [isSrdModalOpen, setIsSrdModalOpen] = useState(false);
  const [srdModalData, setSrdModalData] = useState<SrdDataContext | null>(null);
  const [isGeneratingSrd, setIsGeneratingSrd] = useState(false);

  /**
   * Shared SRD preparation used by both the print modal and the markdown
   * export: shows the loading overlay, captures the diagram and per-requirement
   * linked-node snapshots, and aggregates everything into an SrdDataContext.
   * Callers own the try/catch/finally so they can report their own errors.
   */
  const prepareSrdData = useCallback(async (): Promise<SrdDataContext> => {
    // Yield to allow the browser to immediately paint the loading overlay
    await new Promise((resolve) => setTimeout(resolve, 20));

    const initialPath = path;
    const allDocNodes = diagramSnapshot.nodes;
    const allDocEdges = diagramSnapshot.edges;

    // Group items that need snapshots by their diagram path
    const itemLinkedNodes = new Map<
      string,
      { item: RequirementItem; path: DiagramPath; nodeIds: string[] }[]
    >();

    const pathSet = new Map<string, DiagramPath>();
    // Always include root path [] and initialPath
    pathSet.set(JSON.stringify([]), []);
    if (initialPath.length > 0) {
      pathSet.set(JSON.stringify(initialPath), initialPath);
    }

    for (const item of requirementsSnapshot.items) {
      // A snapshot removed from the document is not captured at all.
      if (framingFor(srdSnapshot, item.id).hidden) continue;
      const linked = allDocNodes.filter((n) => {
        const data = (n.data || {}) as Record<string, unknown>;
        const reqIds = Array.isArray(data.linkedRequirementIds) ? data.linkedRequirementIds : [];
        return reqIds.includes(item.id);
      });
      if (linked.length === 0) continue;

      const byPath = new Map<string, { path: DiagramPath; nodeIds: string[] }>();
      for (const node of linked) {
        const nodePath =
          ((node.data as ArchNodeData & { parentPath?: string[] })?.parentPath as string[]) || [];
        const pKey = JSON.stringify(nodePath);
        if (!byPath.has(pKey)) {
          byPath.set(pKey, { path: nodePath, nodeIds: [] });
          pathSet.set(pKey, nodePath);
        }
        byPath.get(pKey)!.nodeIds.push(node.id);
      }

      let primaryGroup: { path: DiagramPath; pathKey: string; nodeIds: string[] } | null = null;
      for (const [pKey, group] of byPath.entries()) {
        if (!primaryGroup || group.nodeIds.length > primaryGroup.nodeIds.length) {
          primaryGroup = { path: group.path, pathKey: pKey, nodeIds: group.nodeIds };
        }
      }

      if (primaryGroup) {
        const list = itemLinkedNodes.get(primaryGroup.pathKey) || [];
        list.push({ item, path: primaryGroup.path, nodeIds: primaryGroup.nodeIds });
        itemLinkedNodes.set(primaryGroup.pathKey, list);
      }
    }

    let diagramImg: string | undefined;
    const itemSnapshots: Record<string, string> = {};
    const itemFramings: Record<string, SrdSnapshotFraming> = {};

    const isSamePath = (a: DiagramPath, b: DiagramPath) =>
      a.length === b.length && a.every((v, i) => v === b[i]);

    try {
      let currentActivePath = path;
      for (const [pKey, p] of pathSet.entries()) {
        const itemsToCapture = itemLinkedNodes.get(pKey) || [];
        const isRoot = p.length === 0;

        if (!isRoot && itemsToCapture.length === 0) continue;

        if (!isSamePath(currentActivePath, p)) {
          setPath(p);
          currentActivePath = p;
          await new Promise((resolve) => setTimeout(resolve, 80));
        }

        const levelNodes = getNodesAtPath(allDocNodes, p);
        if (levelNodes.length > 0) {
          if (isRoot) {
            try {
              diagramImg = await captureDiagramSnapshot(levelNodes, 'png');
            } catch (err) {
              console.warn('Failed to capture root diagram snapshot:', err);
            }
          }

          for (const entry of itemsToCapture) {
            try {
              // Captured with the document's framing, so everyone opening
              // the SRD renders the same snapshot.
              const framing = framingFor(srdSnapshot, entry.item.id);
              const snap = await captureNodeSubsetSnapshot(levelNodes, entry.nodeIds, {
                panOffset: { x: framing.offsetX, y: framing.offsetY },
                zoomMultiplier: framing.zoom,
                width: 1200,
                height: 600,
                padding: 0.06,
              });
              if (snap) {
                itemSnapshots[entry.item.id] = snap;
                itemFramings[entry.item.id] = {
                  offsetX: framing.offsetX,
                  offsetY: framing.offsetY,
                  zoom: framing.zoom,
                };
              }
            } catch (err) {
              console.warn('Failed to snapshot linked nodes for item', entry.item.id, err);
            }
          }
        }
      }
      if (!isSamePath(currentActivePath, initialPath)) {
        setPath(initialPath);
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    } catch (err) {
      console.warn('Error during SRD snapshot capture:', err);
      if (!isSamePath(path, initialPath)) {
        setPath(initialPath);
      }
    }

    return aggregateSrdData({
      title,
      nodes: allDocNodes,
      edges: allDocEdges,
      doc: requirementsSnapshot,
      milestones: milestonesSnapshot,
      programIncrements: programIncrementsSnapshot,
      teamDoc: teamSnapshot,
      diagramImageBase64: diagramImg,
      itemSnapshots,
      itemFramings,
    });
  }, [
    path,
    setPath,
    title,
    diagramSnapshot.nodes,
    diagramSnapshot.edges,
    requirementsSnapshot,
    milestonesSnapshot,
    programIncrementsSnapshot,
    teamSnapshot,
    srdSnapshot,
  ]);

  const openSrdModal = useCallback(async () => {
    setIsGeneratingSrd(true);
    try {
      const data = await prepareSrdData();
      setSrdModalData(data);
      setIsSrdModalOpen(true);
    } catch (err) {
      console.warn('Failed to prepare SRD:', err);
      showToast('Failed to prepare SRD', 'error', err instanceof Error ? err.message : undefined);
    } finally {
      setIsGeneratingSrd(false);
    }
  }, [prepareSrdData, showToast]);

  const onExportSrdMarkdown = useCallback(async () => {
    setIsGeneratingSrd(true);
    try {
      const data = await prepareSrdData();
      // The document's own settings and metadata, as the modal would export.
      downloadSrdMarkdown(applyDocumentState(data, srdSnapshot), toRenderConfig(srdSnapshot));
    } catch (err) {
      console.warn('Failed to export SRD markdown:', err);
      showToast(
        'Failed to export SRD markdown',
        'error',
        err instanceof Error ? err.message : undefined,
      );
    } finally {
      setIsGeneratingSrd(false);
    }
  }, [prepareSrdData, srdSnapshot, showToast]);

  return {
    isSrdModalOpen,
    setIsSrdModalOpen,
    srdModalData,
    isGeneratingSrd,
    openSrdModal,
    onExportSrdMarkdown,
  };
}
