import React, {
  useState,
  useMemo,
  useRef,
  useEffect,
  useCallback,
  useSyncExternalStore,
} from 'react';
import type { Node } from '@xyflow/react';
import type { DiagramPath } from '../../domain/canvas/subDiagramTree';
import type { ArchNodeData } from '../../domain/canvas/types';
import type {
  RequirementItemViewModel,
  SrdDataContext,
  SrdDocumentSettings,
  SrdSnapshotFraming,
  SrdTemplateConfig,
} from '../../domain/srd/srdTypes';
import {
  serializeTemplateConfig,
  parseTemplateConfig,
  mergeTemplateWithDefaults,
} from '../../domain/srd/srdTemplatePresets';
import {
  CUSTOM_PRESET_ID,
  applyDocumentState,
  findBuiltinPreset,
  framingFor,
  isCapturedWith,
  toRenderConfig,
} from '../../domain/srd/srdSettings';
import type { SrdStore } from '../../collab/stores/yjsSrdStore';
import { downloadSrdMarkdown } from '../../domain/srd/srdMarkdownExport';
import { downloadSrdPdf } from '../../domain/srd/srdPdfExport';
import {
  captureDiagramSnapshot,
  captureSelectedNodesSnapshot,
  captureCurrentScreenViewport,
  captureNodeSubsetSnapshot,
} from '../../domain/canvas/imageExport';

export interface SrdPrintModalProps {
  isOpen: boolean;
  onClose: () => void;
  srdData: SrdDataContext;
  /** The document's SRD settings, metadata and framing. Every edit made in
   * the modal is written here, so collaborators see the same document. */
  srdStore: SrdStore;
  nodes?: Array<Node<Record<string, unknown>>>;
  selectedNodeIds?: string[];
  currentPath?: DiagramPath;
  setPath?: (path: DiagramPath) => void;
}

const isSamePath = (a: DiagramPath = [], b: DiagramPath = []) =>
  a.length === b.length && a.every((v, i) => v === b[i]);

function getPrimaryPathForNodes(
  allNodes: Array<Node<Record<string, unknown>>>,
  nodeIds: string[],
): DiagramPath {
  const linked = allNodes.filter((n) => nodeIds.includes(n.id));
  const byPath = new Map<string, { path: DiagramPath; nodeIds: string[] }>();
  for (const node of linked) {
    const nodePath =
      ((node.data as ArchNodeData & { parentPath?: string[] })?.parentPath as string[]) || [];
    const pKey = JSON.stringify(nodePath);
    if (!byPath.has(pKey)) {
      byPath.set(pKey, { path: nodePath, nodeIds: [] });
    }
    byPath.get(pKey)!.nodeIds.push(node.id);
  }
  let primaryGroup: { path: DiagramPath; pathKey: string; nodeIds: string[] } | null = null;
  for (const [pKey, group] of byPath.entries()) {
    if (!primaryGroup || group.nodeIds.length > primaryGroup.nodeIds.length) {
      primaryGroup = { path: group.path, pathKey: pKey, nodeIds: group.nodeIds };
    }
  }
  return primaryGroup?.path || [];
}

/** Everything the SRD modal's sections read; each section picks its part. */
export type SrdModalState = ReturnType<typeof useSrdPrintModal>;

/**
 * The SRD modal's state and behavior: template and metadata editing,
 * diagram and per-requirement snapshot capture, PDF and markdown export.
 * Moved unchanged from SrdPrintModal.tsx.
 *
 * Performance contract: this hook runs inside SrdPrintModal's render, so it
 * adds no component and no render. Everything it returns is state, a ref,
 * a memoized value, or a plain handler exactly as it was in the component.
 * The handlers are recreated every render, as before; none of the sections
 * receiving them is memoized, so that costs nothing extra.
 */
export function useSrdPrintModal({
  isOpen,
  onClose,
  srdData,
  srdStore,
  nodes = [],
  selectedNodeIds = [],
  currentPath,
  setPath,
}: SrdPrintModalProps) {
  const initialPathRef = useRef<DiagramPath>(currentPath || []);
  const activeCanvasPathRef = useRef<DiagramPath>(currentPath || []);

  useEffect(() => {
    if (currentPath) {
      activeCanvasPathRef.current = currentPath;
    }
  }, [currentPath]);

  // Restore initial diagram path when modal unmounts
  useEffect(() => {
    return () => {
      if (setPath && initialPathRef.current) {
        setPath(initialPathRef.current);
      }
    };
  }, [setPath]);
  // The document's SRD. Settings, metadata and framing are read from and
  // written to the shared document; only captured images are local.
  // getSnapshot doubles as the server snapshot: the store is a plain object
  // over the document, identical wherever it is rendered.
  const srd = useSyncExternalStore(srdStore.subscribe, srdStore.getSnapshot, srdStore.getSnapshot);
  const { presetId: activePresetId, templateId, settings, metadata, framing } = srd;
  const templateConfig = useMemo(
    () => toRenderConfig({ presetId: activePresetId, templateId, settings }),
    [activePresetId, templateId, settings],
  );
  // What was captured locally; `currentSrdData` is that data as the document
  // says it should print.
  const [capturedData, setCurrentSrdData] = useState<SrdDataContext>(srdData);
  const currentSrdData = useMemo(
    () => applyDocumentState(capturedData, { metadata, framing }),
    [capturedData, metadata, framing],
  );
  const [activeTab, setActiveTab] = useState<
    'doc' | 'theme' | 'sections' | 'snapshots' | 'headers'
  >('doc');
  const [snapshotScope, setSnapshotScope] = useState<'all' | 'selected' | 'viewport'>('all');
  const [isCapturingSnapshot, setIsCapturingSnapshot] = useState(false);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [pdfStatus, setPdfStatus] = useState('');

  // Snapshot framing. The document holds each item's committed framing;
  // `framingAdjustments` holds only values still being dragged, and is
  // committed to the document when the slider is released.
  const [selectedFramingItemId, setSelectedFramingItemId] = useState<string>('');
  const [framingAdjustments, setFramingAdjustments] = useState<
    Record<string, { pan: { x: number; y: number }; zoom: number }>
  >({});
  const [isCapturingItemSnapshot, setIsCapturingItemSnapshot] = useState(false);
  const [isInteractingWithSlider, setIsInteractingWithSlider] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{ current: number; total: number } | null>(
    null,
  );
  // Per-item capture request sequence so results from superseded captures are ignored.
  const itemCaptureSeqRef = useRef<Record<string, number>>({});
  // The framing each item was last captured (or attempted) with, so a failed
  // capture is not retried until the framing changes.
  const attemptedFramingRef = useRef<Record<string, string>>({});
  // Bumped when a capture settles, so reconciliation moves on to the next
  // stale item even when a capture failed and changed no state.
  const [captureSettledCount, setCaptureSettledCount] = useState(0);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const diagramUploadInputRef = useRef<HTMLInputElement>(null);
  const paperRef = useRef<HTMLDivElement>(null);

  const allRequirementItems = useMemo(() => {
    const items: RequirementItemViewModel[] = [];
    for (const catId in currentSrdData.requirements.itemsByCategory) {
      items.push(...currentSrdData.requirements.itemsByCategory[catId]);
    }
    return items;
  }, [currentSrdData.requirements.itemsByCategory]);

  const linkedRequirementItems = useMemo(() => {
    return allRequirementItems.filter((i) => i.linkedNodeIds && i.linkedNodeIds.length > 0);
  }, [allRequirementItems]);

  const effectiveFramingItemId = selectedFramingItemId || linkedRequirementItems[0]?.id || '';

  const currentFramingItem = useMemo(() => {
    return allRequirementItems.find((i) => i.id === effectiveFramingItemId);
  }, [allRequirementItems, effectiveFramingItemId]);

  const storedFraming = framingFor(srd, effectiveFramingItemId);

  const framingPanOffset = useMemo(() => {
    if (effectiveFramingItemId && framingAdjustments[effectiveFramingItemId]?.pan) {
      return framingAdjustments[effectiveFramingItemId].pan;
    }
    return { x: storedFraming.offsetX, y: storedFraming.offsetY };
  }, [effectiveFramingItemId, framingAdjustments, storedFraming]);

  const framingZoom = useMemo(() => {
    if (effectiveFramingItemId && framingAdjustments[effectiveFramingItemId]?.zoom != null) {
      return framingAdjustments[effectiveFramingItemId].zoom;
    }
    return storedFraming.zoom;
  }, [effectiveFramingItemId, framingAdjustments, storedFraming]);

  // Live CSS transform calculations for 0ms visual preview response while adjusting sliders
  const framingBaseline = useMemo(() => {
    return currentFramingItem?.snapshotFraming || { offsetX: 0, offsetY: 0, zoom: 1.0 };
  }, [currentFramingItem?.snapshotFraming]);

  const framingDx = framingPanOffset.x - (framingBaseline.offsetX ?? 0);
  const framingDy = framingPanOffset.y - (framingBaseline.offsetY ?? 0);
  const framingRelZoom =
    framingBaseline.zoom && framingBaseline.zoom > 0 ? framingZoom / framingBaseline.zoom : 1.0;
  const framingDxPercent = (framingDx / 1200) * 100;
  const framingDyPercent = (framingDy / 600) * 100;
  const isFramingTransformed =
    Math.abs(framingDx) > 0.1 ||
    Math.abs(framingDy) > 0.1 ||
    Math.abs(framingRelZoom - 1.0) > 0.001;

  const setFramingPanX = (x: number) => {
    if (!effectiveFramingItemId) return;
    setFramingAdjustments((prev) => ({
      ...prev,
      [effectiveFramingItemId]: {
        pan: { x, y: prev[effectiveFramingItemId]?.pan?.y ?? framingPanOffset.y },
        zoom: prev[effectiveFramingItemId]?.zoom ?? framingZoom,
      },
    }));
  };

  const setFramingPanY = (y: number) => {
    if (!effectiveFramingItemId) return;
    setFramingAdjustments((prev) => ({
      ...prev,
      [effectiveFramingItemId]: {
        pan: { x: prev[effectiveFramingItemId]?.pan?.x ?? framingPanOffset.x, y },
        zoom: prev[effectiveFramingItemId]?.zoom ?? framingZoom,
      },
    }));
  };

  const setFramingZoomScale = (zoom: number) => {
    if (!effectiveFramingItemId) return;
    setFramingAdjustments((prev) => ({
      ...prev,
      [effectiveFramingItemId]: {
        pan: prev[effectiveFramingItemId]?.pan ?? framingPanOffset,
        zoom,
      },
    }));
  };

  const clearFramingAdjustment = (itemId: string) => {
    setFramingAdjustments((prev) => {
      if (!(itemId in prev)) return prev;
      const copy = { ...prev };
      delete copy[itemId];
      return copy;
    });
  };

  const resetFraming = () => {
    if (!effectiveFramingItemId) return;
    clearFramingAdjustment(effectiveFramingItemId);
    srdStore.setFraming(effectiveFramingItemId, null);
  };

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const handleSelectPreset = (presetId: string) => {
    const found = findBuiltinPreset(presetId);
    if (found) srdStore.applyPreset(found);
  };

  // Read from the store at write time rather than from the render's
  // snapshot, so rapid edits (typing) never build on a stale value.
  const updateSettings = (update: (current: SrdDocumentSettings) => Partial<SrdDocumentSettings>) =>
    srdStore.updateSettings(update(srdStore.getSnapshot().settings));

  const handleMetadataChange = <K extends keyof SrdDataContext['metadata']>(
    key: K,
    value: SrdDataContext['metadata'][K],
  ) => {
    srdStore.setMetadata({ ...srdStore.getSnapshot().metadata, [key]: value });
  };

  const handleAuthorsStringChange = (str: string) => {
    const authors = str
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => {
        const match = item.match(/^(.*?)\s*\((.*?)\)$/);
        if (match) {
          return { name: match[1].trim(), role: match[2].trim() };
        }
        return { name: item, role: 'Author' };
      });
    handleMetadataChange('authors', authors);
  };

  const authorsDisplayString = useMemo(() => {
    return currentSrdData.metadata.authors
      .map((a) => (a.role ? `${a.name} (${a.role})` : a.name))
      .join(', ');
  }, [currentSrdData.metadata.authors]);

  const handleThemeChange = <K extends keyof SrdTemplateConfig['theme']>(
    key: K,
    value: SrdTemplateConfig['theme'][K],
  ) => {
    updateSettings((current) => ({ theme: { ...current.theme, [key]: value } }));
  };

  const handleHeadersChange = <K extends keyof SrdTemplateConfig['headersAndFooters']>(
    key: K,
    value: SrdTemplateConfig['headersAndFooters'][K],
  ) => {
    updateSettings((current) => ({
      headersAndFooters: { ...current.headersAndFooters, [key]: value },
    }));
  };

  const handleToggleSection = (sectionId: string, enabled: boolean) => {
    updateSettings((current) => ({
      sections: current.sections.map((s) => (s.id === sectionId ? { ...s, enabled } : s)),
    }));
  };

  const handleMoveSection = (index: number, direction: 'up' | 'down') => {
    updateSettings((current) => {
      const sorted = [...current.sections].sort((a, b) => a.order - b.order);
      const targetIndex = direction === 'up' ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= sorted.length) return {};
      // Swapped as new objects: settings from the store are shared and
      // must never be mutated.
      const item = sorted[index];
      const target = sorted[targetIndex];
      sorted[index] = { ...item, order: target.order };
      sorted[targetIndex] = { ...target, order: item.order };
      return { sections: sorted };
    });
  };

  const handleSectionIntroChange = (sectionId: string, customIntroText: string) => {
    updateSettings((current) => ({
      sections: current.sections.map((s) => (s.id === sectionId ? { ...s, customIntroText } : s)),
    }));
  };

  const handleCaptureSnapshot = async () => {
    setIsCapturingSnapshot(true);
    await new Promise((resolve) => setTimeout(resolve, 20));
    try {
      if (setPath && snapshotScope === 'all' && !isSamePath(activeCanvasPathRef.current, [])) {
        setPath([]);
        activeCanvasPathRef.current = [];
        await new Promise((resolve) => setTimeout(resolve, 80));
      }

      let dataUrl: string | undefined;
      if (snapshotScope === 'selected' && selectedNodeIds.length > 0) {
        dataUrl = await captureSelectedNodesSnapshot(nodes, selectedNodeIds, 'png');
      } else if (snapshotScope === 'viewport') {
        dataUrl = await captureCurrentScreenViewport('png');
      } else {
        dataUrl = await captureDiagramSnapshot(nodes, 'png');
      }

      if (dataUrl) {
        setCurrentSrdData((prev) => ({
          ...prev,
          architecture: {
            ...prev.architecture,
            diagramImageBase64: dataUrl,
          },
        }));
      }
    } catch (err) {
      console.warn('Failed to capture snapshot:', err);
    } finally {
      setIsCapturingSnapshot(false);
    }
  };

  const handleUploadDiagramImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const result = event.target?.result as string;
      if (result) {
        setCurrentSrdData((prev) => ({
          ...prev,
          architecture: {
            ...prev.architecture,
            diagramImageBase64: result,
          },
        }));
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleRemoveDiagram = () => {
    setCurrentSrdData((prev) => ({
      ...prev,
      architecture: {
        ...prev.architecture,
        diagramImageBase64: undefined,
      },
    }));
  };

  const handleExportPdf = async () => {
    if (isExportingPdf) return;
    setIsExportingPdf(true);
    setPdfStatus('Generating PDF...');
    try {
      await downloadSrdPdf(currentSrdData, templateConfig, undefined, (status) => {
        setPdfStatus(status);
      });
    } catch (err) {
      console.error('PDF export error:', err);
      alert('Failed to generate PDF: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setIsExportingPdf(false);
      setPdfStatus('');
    }
  };

  const handlePrint = () => {
    window.print();
  };

  const handleDownloadMarkdown = () => {
    downloadSrdMarkdown(currentSrdData, templateConfig);
  };

  const handleExportTemplateJson = () => {
    const jsonStr = serializeTemplateConfig(templateConfig);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `srd-template-${templateConfig.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const handleImportTemplateJson = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const parsed = parseTemplateConfig(event.target?.result as string);
        srdStore.applyPreset(mergeTemplateWithDefaults(parsed), CUSTOM_PRESET_ID);
      } catch (err) {
        alert((err as Error).message);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleLayoutChange = (layout: 'table' | 'list') => {
    srdStore.updateSettings({ requirementsLayout: layout });
  };

  const handleToggleComponentTable = (enabled: boolean) => {
    srdStore.updateSettings({ includeComponentTable: enabled });
  };

  const handleToggleConnectionsTable = (enabled: boolean) => {
    srdStore.updateSettings({ includeConnectionsTable: enabled });
  };

  const handleCaptureItemSnapshot = useCallback(
    async (
      targetItem?: RequirementItemViewModel,
      panOverride?: { x: number; y: number },
      zoomOverride?: number,
    ) => {
      const item = targetItem || currentFramingItem;
      if (!item || !item.linkedNodeIds || item.linkedNodeIds.length === 0) return;
      const requestSeq = (itemCaptureSeqRef.current[item.id] ?? 0) + 1;
      itemCaptureSeqRef.current[item.id] = requestSeq;
      const isLatestRequest = () => itemCaptureSeqRef.current[item.id] === requestSeq;
      setIsCapturingItemSnapshot(true);
      await new Promise((resolve) => setTimeout(resolve, 20));
      try {
        const targetPath = getPrimaryPathForNodes(nodes, item.linkedNodeIds);
        if (setPath && !isSamePath(activeCanvasPathRef.current, targetPath)) {
          setPath(targetPath);
          activeCanvasPathRef.current = targetPath;
          await new Promise((resolve) => setTimeout(resolve, 80));
        }

        const pan = panOverride || framingPanOffset;
        const zoom = zoomOverride != null ? zoomOverride : framingZoom;
        const dataUrl = await captureNodeSubsetSnapshot(nodes, item.linkedNodeIds, {
          panOffset: pan,
          zoomMultiplier: zoom,
          width: 1200,
          height: 600,
          padding: 0.06,
        });
        // A newer capture for this item was started while this one was
        // rendering; drop the stale result. Framing adjustments are owned by
        // the user's slider input and are never overwritten here.
        if (!isLatestRequest()) return;
        if (dataUrl) {
          setCurrentSrdData((prev) => {
            const nextItemsByCategory = { ...prev.requirements.itemsByCategory };
            for (const catId in nextItemsByCategory) {
              nextItemsByCategory[catId] = nextItemsByCategory[catId].map((it) => {
                if (it.id === item.id) {
                  return {
                    ...it,
                    contextSnapshotBase64: dataUrl,
                    snapshotFraming: { offsetX: pan.x, offsetY: pan.y, zoom },
                  };
                }
                return it;
              });
            }
            return {
              ...prev,
              requirements: {
                ...prev.requirements,
                itemsByCategory: nextItemsByCategory,
              },
            };
          });
        }
      } catch (err) {
        if (isLatestRequest()) {
          console.warn('Failed to capture item snapshot:', err);
        }
      } finally {
        if (isLatestRequest()) {
          setIsCapturingItemSnapshot(false);
          setCaptureSettledCount((n) => n + 1);
        }
      }
    },
    [currentFramingItem, framingPanOffset, framingZoom, nodes, setPath],
  );

  // Global pointer release listeners to ensure we detect when the user stops dragging/holding a slider
  useEffect(() => {
    if (!isInteractingWithSlider) return;

    const handleGlobalPointerRelease = () => {
      setIsInteractingWithSlider(false);
    };

    window.addEventListener('pointerup', handleGlobalPointerRelease);
    window.addEventListener('pointercancel', handleGlobalPointerRelease);
    window.addEventListener('mouseup', handleGlobalPointerRelease);
    window.addEventListener('touchend', handleGlobalPointerRelease);

    return () => {
      window.removeEventListener('pointerup', handleGlobalPointerRelease);
      window.removeEventListener('pointercancel', handleGlobalPointerRelease);
      window.removeEventListener('mouseup', handleGlobalPointerRelease);
      window.removeEventListener('touchend', handleGlobalPointerRelease);
    };
  }, [isInteractingWithSlider]);

  // Commit: once the user stops dragging, write the adjusted framing to the
  // document - one write per adjustment, not one per slider tick. Debounced
  // so keyboard-driven slider changes are batched the same way.
  useEffect(() => {
    if (isInteractingWithSlider) return;
    const pending = Object.entries(framingAdjustments);
    if (pending.length === 0) return;
    const timer = setTimeout(() => {
      for (const [itemId, adjustment] of pending) {
        // Framing a snapshot shows it again if it had been removed.
        srdStore.setFraming(itemId, {
          offsetX: adjustment.pan.x,
          offsetY: adjustment.pan.y,
          zoom: adjustment.zoom,
        });
      }
      setFramingAdjustments({});
    }, 200);
    return () => clearTimeout(timer);
  }, [isInteractingWithSlider, framingAdjustments, srdStore]);

  // Reconcile: recapture any snapshot whose image no longer matches the
  // document's framing - after a local commit, an undo, or a collaborator's
  // edit alike. One capture at a time, the selected item first.
  useEffect(() => {
    if (isInteractingWithSlider || isCapturingItemSnapshot) return;
    const capturedById = new Map<string, RequirementItemViewModel>();
    for (const items of Object.values(capturedData.requirements.itemsByCategory)) {
      for (const item of items) capturedById.set(item.id, item);
    }
    const keyOf = (f: SrdSnapshotFraming) => `${f.offsetX}|${f.offsetY}|${f.zoom}`;
    const isStale = (item: RequirementItemViewModel) => {
      if (!item.linkedNodeIds?.length || framingAdjustments[item.id]) return false;
      const target = framingFor(srd, item.id);
      if (target.hidden) return false;
      const captured = capturedById.get(item.id);
      if (captured && isCapturedWith(captured, target)) return false;
      return attemptedFramingRef.current[item.id] !== keyOf(target);
    };
    const next =
      (currentFramingItem && isStale(currentFramingItem) ? currentFramingItem : undefined) ??
      linkedRequirementItems.find(isStale);
    if (!next) return;
    const target = framingFor(srd, next.id);
    attemptedFramingRef.current[next.id] = keyOf(target);
    void handleCaptureItemSnapshot(next, { x: target.offsetX, y: target.offsetY }, target.zoom);
  }, [
    isInteractingWithSlider,
    isCapturingItemSnapshot,
    capturedData,
    framingAdjustments,
    srd,
    currentFramingItem,
    linkedRequirementItems,
    handleCaptureItemSnapshot,
    captureSettledCount,
  ]);

  const handleRemoveItemSnapshot = (itemId: string) => {
    clearFramingAdjustment(itemId);
    srdStore.setFraming(itemId, { ...framingFor(srdStore.getSnapshot(), itemId), hidden: true });
  };

  const handleBatchCaptureAllSnapshots = async () => {
    if (linkedRequirementItems.length === 0 || nodes.length === 0) return;
    setIsCapturingItemSnapshot(true);
    setBatchProgress({ current: 0, total: linkedRequirementItems.length });
    await new Promise((resolve) => setTimeout(resolve, 20));
    try {
      const updates: Record<
        string,
        { url: string; framing: { offsetX: number; offsetY: number; zoom: number } }
      > = {};
      let count = 0;
      for (const it of linkedRequirementItems) {
        count++;
        setBatchProgress({ current: count, total: linkedRequirementItems.length });
        if (!it.linkedNodeIds || it.linkedNodeIds.length === 0) continue;
        const target = framingFor(srdStore.getSnapshot(), it.id);
        if (target.hidden) continue;

        const targetPath = getPrimaryPathForNodes(nodes, it.linkedNodeIds);
        if (setPath && !isSamePath(activeCanvasPathRef.current, targetPath)) {
          setPath(targetPath);
          activeCanvasPathRef.current = targetPath;
          await new Promise((resolve) => setTimeout(resolve, 80));
        }

        const pan = { x: target.offsetX, y: target.offsetY };
        const zoom = target.zoom;
        const dataUrl = await captureNodeSubsetSnapshot(nodes, it.linkedNodeIds, {
          panOffset: pan,
          zoomMultiplier: zoom,
          width: 1200,
          height: 600,
          padding: 0.06,
        });
        if (dataUrl) {
          updates[it.id] = { url: dataUrl, framing: { offsetX: pan.x, offsetY: pan.y, zoom } };
        }
      }

      setCurrentSrdData((prev) => {
        const nextItemsByCategory = { ...prev.requirements.itemsByCategory };
        for (const catId in nextItemsByCategory) {
          nextItemsByCategory[catId] = nextItemsByCategory[catId].map((it) => {
            if (updates[it.id]) {
              return {
                ...it,
                contextSnapshotBase64: updates[it.id].url,
                snapshotFraming: updates[it.id].framing,
              };
            }
            return it;
          });
        }
        return {
          ...prev,
          requirements: {
            ...prev.requirements,
            itemsByCategory: nextItemsByCategory,
          },
        };
      });
    } catch (err) {
      console.warn('Batch capture failed:', err);
    } finally {
      setIsCapturingItemSnapshot(false);
      setBatchProgress(null);
      setCaptureSettledCount((n) => n + 1);
    }
  };

  const sortedSections = useMemo(
    () => [...templateConfig.sections].sort((a, b) => a.order - b.order),
    [templateConfig.sections],
  );

  const activeSortedSections = useMemo(
    () => sortedSections.filter((s) => s.enabled),
    [sortedSections],
  );

  return {
    activePresetId,
    templateConfig,
    currentSrdData,
    activeTab,
    setActiveTab,
    snapshotScope,
    setSnapshotScope,
    isCapturingSnapshot,
    isExportingPdf,
    pdfStatus,
    selectedFramingItemId,
    setSelectedFramingItemId,
    isCapturingItemSnapshot,
    setIsInteractingWithSlider,
    batchProgress,
    fileInputRef,
    diagramUploadInputRef,
    paperRef,
    linkedRequirementItems,
    currentFramingItem,
    framingPanOffset,
    framingZoom,
    framingRelZoom,
    framingDxPercent,
    framingDyPercent,
    isFramingTransformed,
    setFramingPanX,
    setFramingPanY,
    setFramingZoomScale,
    resetFraming,
    handleSelectPreset,
    handleMetadataChange,
    handleAuthorsStringChange,
    authorsDisplayString,
    handleThemeChange,
    handleHeadersChange,
    handleToggleSection,
    handleMoveSection,
    handleSectionIntroChange,
    handleCaptureSnapshot,
    handleUploadDiagramImage,
    handleRemoveDiagram,
    handleExportPdf,
    handlePrint,
    handleDownloadMarkdown,
    handleExportTemplateJson,
    handleImportTemplateJson,
    handleLayoutChange,
    handleToggleComponentTable,
    handleToggleConnectionsTable,
    handleCaptureItemSnapshot,
    handleRemoveItemSnapshot,
    handleBatchCaptureAllSnapshots,
    sortedSections,
    activeSortedSections,
  };
}
