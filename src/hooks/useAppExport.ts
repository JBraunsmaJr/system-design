import { useCallback, useState } from 'react';
import type { Node } from '@xyflow/react';
import type { ArchNodeData, SubDiagram } from '../domain/canvas/types';
import type { DiagramPath } from '../domain/canvas/subDiagramTree';
import { getNodesAtPath } from '../collab/stores/diagramStore';
import {
  exportDiagramAsPng,
  exportDiagramAsSvg,
  captureDiagramSnapshot,
  captureNodeSubsetSnapshot,
} from '../domain/canvas/imageExport';
import {
  aggregateSrdData,
  type SrdDataContext,
} from '../domain/srd/srdDataAggregator';
import {
  downloadSrdMarkdown,
} from '../domain/srd/srdMarkdownExport';
import {
  DEFAULT_SRD_TEMPLATE,
} from '../domain/srd/srdTemplatePresets';
import {
  downloadRequirementsMarkdown,
} from '../domain/requirements/requirementsExport';
import type { RequirementsDocument, RequirementItem } from '../domain/requirements/requirementsTypes';
import type { Milestone } from '../domain/timeline/milestones';
import type { ProgramIncrement } from '../domain/timeline/programIncrements';
import type { TeamDocument } from '../domain/timeline/teamTypes';
import type { ToastType } from '../common/components/toast/Toast';

export interface UseAppExportOptions {
  nodes: Node<ArchNodeData>[];
  title: string;
  path: DiagramPath;
  setPath: (path: DiagramPath) => void;
  diagramSnapshot: SubDiagram;
  requirementsSnapshot: RequirementsDocument;
  milestonesSnapshot: Milestone[];
  programIncrementsSnapshot: ProgramIncrement[];
  teamSnapshot: TeamDocument;
  showToast: (message: string, type?: ToastType, description?: string) => void;
}

export function useAppExport({
  nodes,
  title,
  path,
  setPath,
  diagramSnapshot,
  requirementsSnapshot,
  milestonesSnapshot,
  programIncrementsSnapshot,
  teamSnapshot,
  showToast,
}: UseAppExportOptions) {
  const [isSrdModalOpen, setIsSrdModalOpen] = useState(false);
  const [srdModalData, setSrdModalData] = useState<SrdDataContext | null>(null);
  const [isGeneratingSrd, setIsGeneratingSrd] = useState(false);

  const onExportPng = useCallback(() => {
    exportDiagramAsPng(nodes, title).catch((err) => window.alert((err as Error).message));
  }, [nodes, title]);

  const onExportSvg = useCallback(() => {
    exportDiagramAsSvg(nodes, title).catch((err) => window.alert((err as Error).message));
  }, [nodes, title]);

  const prepareSrdData = useCallback(async (): Promise<SrdDataContext> => {
    await new Promise((resolve) => setTimeout(resolve, 20));

    const initialPath = path;
    const allDocNodes = diagramSnapshot.nodes;
    const allDocEdges = diagramSnapshot.edges;

    const itemLinkedNodes = new Map<
      string,
      { item: RequirementItem; path: DiagramPath; nodeIds: string[] }[]
    >();

    const pathSet = new Map<string, DiagramPath>();
    pathSet.set(JSON.stringify([]), []);
    if (initialPath.length > 0) {
      pathSet.set(JSON.stringify(initialPath), initialPath);
    }

    for (const item of requirementsSnapshot.items) {
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
              const snap = await captureNodeSubsetSnapshot(levelNodes, entry.nodeIds, {
                width: 1200,
                height: 600,
                padding: 0.06,
              });
              if (snap) {
                itemSnapshots[entry.item.id] = snap;
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
    });
  }, [
    path,
    title,
    setPath,
    diagramSnapshot.nodes,
    diagramSnapshot.edges,
    requirementsSnapshot,
    milestonesSnapshot,
    programIncrementsSnapshot,
    teamSnapshot,
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
      downloadSrdMarkdown(data, DEFAULT_SRD_TEMPLATE);
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
  }, [prepareSrdData, showToast]);

  const onExportRequirementsMarkdown = useCallback(() => {
    downloadRequirementsMarkdown(title, requirementsSnapshot);
  }, [title, requirementsSnapshot]);

  return {
    onExportPng,
    onExportSvg,
    onExportSrdMarkdown,
    onExportRequirementsMarkdown,
    openSrdModal,
    isSrdModalOpen,
    setIsSrdModalOpen,
    srdModalData,
    isGeneratingSrd,
  };
}
