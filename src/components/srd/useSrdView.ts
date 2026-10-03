import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import type {
  RequirementItemViewModel,
  SrdDataContext,
  SrdDocumentSettings,
  SrdDocumentState,
  SrdTemplateConfig,
  SrdTemplateId,
} from '../../domain/srd/srdTypes';
import {
  serializeTemplateConfig,
  parseTemplateConfig,
  mergeTemplateWithDefaults,
} from '../../domain/srd/srdTemplatePresets';
import {
  CUSTOM_PRESET_ID,
  SRD_DIAGRAM_FRAMING_KEY,
  findBuiltinPreset,
  framingFor,
  toRenderConfig,
} from '../../domain/srd/srdSettings';
import { downloadSrdMarkdown } from '../../domain/srd/srdMarkdownExport';
import { srdPdfFileName } from '../../domain/srd/srdFileNames';
import { downloadFile } from '../../common/utils/download';
import type { SrdStore } from '../../collab/stores/yjsSrdStore';
import type { SrdSnapshots } from './capture/useSrdSnapshots';

/** Framing snapshots are rendered at, in the units the sliders use. */
const FRAMING_FRAME = { width: 1200, height: 600 };
/** Batches keyboard-driven slider changes into one document write. */
const FRAMING_COMMIT_DELAY_MS = 200;

export interface UseSrdViewOptions {
  srdStore: SrdStore;
  srd: SrdDocumentState;
  /** The document's SRD content, live, with rendered snapshots and the
   * document's state applied - exactly what prints. */
  currentSrdData: SrdDataContext;
  snapshots: Pick<SrdSnapshots, 'images' | 'isCapturing' | 'pending' | 'total' | 'refresh'>;
}

/** Everything the SRD view's panels read; each panel picks its part. */
export type SrdViewState = ReturnType<typeof useSrdView>;

type FramingAdjustment = { pan: { x: number; y: number }; zoom: number };

/**
 * The SRD view's editing state and behavior.
 *
 * Every edit is written to the document through `srdStore`, so collaborators
 * see it. The only local state is what belongs to this person's session: the
 * open tab, the requirement being framed, and slider values while they are
 * still being dragged - committed to the document on release.
 */
export function useSrdView({ srdStore, srd, currentSrdData, snapshots }: UseSrdViewOptions) {
  const { presetId: activePresetId, templateId, settings, unsupportedTemplateId } = srd;
  const templateConfig = useMemo(
    () => toRenderConfig({ presetId: activePresetId, templateId, settings }),
    [activePresetId, templateId, settings],
  );

  const [activeTab, setActiveTab] = useState<
    'doc' | 'theme' | 'sections' | 'snapshots' | 'headers'
  >('doc');
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [pdfStatus, setPdfStatus] = useState('');
  // The PDF the preview last finished drawing - exactly what the user sees,
  // so exporting or printing it needs no second render.
  const shownPdfRef = useRef<Blob | null>(null);
  const handlePdfRendered = useCallback((blob: Blob) => {
    shownPdfRef.current = blob;
  }, []);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // --- Editing ----------------------------------------------------------------

  const handleSelectTemplate = (id: SrdTemplateId) => srdStore.setTemplate(id);

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

  const handleLayoutChange = (layout: 'table' | 'list') => {
    srdStore.updateSettings({ requirementsLayout: layout });
  };

  const handleToggleComponentTable = (enabled: boolean) => {
    srdStore.updateSettings({ includeComponentTable: enabled });
  };

  const handleToggleConnectionsTable = (enabled: boolean) => {
    srdStore.updateSettings({ includeConnectionsTable: enabled });
  };

  // --- Architecture diagram ------------------------------------------------------

  const isDiagramHidden = framingFor(srd, SRD_DIAGRAM_FRAMING_KEY).hidden === true;
  const isCapturingSnapshot =
    !isDiagramHidden && snapshots.isCapturing && !snapshots.images.has(SRD_DIAGRAM_FRAMING_KEY);

  /** Shows the diagram again if it was removed, else renders it afresh. */
  const handleCaptureSnapshot = () => {
    if (isDiagramHidden) srdStore.setFraming(SRD_DIAGRAM_FRAMING_KEY, null);
    else snapshots.refresh([SRD_DIAGRAM_FRAMING_KEY]);
  };

  const handleRemoveDiagram = () => {
    srdStore.setFraming(SRD_DIAGRAM_FRAMING_KEY, {
      ...framingFor(srdStore.getSnapshot(), SRD_DIAGRAM_FRAMING_KEY),
      hidden: true,
    });
  };

  // --- Requirement snapshot framing ----------------------------------------------

  const [selectedFramingItemId, setSelectedFramingItemId] = useState<string>('');
  // Values still being dragged, by item. Committed to the document on
  // release; until then only this panel's preview reflects them.
  const [framingAdjustments, setFramingAdjustments] = useState<Record<string, FramingAdjustment>>(
    {},
  );
  const [isInteractingWithSlider, setIsInteractingWithSlider] = useState(false);

  const allRequirementItems = useMemo(() => {
    const items: RequirementItemViewModel[] = [];
    for (const catId in currentSrdData.requirements.itemsByCategory) {
      items.push(...currentSrdData.requirements.itemsByCategory[catId]);
    }
    return items;
  }, [currentSrdData.requirements.itemsByCategory]);

  const linkedRequirementItems = useMemo(
    () => allRequirementItems.filter((i) => i.linkedNodeIds && i.linkedNodeIds.length > 0),
    [allRequirementItems],
  );

  const effectiveFramingItemId = selectedFramingItemId || linkedRequirementItems[0]?.id || '';
  const currentFramingItem = useMemo(
    () => allRequirementItems.find((i) => i.id === effectiveFramingItemId),
    [allRequirementItems, effectiveFramingItemId],
  );

  const storedFraming = framingFor(srd, effectiveFramingItemId);
  const adjustment = effectiveFramingItemId
    ? framingAdjustments[effectiveFramingItemId]
    : undefined;
  const framingPanOffset = useMemo(
    () => adjustment?.pan ?? { x: storedFraming.offsetX, y: storedFraming.offsetY },
    [adjustment, storedFraming],
  );
  const framingZoom = adjustment?.zoom ?? storedFraming.zoom;

  // The panel previews an adjustment instantly by transforming the image
  // last rendered, relative to the framing it was rendered with.
  const framingBaseline = currentFramingItem?.snapshotFraming ?? {
    offsetX: 0,
    offsetY: 0,
    zoom: 1,
  };
  const framingDx = framingPanOffset.x - framingBaseline.offsetX;
  const framingDy = framingPanOffset.y - framingBaseline.offsetY;
  const framingRelZoom = framingBaseline.zoom > 0 ? framingZoom / framingBaseline.zoom : 1;
  const framingDxPercent = (framingDx / FRAMING_FRAME.width) * 100;
  const framingDyPercent = (framingDy / FRAMING_FRAME.height) * 100;
  const isFramingTransformed =
    Math.abs(framingDx) > 0.1 || Math.abs(framingDy) > 0.1 || Math.abs(framingRelZoom - 1) > 0.001;

  const adjustFraming = (update: (current: FramingAdjustment) => FramingAdjustment) => {
    if (!effectiveFramingItemId) return;
    setFramingAdjustments((prev) => ({
      ...prev,
      [effectiveFramingItemId]: update(
        prev[effectiveFramingItemId] ?? { pan: framingPanOffset, zoom: framingZoom },
      ),
    }));
  };
  const setFramingPanX = (x: number) => adjustFraming((a) => ({ ...a, pan: { ...a.pan, x } }));
  const setFramingPanY = (y: number) => adjustFraming((a) => ({ ...a, pan: { ...a.pan, y } }));
  const setFramingZoomScale = (zoom: number) => adjustFraming((a) => ({ ...a, zoom }));

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

  // Detect the end of a slider drag wherever the pointer is released.
  useEffect(() => {
    if (!isInteractingWithSlider) return;
    const release = () => setIsInteractingWithSlider(false);
    const events = ['pointerup', 'pointercancel', 'mouseup', 'touchend'] as const;
    for (const event of events) window.addEventListener(event, release);
    return () => {
      for (const event of events) window.removeEventListener(event, release);
    };
  }, [isInteractingWithSlider]);

  // Commit: once the user stops dragging, write the adjusted framing to the
  // document - one write per adjustment, not one per slider tick. The new
  // framing changes the snapshot's fingerprint, so it is rendered again.
  useEffect(() => {
    if (isInteractingWithSlider) return;
    const pending = Object.entries(framingAdjustments);
    if (pending.length === 0) return;
    const timer = setTimeout(() => {
      for (const [itemId, { pan, zoom }] of pending) {
        // Framing a snapshot shows it again if it had been removed.
        srdStore.setFraming(itemId, { offsetX: pan.x, offsetY: pan.y, zoom });
      }
      setFramingAdjustments({});
    }, FRAMING_COMMIT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [isInteractingWithSlider, framingAdjustments, srdStore]);

  /** Shows an item's snapshot again if it was removed, else renders it afresh. */
  const handleCaptureItemSnapshot = (targetItem?: RequirementItemViewModel) => {
    const item = targetItem ?? currentFramingItem;
    if (!item) return;
    const framing = framingFor(srdStore.getSnapshot(), item.id);
    if (framing.hidden) srdStore.setFraming(item.id, { ...framing, hidden: false });
    else snapshots.refresh([item.id]);
  };

  const handleRemoveItemSnapshot = (itemId: string) => {
    clearFramingAdjustment(itemId);
    srdStore.setFraming(itemId, { ...framingFor(srdStore.getSnapshot(), itemId), hidden: true });
  };

  const handleBatchCaptureAllSnapshots = () => snapshots.refresh();

  const isCapturingItemSnapshot = snapshots.isCapturing;
  const batchProgress =
    snapshots.pending > 0
      ? { current: snapshots.total - snapshots.pending + 1, total: snapshots.total }
      : null;

  // --- Export -----------------------------------------------------------------------

  /** The PDF of the current document: the one on screen when it is current,
   * else a fresh render. */
  const currentPdf = async (): Promise<Blob> => {
    const shown = shownPdfRef.current;
    if (shown) return shown;
    // In the worker, like the preview; an export is never superseded.
    const { renderSrdPdf } = await import('./pdf/srdPdfClient');
    return renderSrdPdf(currentSrdData, templateConfig);
  };

  // Whatever the preview showed is stale once the document changes.
  useEffect(() => {
    shownPdfRef.current = null;
  }, [currentSrdData, templateConfig]);

  const handleExportPdf = async () => {
    if (isExportingPdf) return;
    setIsExportingPdf(true);
    setPdfStatus('Generating PDF...');
    try {
      downloadFile(await currentPdf(), srdPdfFileName(currentSrdData));
    } catch (err) {
      console.error('PDF export error:', err);
      alert('Failed to generate PDF: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setIsExportingPdf(false);
      setPdfStatus('');
    }
  };

  const handlePrint = async () => {
    // The preview is canvases, not printable markup: print the PDF itself
    // from the browser's PDF viewer. The window is opened before awaiting,
    // so popup blockers see it as part of the click (or keypress).
    const viewer = window.open('', '_blank');
    const url = URL.createObjectURL(await currentPdf());
    if (viewer) viewer.location.href = url;
    else window.location.assign(url);
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  // In this view, Ctrl+P / Cmd+P prints the document - as it did when the
  // preview was printable markup - rather than the app around it.
  const printRef = useRef(handlePrint);
  useEffect(() => {
    printRef.current = handlePrint;
  });
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        void printRef.current();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

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

  const sortedSections = useMemo(
    () => [...templateConfig.sections].sort((a, b) => a.order - b.order),
    [templateConfig.sections],
  );

  return {
    activePresetId,
    templateConfig,
    templateId,
    unsupportedTemplateId,
    handleSelectTemplate,
    currentSrdData,
    activeTab,
    setActiveTab,
    isCapturingSnapshot,
    isDiagramHidden,
    isExportingPdf,
    pdfStatus,
    handlePdfRendered,
    selectedFramingItemId,
    setSelectedFramingItemId,
    isCapturingItemSnapshot,
    setIsInteractingWithSlider,
    batchProgress,
    fileInputRef,
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
  };
}
