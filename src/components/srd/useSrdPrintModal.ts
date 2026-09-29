import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import type { Node } from '@xyflow/react';
import type {
  RequirementItemViewModel,
  SrdDataContext,
  SrdTemplateConfig,
} from '../../domain/srd/srdTypes';
import {
  BUILTIN_SRD_TEMPLATES,
  DEFAULT_SRD_TEMPLATE,
  cloneTemplateConfig,
  serializeTemplateConfig,
  parseTemplateConfig,
  mergeTemplateWithDefaults,
} from '../../domain/srd/srdTemplatePresets';
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
  nodes?: Array<Node<Record<string, unknown>>>;
  selectedNodeIds?: string[];
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
  nodes,
  selectedNodeIds,
}: Required<SrdPrintModalProps>) {
  const [activePresetId, setActivePresetId] = useState<string>('enterprise_formal');
  const [templateConfig, setTemplateConfig] = useState<SrdTemplateConfig>(() =>
    cloneTemplateConfig(DEFAULT_SRD_TEMPLATE),
  );
  const [currentSrdData, setCurrentSrdData] = useState<SrdDataContext>(srdData);
  const [activeTab, setActiveTab] = useState<
    'doc' | 'theme' | 'sections' | 'snapshots' | 'headers'
  >('doc');
  const [snapshotScope, setSnapshotScope] = useState<'all' | 'selected' | 'viewport'>('all');
  const [isCapturingSnapshot, setIsCapturingSnapshot] = useState(false);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [pdfStatus, setPdfStatus] = useState('');

  // Snapshot Framing State for Requirement Items
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

  const framingPanOffset = useMemo(() => {
    if (effectiveFramingItemId && framingAdjustments[effectiveFramingItemId]?.pan) {
      return framingAdjustments[effectiveFramingItemId].pan;
    }
    if (currentFramingItem?.snapshotFraming) {
      return {
        x: currentFramingItem.snapshotFraming.offsetX,
        y: currentFramingItem.snapshotFraming.offsetY,
      };
    }
    return { x: 0, y: 0 };
  }, [effectiveFramingItemId, framingAdjustments, currentFramingItem]);

  const framingZoom = useMemo(() => {
    if (effectiveFramingItemId && framingAdjustments[effectiveFramingItemId]?.zoom != null) {
      return framingAdjustments[effectiveFramingItemId].zoom;
    }
    if (currentFramingItem?.snapshotFraming) {
      return currentFramingItem.snapshotFraming.zoom;
    }
    return 1.0;
  }, [effectiveFramingItemId, framingAdjustments, currentFramingItem]);

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

  const resetFraming = () => {
    if (!effectiveFramingItemId) return;
    setFramingAdjustments((prev) => ({
      ...prev,
      [effectiveFramingItemId]: {
        pan: { x: 0, y: 0 },
        zoom: 1.0,
      },
    }));
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
    setActivePresetId(presetId);
    const found = BUILTIN_SRD_TEMPLATES.find((t) => t.id === presetId);
    if (found) {
      setTemplateConfig(cloneTemplateConfig(found));
    }
  };

  const handleMetadataChange = <K extends keyof SrdDataContext['metadata']>(
    key: K,
    value: SrdDataContext['metadata'][K],
  ) => {
    setCurrentSrdData((prev) => ({
      ...prev,
      metadata: {
        ...prev.metadata,
        [key]: value,
      },
    }));
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
    setTemplateConfig((prev) => ({
      ...prev,
      theme: {
        ...prev.theme,
        [key]: value,
      },
    }));
    setActivePresetId('custom');
  };

  const handleHeadersChange = <K extends keyof SrdTemplateConfig['headersAndFooters']>(
    key: K,
    value: SrdTemplateConfig['headersAndFooters'][K],
  ) => {
    setTemplateConfig((prev) => ({
      ...prev,
      headersAndFooters: {
        ...prev.headersAndFooters,
        [key]: value,
      },
    }));
    setActivePresetId('custom');
  };

  const handleToggleSection = (sectionId: string, enabled: boolean) => {
    setTemplateConfig((prev) => ({
      ...prev,
      sections: prev.sections.map((s) => (s.id === sectionId ? { ...s, enabled } : s)),
    }));
    setActivePresetId('custom');
  };

  const handleMoveSection = (index: number, direction: 'up' | 'down') => {
    const sorted = [...templateConfig.sections].sort((a, b) => a.order - b.order);
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= sorted.length) return;

    const item = sorted[index];
    const targetItem = sorted[targetIndex];

    const newOrder = targetItem.order;
    targetItem.order = item.order;
    item.order = newOrder;

    setTemplateConfig((prev) => ({
      ...prev,
      sections: sorted,
    }));
    setActivePresetId('custom');
  };

  const handleSectionIntroChange = (sectionId: string, customIntroText: string) => {
    setTemplateConfig((prev) => ({
      ...prev,
      sections: prev.sections.map((s) => (s.id === sectionId ? { ...s, customIntroText } : s)),
    }));
    setActivePresetId('custom');
  };

  const handleCaptureSnapshot = async () => {
    setIsCapturingSnapshot(true);
    await new Promise((resolve) => setTimeout(resolve, 20));
    try {
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
        setTemplateConfig(mergeTemplateWithDefaults(parsed));
        setActivePresetId('custom');
      } catch (err) {
        alert((err as Error).message);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleLayoutChange = (layout: 'table' | 'list') => {
    setTemplateConfig((prev) => ({
      ...prev,
      requirementsLayout: layout,
    }));
    setActivePresetId('custom');
  };

  const handleToggleComponentTable = (enabled: boolean) => {
    setTemplateConfig((prev) => ({
      ...prev,
      includeComponentTable: enabled,
    }));
    setActivePresetId('custom');
  };

  const handleToggleConnectionsTable = (enabled: boolean) => {
    setTemplateConfig((prev) => ({
      ...prev,
      includeConnectionsTable: enabled,
    }));
    setActivePresetId('custom');
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
        }
      }
    },
    [currentFramingItem, framingPanOffset, framingZoom, nodes],
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

  // Debounced auto-capture when user finishes adjusting framing sliders
  useEffect(() => {
    if (isInteractingWithSlider) {
      return;
    }
    if (
      !effectiveFramingItemId ||
      !currentFramingItem ||
      !currentFramingItem.linkedNodeIds?.length
    ) {
      return;
    }
    const adj = framingAdjustments[effectiveFramingItemId];
    if (!adj) return;

    const currentFraming = currentFramingItem.snapshotFraming;
    if (
      currentFraming &&
      currentFraming.offsetX === adj.pan.x &&
      currentFraming.offsetY === adj.pan.y &&
      currentFraming.zoom === adj.zoom &&
      currentFramingItem.contextSnapshotBase64
    ) {
      return;
    }

    const timer = setTimeout(() => {
      handleCaptureItemSnapshot(currentFramingItem, adj.pan, adj.zoom);
    }, 200);

    return () => clearTimeout(timer);
  }, [
    isInteractingWithSlider,
    framingAdjustments,
    effectiveFramingItemId,
    currentFramingItem,
    handleCaptureItemSnapshot,
  ]);

  const handleRemoveItemSnapshot = (itemId: string) => {
    setFramingAdjustments((prev) => {
      const copy = { ...prev };
      delete copy[itemId];
      return copy;
    });
    setCurrentSrdData((prev) => {
      const nextItemsByCategory = { ...prev.requirements.itemsByCategory };
      for (const catId in nextItemsByCategory) {
        nextItemsByCategory[catId] = nextItemsByCategory[catId].map((it) => {
          if (it.id === itemId) {
            return {
              ...it,
              contextSnapshotBase64: undefined,
              snapshotFraming: undefined,
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
        const pan = it.snapshotFraming
          ? { x: it.snapshotFraming.offsetX, y: it.snapshotFraming.offsetY }
          : { x: 0, y: 0 };
        const zoom = it.snapshotFraming?.zoom ?? 1.0;
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
