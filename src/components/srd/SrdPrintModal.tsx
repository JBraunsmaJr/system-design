import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import type { Node } from '@xyflow/react';
import {
  Printer,
  FileDown,
  Upload,
  Download,
  X,
  ArrowUp,
  ArrowDown,
  RotateCcw,
  Palette,
  Sliders,
  FileText,
  Building2,
  Camera,
  Trash2,
  RefreshCw,
  List,
  Table as TableIcon,
} from 'lucide-react';
import type {
  RequirementItemViewModel,
  SrdDataContext,
  SrdTemplateConfig,
} from '../../domain/srdTypes';
import {
  BUILTIN_SRD_TEMPLATES,
  DEFAULT_SRD_TEMPLATE,
  cloneTemplateConfig,
  serializeTemplateConfig,
  parseTemplateConfig,
} from '../../domain/srdTemplatePresets';
import { downloadSrdMarkdown, interpolateTokens } from '../../domain/srdMarkdownExport';
import {
  captureDiagramSnapshot,
  captureSelectedNodesSnapshot,
  captureCurrentScreenViewport,
  captureNodeSubsetSnapshot,
} from '../../domain/imageExport';
import './SrdPrintModal.css';

interface AutoResizeTextareaProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  minHeight?: number;
}

function AutoResizeTextarea({
  value,
  onChange,
  placeholder,
  className,
  minHeight = 44,
}: AutoResizeTextareaProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.max(minHeight, el.scrollHeight + 2)}px`;
  }, [value, minHeight]);

  return (
    <textarea
      ref={textareaRef}
      className={className}
      value={value}
      placeholder={placeholder}
      onChange={(e) => {
        onChange(e.target.value);
        const el = textareaRef.current;
        if (el) {
          el.style.height = 'auto';
          el.style.height = `${Math.max(minHeight, el.scrollHeight + 2)}px`;
        }
      }}
      style={{
        width: '100%',
        fontSize: '0.75rem',
        overflow: 'hidden',
        resize: 'vertical',
        minHeight: `${minHeight}px`,
        boxSizing: 'border-box',
        lineHeight: '1.45',
      }}
    />
  );
}

interface SrdPrintModalProps {
  isOpen: boolean;
  onClose: () => void;
  srdData: SrdDataContext;
  nodes?: Array<Node<Record<string, unknown>>>;
  selectedNodeIds?: string[];
}

export function SrdPrintModal({
  isOpen,
  onClose,
  srdData,
  nodes = [],
  selectedNodeIds = [],
}: SrdPrintModalProps) {
  const [activePresetId, setActivePresetId] = useState<string>('enterprise_formal');
  const [templateConfig, setTemplateConfig] = useState<SrdTemplateConfig>(() =>
    cloneTemplateConfig(DEFAULT_SRD_TEMPLATE),
  );
  const [currentSrdData, setCurrentSrdData] = useState<SrdDataContext>(srdData);
  const [activeTab, setActiveTab] = useState<'doc' | 'theme' | 'sections' | 'snapshots' | 'headers'>('doc');
  const [snapshotScope, setSnapshotScope] = useState<'all' | 'selected' | 'viewport'>('all');
  const [isCapturingSnapshot, setIsCapturingSnapshot] = useState(false);

  // Snapshot Framing State for Requirement Items
  const [selectedFramingItemId, setSelectedFramingItemId] = useState<string>('');
  const [framingAdjustments, setFramingAdjustments] = useState<
    Record<string, { pan: { x: number; y: number }; zoom: number }>
  >({});
  const [isCapturingItemSnapshot, setIsCapturingItemSnapshot] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{ current: number; total: number } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const diagramUploadInputRef = useRef<HTMLInputElement>(null);

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

  const effectiveFramingItemId =
    selectedFramingItemId || linkedRequirementItems[0]?.id || '';

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
        setTemplateConfig(parsed);
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
          padding: 0.25,
        });
        if (dataUrl) {
          setFramingAdjustments((prev) => ({
            ...prev,
            [item.id]: { pan: { x: pan.x, y: pan.y }, zoom },
          }));
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
        console.warn('Failed to capture item snapshot:', err);
      } finally {
        setIsCapturingItemSnapshot(false);
      }
    },
    [currentFramingItem, framingPanOffset, framingZoom, nodes],
  );

  // Debounced auto-capture when user adjusts framing sliders
  useEffect(() => {
    if (!effectiveFramingItemId || !currentFramingItem || !currentFramingItem.linkedNodeIds?.length) {
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
    }, 250);

    return () => clearTimeout(timer);
  }, [framingAdjustments, effectiveFramingItemId, currentFramingItem, handleCaptureItemSnapshot]);

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
          padding: 0.25,
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

  if (!isOpen) return null;

  return (
    <div className="srd-modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="srd-modal">
        {/* Modal Header */}
        <div className="srd-modal__header">
          <div className="srd-modal__title-group">
            <FileText size={20} color="#3b82f6" />
            <div>
              <h2 className="srd-modal__title">Solution Requirement Document (SRD) Generator</h2>
              <p className="srd-modal__subtitle">
                Customize corporate metadata, configure sections, and export as Markdown or Print/PDF.
              </p>
            </div>
          </div>
          <div className="srd-modal__header-actions">
            <button
              type="button"
              className="srd-btn-icon"
              onClick={handlePrint}
              title="Print / Save as PDF (Ctrl+P)"
              style={{
                backgroundColor: '#2563eb',
                color: '#ffffff',
                padding: '0.4rem 0.8rem',
                gap: '0.4rem',
                fontWeight: 600,
              }}
            >
              <Printer size={16} />
              <span>Print / PDF</span>
            </button>
            <button
              type="button"
              className="srd-btn-icon"
              onClick={handleDownloadMarkdown}
              title="Download GitHub-Flavored Markdown"
              style={{ padding: '0.4rem 0.8rem', gap: '0.4rem', fontWeight: 500 }}
            >
              <FileDown size={16} />
              <span>Export .md</span>
            </button>
            <button
              type="button"
              className="srd-btn-icon"
              onClick={onClose}
              title="Close modal (Esc)"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="srd-modal__body">
          {/* Customization Sidebar */}
          <div className="srd-sidebar">
            {/* Preset Selector */}
            <div>
              <label className="srd-sidebar__section-title">
                <Sliders size={14} />
                <span>Template Profile</span>
              </label>
              <select
                className="srd-sidebar__select"
                style={{ width: '100%' }}
                value={activePresetId}
                onChange={(e) => handleSelectPreset(e.target.value)}
              >
                {BUILTIN_SRD_TEMPLATES.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.name}
                  </option>
                ))}
                {activePresetId === 'custom' && <option value="custom">Custom Configuration</option>}
              </select>
            </div>

            {/* Sidebar Tabs */}
            <div style={{ display: 'flex', gap: '0.2rem', borderBottom: '1px solid #374151' }}>
              <button
                type="button"
                className="srd-btn-icon"
                style={{
                  flex: 1,
                  padding: '0.45rem 0.15rem',
                  borderRadius: '4px 4px 0 0',
                  borderBottom: 'none',
                  backgroundColor: activeTab === 'doc' ? '#1f2937' : 'transparent',
                  color: activeTab === 'doc' ? '#3b82f6' : '#9ca3af',
                  fontWeight: 600,
                  fontSize: '0.72rem',
                }}
                onClick={() => setActiveTab('doc')}
              >
                <Building2 size={12} style={{ marginRight: 2 }} /> Doc
              </button>
              <button
                type="button"
                className="srd-btn-icon"
                style={{
                  flex: 1,
                  padding: '0.45rem 0.15rem',
                  borderRadius: '4px 4px 0 0',
                  borderBottom: 'none',
                  backgroundColor: activeTab === 'sections' ? '#1f2937' : 'transparent',
                  color: activeTab === 'sections' ? '#3b82f6' : '#9ca3af',
                  fontWeight: 600,
                  fontSize: '0.72rem',
                }}
                onClick={() => setActiveTab('sections')}
              >
                <Sliders size={12} style={{ marginRight: 2 }} /> Layout
              </button>
              <button
                type="button"
                className="srd-btn-icon"
                style={{
                  flex: 1,
                  padding: '0.45rem 0.15rem',
                  borderRadius: '4px 4px 0 0',
                  borderBottom: 'none',
                  backgroundColor: activeTab === 'snapshots' ? '#1f2937' : 'transparent',
                  color: activeTab === 'snapshots' ? '#3b82f6' : '#9ca3af',
                  fontWeight: 600,
                  fontSize: '0.72rem',
                }}
                onClick={() => setActiveTab('snapshots')}
              >
                <Camera size={12} style={{ marginRight: 2 }} /> Snapshots
              </button>
              <button
                type="button"
                className="srd-btn-icon"
                style={{
                  flex: 1,
                  padding: '0.45rem 0.15rem',
                  borderRadius: '4px 4px 0 0',
                  borderBottom: 'none',
                  backgroundColor: activeTab === 'theme' ? '#1f2937' : 'transparent',
                  color: activeTab === 'theme' ? '#3b82f6' : '#9ca3af',
                  fontWeight: 600,
                  fontSize: '0.72rem',
                }}
                onClick={() => setActiveTab('theme')}
              >
                <Palette size={12} style={{ marginRight: 2 }} /> Theme
              </button>
              <button
                type="button"
                className="srd-btn-icon"
                style={{
                  flex: 1,
                  padding: '0.45rem 0.15rem',
                  borderRadius: '4px 4px 0 0',
                  borderBottom: 'none',
                  backgroundColor: activeTab === 'headers' ? '#1f2937' : 'transparent',
                  color: activeTab === 'headers' ? '#3b82f6' : '#9ca3af',
                  fontWeight: 600,
                  fontSize: '0.72rem',
                }}
                onClick={() => setActiveTab('headers')}
              >
                <FileText size={12} style={{ marginRight: 2 }} /> Headers
              </button>
            </div>

            {/* Tab: Document & Metadata */}
            {activeTab === 'doc' && (
              <div className="srd-sidebar__field-group">
                <div className="srd-sidebar__field">
                  <label className="srd-sidebar__label">Organization</label>
                  <input
                    type="text"
                    className="srd-sidebar__input"
                    placeholder="e.g. Acme Corporation"
                    value={currentSrdData.metadata.organization || ''}
                    onChange={(e) => handleMetadataChange('organization', e.target.value)}
                  />
                </div>

                <div className="srd-sidebar__field">
                  <label className="srd-sidebar__label">Document Title</label>
                  <input
                    type="text"
                    className="srd-sidebar__input"
                    value={currentSrdData.metadata.title}
                    onChange={(e) => handleMetadataChange('title', e.target.value)}
                  />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: '0.5rem', width: '100%' }}>
                  <div className="srd-sidebar__field" style={{ minWidth: 0 }}>
                    <label className="srd-sidebar__label">Version</label>
                    <input
                      type="text"
                      className="srd-sidebar__input"
                      value={currentSrdData.metadata.version}
                      onChange={(e) => handleMetadataChange('version', e.target.value)}
                    />
                  </div>
                  <div className="srd-sidebar__field" style={{ minWidth: 0 }}>
                    <label className="srd-sidebar__label">Date</label>
                    <input
                      type="text"
                      className="srd-sidebar__input"
                      value={currentSrdData.metadata.generatedAt}
                      onChange={(e) => handleMetadataChange('generatedAt', e.target.value)}
                    />
                  </div>
                </div>

                <div className="srd-sidebar__field">
                  <label className="srd-sidebar__label">Authors / Contributors</label>
                  <input
                    type="text"
                    className="srd-sidebar__input"
                    placeholder="e.g. Alice (Lead Architect), Bob (Tech Lead)"
                    value={authorsDisplayString}
                    onChange={(e) => handleAuthorsStringChange(e.target.value)}
                  />
                </div>

                <div className="srd-sidebar__field">
                  <label className="srd-sidebar__label">Executive Scope & Description</label>
                  <AutoResizeTextarea
                    className="srd-sidebar__textarea"
                    placeholder="Executive scope and solution objectives..."
                    value={currentSrdData.metadata.description || ''}
                    onChange={(val) => handleMetadataChange('description', val)}
                  />
                </div>

                {/* Specific Diagram Snapshot Controls */}
                <div style={{ marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid #374151' }}>
                  <div className="srd-sidebar__section-title">
                    <Camera size={14} />
                    <span>Diagram Snapshot</span>
                  </div>

                  <div className="srd-sidebar__field" style={{ marginBottom: '0.5rem' }}>
                    <label className="srd-sidebar__label">Capture Target</label>
                    <select
                      className="srd-sidebar__select"
                      value={snapshotScope}
                      onChange={(e) => setSnapshotScope(e.target.value as 'all' | 'selected' | 'viewport')}
                    >
                      <option value="all">Full Diagram (All {nodes.length} Nodes)</option>
                      <option value="selected" disabled={selectedNodeIds.length === 0}>
                        Selected Nodes Only ({selectedNodeIds.length} selected)
                      </option>
                      <option value="viewport">Current Viewport (Exact Canvas View)</option>
                    </select>
                  </div>

                  <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      className="srd-btn-icon"
                      style={{ flex: 1, padding: '0.4rem', gap: '0.3rem', backgroundColor: '#1e3a8a', color: '#ffffff' }}
                      onClick={handleCaptureSnapshot}
                      disabled={isCapturingSnapshot}
                      title="Capture diagram snapshot from canvas"
                    >
                      <RefreshCw size={13} className={isCapturingSnapshot ? 'animate-spin' : ''} />
                      <span>{isCapturingSnapshot ? 'Capturing...' : 'Capture Snapshot'}</span>
                    </button>
                    <button
                      type="button"
                      className="srd-btn-icon"
                      style={{ padding: '0.4rem', gap: '0.3rem' }}
                      onClick={() => diagramUploadInputRef.current?.click()}
                      title="Upload custom PNG or SVG image"
                    >
                      <Upload size={13} />
                      <span>Upload</span>
                    </button>
                    {currentSrdData.architecture.diagramImageBase64 && (
                      <button
                        type="button"
                        className="srd-btn-icon"
                        style={{ padding: '0.4rem', color: '#f87171' }}
                        onClick={handleRemoveDiagram}
                        title="Remove diagram from document"
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                    <input
                      type="file"
                      ref={diagramUploadInputRef}
                      style={{ display: 'none' }}
                      accept="image/png,image/jpeg,image/svg+xml"
                      onChange={handleUploadDiagramImage}
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Tab: Theme */}
            {activeTab === 'theme' && (
              <div className="srd-sidebar__field-group">
                <div className="srd-sidebar__field">
                  <label className="srd-sidebar__label">Primary Brand Color</label>
                  <div className="srd-sidebar__color-picker-row">
                    <input
                      type="color"
                      className="srd-sidebar__color-input"
                      value={templateConfig.theme.primaryColor}
                      onChange={(e) => handleThemeChange('primaryColor', e.target.value)}
                    />
                    <input
                      type="text"
                      className="srd-sidebar__input"
                      style={{ flex: 1 }}
                      value={templateConfig.theme.primaryColor}
                      onChange={(e) => handleThemeChange('primaryColor', e.target.value)}
                    />
                  </div>
                </div>

                <div className="srd-sidebar__field">
                  <label className="srd-sidebar__label">Accent Color</label>
                  <div className="srd-sidebar__color-picker-row">
                    <input
                      type="color"
                      className="srd-sidebar__color-input"
                      value={templateConfig.theme.accentColor}
                      onChange={(e) => handleThemeChange('accentColor', e.target.value)}
                    />
                    <input
                      type="text"
                      className="srd-sidebar__input"
                      style={{ flex: 1 }}
                      value={templateConfig.theme.accentColor}
                      onChange={(e) => handleThemeChange('accentColor', e.target.value)}
                    />
                  </div>
                </div>

                <div className="srd-sidebar__field">
                  <label className="srd-sidebar__label">Font Family</label>
                  <select
                    className="srd-sidebar__select"
                    value={templateConfig.theme.fontFamily}
                    onChange={(e) => handleThemeChange('fontFamily', e.target.value)}
                  >
                    <option value="Inter, system-ui, sans-serif">Inter (Modern Sans)</option>
                    <option value="'JetBrains Mono', monospace">JetBrains Mono (Technical)</option>
                    <option value="Georgia, serif">Georgia (Editorial Serif)</option>
                    <option value="system-ui, -apple-system, sans-serif">System Native</option>
                  </select>
                </div>

                <div className="srd-sidebar__field">
                  <label className="srd-sidebar__label">Page Orientation</label>
                  <select
                    className="srd-sidebar__select"
                    value={templateConfig.theme.pageOrientation}
                    onChange={(e) =>
                      handleThemeChange('pageOrientation', e.target.value as 'portrait' | 'landscape')
                    }
                  >
                    <option value="portrait">Portrait</option>
                    <option value="landscape">Landscape</option>
                  </select>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.5rem' }}>
                  <input
                    type="checkbox"
                    id="denseTablesCheckbox"
                    checked={templateConfig.theme.tableDense}
                    onChange={(e) => handleThemeChange('tableDense', e.target.checked)}
                  />
                  <label htmlFor="denseTablesCheckbox" className="srd-sidebar__label" style={{ cursor: 'pointer' }}>
                    Compact / Dense Table Layout
                  </label>
                </div>
              </div>
            )}

            {/* Tab: Sections & Layout */}
            {activeTab === 'sections' && (
              <div className="srd-sidebar__field-group">
                <div className="srd-sidebar__field">
                  <label className="srd-sidebar__label">Requirements Display Layout</label>
                  <div className="srd-layout-toggle-group">
                    <button
                      type="button"
                      className={`srd-layout-toggle-btn ${
                        (templateConfig.requirementsLayout || 'list') === 'list'
                          ? 'srd-layout-toggle-btn--active'
                          : ''
                      }`}
                      onClick={() => handleLayoutChange('list')}
                    >
                      <List size={16} />
                      <span>List View (Cards & Context)</span>
                    </button>
                    <button
                      type="button"
                      className={`srd-layout-toggle-btn ${
                        templateConfig.requirementsLayout === 'table'
                          ? 'srd-layout-toggle-btn--active'
                          : ''
                      }`}
                      onClick={() => handleLayoutChange('table')}
                    >
                      <TableIcon size={16} />
                      <span>Table View (Dense)</span>
                    </button>
                  </div>
                </div>

                <div className="srd-sidebar__field" style={{ marginTop: '0.25rem', paddingBottom: '0.75rem', borderBottom: '1px solid #374151' }}>
                  <label className="srd-sidebar__label">Architecture Detail Tables</label>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <input
                        type="checkbox"
                        id="includeComponentTableCheckbox"
                        checked={!!templateConfig.includeComponentTable}
                        onChange={(e) => handleToggleComponentTable(e.target.checked)}
                      />
                      <label htmlFor="includeComponentTableCheckbox" className="srd-sidebar__label" style={{ cursor: 'pointer', margin: 0 }}>
                        Include Full Component Inventory Table
                      </label>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <input
                        type="checkbox"
                        id="includeConnectionsTableCheckbox"
                        checked={!!templateConfig.includeConnectionsTable}
                        onChange={(e) => handleToggleConnectionsTable(e.target.checked)}
                      />
                      <label htmlFor="includeConnectionsTableCheckbox" className="srd-sidebar__label" style={{ cursor: 'pointer', margin: 0 }}>
                        Include Connections & Data Flows Table
                      </label>
                    </div>
                  </div>
                  <p style={{ fontSize: '0.6875rem', color: '#9ca3af', margin: '0.35rem 0 0 0' }}>
                    Leave unchecked to keep architecture overview clean and focused on visual diagrams.
                  </p>
                </div>

                <div className="srd-sidebar__section-title">Toggle & Order Sections</div>
                {sortedSections.map((section, idx) => (
                  <div key={section.id} style={{ marginBottom: '0.85rem' }}>
                    <div className="srd-sidebar__section-item" style={{ marginBottom: section.enabled ? '0.35rem' : '0' }}>
                      <div className="srd-sidebar__section-item-left">
                        <input
                          type="checkbox"
                          checked={section.enabled}
                          onChange={(e) => handleToggleSection(section.id, e.target.checked)}
                        />
                        <span style={{ fontWeight: section.enabled ? 600 : 400, color: section.enabled ? '#ffffff' : '#6b7280' }}>
                          {section.title}
                        </span>
                      </div>
                      <div className="srd-sidebar__section-item-actions">
                        <button
                          type="button"
                          className="srd-btn-icon"
                          disabled={idx === 0}
                          onClick={() => handleMoveSection(idx, 'up')}
                          title="Move Up"
                        >
                          <ArrowUp size={12} />
                        </button>
                        <button
                          type="button"
                          className="srd-btn-icon"
                          disabled={idx === sortedSections.length - 1}
                          onClick={() => handleMoveSection(idx, 'down')}
                          title="Move Down"
                        >
                          <ArrowDown size={12} />
                        </button>
                      </div>
                    </div>
                    {section.enabled && (
                      <AutoResizeTextarea
                        className="srd-sidebar__textarea"
                        placeholder="Custom section introduction text..."
                        value={section.customIntroText || ''}
                        onChange={(val) => handleSectionIntroChange(section.id, val)}
                      />
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Tab: Snapshots & Framing */}
            {activeTab === 'snapshots' && (
              <div className="srd-sidebar__field-group">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div className="srd-sidebar__section-title" style={{ margin: 0 }}>
                    <Camera size={14} />
                    <span>Linked Context Snapshots</span>
                  </div>
                  {linkedRequirementItems.length > 0 && (
                    <button
                      type="button"
                      className="srd-btn-icon"
                      style={{ fontSize: '0.6875rem', padding: '0.25rem 0.5rem', color: '#60a5fa' }}
                      onClick={handleBatchCaptureAllSnapshots}
                      disabled={isCapturingItemSnapshot}
                      title="Auto-capture snapshots for all linked requirement items"
                    >
                      <RefreshCw size={11} className={isCapturingItemSnapshot ? 'animate-spin' : ''} style={{ marginRight: 3 }} />
                      {batchProgress
                        ? `Capturing (${batchProgress.current}/${batchProgress.total})`
                        : 'Batch Capture All'}
                    </button>
                  )}
                </div>

                {linkedRequirementItems.length === 0 ? (
                  <div style={{ backgroundColor: '#1e293b', border: '1px solid #374151', borderRadius: '6px', padding: '1rem', textAlign: 'center', color: '#9ca3af', fontSize: '0.8125rem' }}>
                    <p style={{ margin: '0 0 0.5rem 0', fontWeight: 600, color: '#e2e8f0' }}>No Linked Requirements</p>
                    <p style={{ margin: 0, fontSize: '0.75rem', lineHeight: '1.4' }}>
                      To embed focused architectural snapshots, link requirement items to canvas nodes in the diagram.
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="srd-sidebar__field">
                      <label className="srd-sidebar__label">Select Requirement Item</label>
                      <select
                        className="srd-sidebar__select"
                        value={selectedFramingItemId}
                        onChange={(e) => setSelectedFramingItemId(e.target.value)}
                      >
                        {linkedRequirementItems.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.id}: {item.title || '(Untitled)'} ({item.linkedNodeLabels?.length || 0} nodes)
                          </option>
                        ))}
                      </select>
                    </div>

                    {currentFramingItem && (
                      <div className="srd-framing-panel">
                        <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
                          <strong style={{ color: '#ffffff' }}>{currentFramingItem.id}</strong>: {currentFramingItem.title}
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem', marginTop: '0.35rem' }}>
                            {currentFramingItem.linkedNodeLabels?.map((lbl, idx) => (
                              <span key={idx} className="srd-doc__node-tag">
                                {lbl}
                              </span>
                            ))}
                          </div>
                        </div>

                        <div className="srd-framing-preview-box">
                          {isCapturingItemSnapshot && (
                            <div className="srd-framing-loading-overlay">
                              <div className="srd-loading-spinner" style={{ width: 22, height: 22, borderWidth: 2 }} />
                              <span style={{ fontSize: '0.75rem', fontWeight: 600 }}>
                                {batchProgress
                                  ? `Capturing (${batchProgress.current}/${batchProgress.total})...`
                                  : 'Updating snapshot...'}
                              </span>
                            </div>
                          )}
                          {currentFramingItem.contextSnapshotBase64 ? (
                            <img
                              src={currentFramingItem.contextSnapshotBase64}
                              alt="Context preview"
                              className="srd-framing-preview-img"
                            />
                          ) : (
                            <div style={{ color: '#64748b', fontSize: '0.75rem', textAlign: 'center', padding: '1rem' }}>
                              <Camera size={24} style={{ margin: '0 auto 0.5rem auto', opacity: 0.5 }} />
                              No snapshot captured yet. Click Capture to frame linked nodes.
                            </div>
                          )}
                        </div>

                        <div className="srd-framing-grid">
                          <div>
                            <div className="srd-framing-slider-label">
                              <span>Pan X Offset</span>
                              <span>{framingPanOffset.x}px</span>
                            </div>
                            <input
                              type="range"
                              className="srd-framing-slider"
                              min="-800"
                              max="800"
                              step="10"
                              value={framingPanOffset.x}
                              onChange={(e) => setFramingPanX(parseInt(e.target.value, 10))}
                            />
                          </div>
                          <div>
                            <div className="srd-framing-slider-label">
                              <span>Pan Y Offset</span>
                              <span>{framingPanOffset.y}px</span>
                            </div>
                            <input
                              type="range"
                              className="srd-framing-slider"
                              min="-600"
                              max="600"
                              step="10"
                              value={framingPanOffset.y}
                              onChange={(e) => setFramingPanY(parseInt(e.target.value, 10))}
                            />
                          </div>
                        </div>

                        <div>
                          <div className="srd-framing-slider-label">
                            <span>Zoom Scale</span>
                            <span>{framingZoom.toFixed(2)}x</span>
                          </div>
                          <input
                            type="range"
                            className="srd-framing-slider"
                            min="0.2"
                            max="3.0"
                            step="0.05"
                            value={framingZoom}
                            onChange={(e) => setFramingZoomScale(parseFloat(e.target.value))}
                          />
                        </div>

                        <div className="srd-framing-btn-row">
                          <button
                            type="button"
                            className="srd-btn-icon"
                            style={{ flex: 1, padding: '0.4rem', fontSize: '0.75rem', backgroundColor: '#2563eb', color: '#ffffff', fontWeight: 600 }}
                            onClick={() => handleCaptureItemSnapshot()}
                            disabled={isCapturingItemSnapshot}
                          >
                            <RefreshCw size={12} className={isCapturingItemSnapshot ? 'animate-spin' : ''} style={{ marginRight: 4 }} />
                            {currentFramingItem.contextSnapshotBase64 ? 'Update Snapshot' : 'Capture Snapshot'}
                          </button>
                          <button
                            type="button"
                            className="srd-btn-icon"
                            style={{ padding: '0.4rem 0.6rem', fontSize: '0.75rem' }}
                            onClick={() => {
                              resetFraming();
                              handleCaptureItemSnapshot(currentFramingItem, { x: 0, y: 0 }, 1.0);
                            }}
                            title="Reset pan and zoom to center"
                          >
                            <RotateCcw size={12} />
                          </button>
                          {currentFramingItem.contextSnapshotBase64 && (
                            <button
                              type="button"
                              className="srd-btn-icon"
                              style={{ padding: '0.4rem 0.6rem', color: '#f87171' }}
                              onClick={() => handleRemoveItemSnapshot(currentFramingItem.id)}
                              title="Remove item snapshot"
                            >
                              <Trash2 size={12} />
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {/* Tab: Headers & Footers */}
            {activeTab === 'headers' && (
              <div className="srd-sidebar__field-group">
                <div className="srd-sidebar__field">
                  <label className="srd-sidebar__label">Classification Banner</label>
                  <input
                    type="text"
                    className="srd-sidebar__input"
                    placeholder="e.g. CONFIDENTIAL — INTERNAL USE ONLY"
                    value={templateConfig.headersAndFooters.classificationBanner || ''}
                    onChange={(e) => handleHeadersChange('classificationBanner', e.target.value)}
                  />
                </div>
                <div className="srd-sidebar__field">
                  <label className="srd-sidebar__label">Header Left</label>
                  <input
                    type="text"
                    className="srd-sidebar__input"
                    value={templateConfig.headersAndFooters.headerLeft || ''}
                    onChange={(e) => handleHeadersChange('headerLeft', e.target.value)}
                  />
                </div>
                <div className="srd-sidebar__field">
                  <label className="srd-sidebar__label">Header Right</label>
                  <input
                    type="text"
                    className="srd-sidebar__input"
                    value={templateConfig.headersAndFooters.headerRight || ''}
                    onChange={(e) => handleHeadersChange('headerRight', e.target.value)}
                  />
                </div>
                <div className="srd-sidebar__field">
                  <label className="srd-sidebar__label">Footer Left (Copyright / Classification)</label>
                  <input
                    type="text"
                    className="srd-sidebar__input"
                    value={templateConfig.headersAndFooters.footerLeft || ''}
                    onChange={(e) => handleHeadersChange('footerLeft', e.target.value)}
                  />
                </div>
                <div className="srd-sidebar__field">
                  <label className="srd-sidebar__label">Footer Right (Page Count)</label>
                  <input
                    type="text"
                    className="srd-sidebar__input"
                    value={templateConfig.headersAndFooters.footerRight || ''}
                    onChange={(e) => handleHeadersChange('footerRight', e.target.value)}
                  />
                </div>
              </div>
            )}

            {/* Template JSON Import/Export */}
            <div style={{ marginTop: 'auto', paddingTop: '1rem', borderTop: '1px solid #374151', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button
                  type="button"
                  className="srd-btn-icon"
                  style={{ flex: 1, padding: '0.4rem', gap: '0.3rem' }}
                  onClick={handleExportTemplateJson}
                  title="Export this template configuration as JSON"
                >
                  <Download size={14} />
                  <span>Save JSON</span>
                </button>
                <button
                  type="button"
                  className="srd-btn-icon"
                  style={{ flex: 1, padding: '0.4rem', gap: '0.3rem' }}
                  onClick={() => fileInputRef.current?.click()}
                  title="Import template configuration from JSON file"
                >
                  <Upload size={14} />
                  <span>Load JSON</span>
                </button>
                <input
                  type="file"
                  ref={fileInputRef}
                  style={{ display: 'none' }}
                  accept=".json"
                  onChange={handleImportTemplateJson}
                />
              </div>
              <button
                type="button"
                className="srd-btn-icon"
                style={{ padding: '0.35rem', gap: '0.3rem', justifyContent: 'center' }}
                onClick={() => handleSelectPreset(DEFAULT_SRD_TEMPLATE.id)}
              >
                <RotateCcw size={12} />
                <span>Reset to Default</span>
              </button>
            </div>
          </div>

          {/* Document Preview Paper */}
          <div className="srd-preview-container">
            <div
              className={`srd-preview-paper ${
                templateConfig.theme.pageOrientation === 'landscape'
                  ? 'srd-preview-paper--landscape'
                  : ''
              }`}
              style={
                {
                  '--srd-primary': templateConfig.theme.primaryColor,
                  '--srd-accent': templateConfig.theme.accentColor,
                  '--srd-font': templateConfig.theme.fontFamily,
                } as React.CSSProperties
              }
            >
              {/* Classification Banner */}
              {templateConfig.headersAndFooters.classificationBanner && (
                <div className="srd-doc__banner">
                  {interpolateTokens(
                    templateConfig.headersAndFooters.classificationBanner,
                    currentSrdData,
                  )}
                </div>
              )}

              {/* Document Running Header */}
              {(templateConfig.headersAndFooters.headerLeft ||
                templateConfig.headersAndFooters.headerRight) && (
                <div className="srd-doc__running-header">
                  <div>
                    {templateConfig.headersAndFooters.headerLeft &&
                      interpolateTokens(templateConfig.headersAndFooters.headerLeft, currentSrdData)}
                  </div>
                  <div>
                    {templateConfig.headersAndFooters.headerRight &&
                      interpolateTokens(templateConfig.headersAndFooters.headerRight, currentSrdData)}
                  </div>
                </div>
              )}

              {/* Document Header */}
              <div className="srd-doc__header">
                <h1 className="srd-doc__title">{currentSrdData.metadata.title}</h1>
                <div className="srd-doc__meta-grid">
                  <div className="srd-doc__meta-item">
                    <strong>Version:</strong> {currentSrdData.metadata.version}
                  </div>
                  <div className="srd-doc__meta-item">
                    <strong>Date:</strong> {currentSrdData.metadata.generatedAt}
                  </div>
                  {currentSrdData.metadata.organization && (
                    <div className="srd-doc__meta-item">
                      <strong>Organization:</strong> {currentSrdData.metadata.organization}
                    </div>
                  )}
                  {currentSrdData.metadata.authors.length > 0 && (
                    <div className="srd-doc__meta-item">
                      <strong>Authors:</strong>{' '}
                      {currentSrdData.metadata.authors
                        .map((a) => (a.role ? `${a.name} (${a.role})` : a.name))
                        .join(', ')}
                    </div>
                  )}
                </div>
              </div>

              {/* Dynamic Sections */}
              {activeSortedSections.map((section) => {
                const sectionTitle = interpolateTokens(section.title, currentSrdData);

                return (
                  <div key={section.id} className="srd-doc__section">
                    <h2 className="srd-doc__section-title">{sectionTitle}</h2>
                    {section.customIntroText && (
                      <p className="srd-doc__intro-text">
                        {interpolateTokens(section.customIntroText, currentSrdData)}
                      </p>
                    )}

                    {section.id === 'executive_summary' && (
                      <div>
                        {currentSrdData.metadata.description && (
                          <div style={{ marginBottom: '1.25rem' }}>
                            <h3 className="srd-doc__sub-title">Scope & Objectives</h3>
                            <p style={{ lineHeight: 1.6, color: '#374151' }}>
                              {currentSrdData.metadata.description}
                            </p>
                          </div>
                        )}
                        <h3 className="srd-doc__sub-title">Scope & Architecture Metrics</h3>
                        <table
                          className={`srd-doc__table ${
                            templateConfig.theme.tableDense ? 'srd-doc__table--dense' : ''
                          }`}
                        >
                          <tbody>
                            <tr>
                              <td>Total Requirements & Scope Items</td>
                              <td><strong>{currentSrdData.requirements.summaryStats.total}</strong></td>
                            </tr>
                            <tr>
                              <td>Requirement Categories Defined</td>
                              <td><strong>{currentSrdData.requirements.categories.length}</strong></td>
                            </tr>
                            <tr>
                              <td>Total Estimated Scope / Effort</td>
                              <td>
                                <strong>
                                  {currentSrdData.requirements.summaryStats.totalPoints > 0
                                    ? `${currentSrdData.requirements.summaryStats.totalPoints} pts`
                                    : 'Unestimated'}
                                </strong>
                              </td>
                            </tr>
                            <tr>
                              <td>Architecture Components Defined</td>
                              <td><strong>{currentSrdData.architecture.components.length}</strong></td>
                            </tr>
                            <tr>
                              <td>Component Interfaces & Data Flows</td>
                              <td><strong>{currentSrdData.architecture.connections.length}</strong></td>
                            </tr>
                            <tr>
                              <td>Target Delivery Milestones</td>
                              <td><strong>{currentSrdData.roadmap.milestones.length}</strong></td>
                            </tr>
                            <tr>
                              <td>Planned Delivery Sprints</td>
                              <td><strong>{currentSrdData.roadmap.sprints.length}</strong></td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    )}

                    {section.id === 'architecture' && (
                      <div>
                        {currentSrdData.architecture.diagramImageBase64 ? (
                          <div className="srd-doc__diagram-container" style={{ position: 'relative' }}>
                            {isCapturingSnapshot && (
                              <div className="srd-doc__snapshot-loading-overlay">
                                <div className="srd-loading-spinner" style={{ width: 28, height: 28, borderWidth: 2.5 }} />
                                <span>Refreshing architecture snapshot...</span>
                              </div>
                            )}
                            <img
                              src={currentSrdData.architecture.diagramImageBase64}
                              alt="System Architecture Diagram"
                              className="srd-doc__diagram-img"
                            />
                          </div>
                        ) : isCapturingSnapshot ? (
                          <div className="srd-doc__diagram-container" style={{ position: 'relative', minHeight: 140, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <div className="srd-doc__snapshot-loading-overlay">
                              <div className="srd-loading-spinner" style={{ width: 28, height: 28, borderWidth: 2.5 }} />
                              <span>Capturing architecture snapshot...</span>
                            </div>
                          </div>
                        ) : null}

                        {templateConfig.includeComponentTable && (
                          <>
                            <h3 className="srd-doc__sub-title">Component Inventory</h3>
                            {currentSrdData.architecture.components.length === 0 ? (
                              <p style={{ color: '#6b7280', fontStyle: 'italic' }}>
                                No architecture components defined in canvas.
                              </p>
                            ) : (
                              <table
                                className={`srd-doc__table ${
                                  templateConfig.theme.tableDense ? 'srd-doc__table--dense' : ''
                                }`}
                              >
                                <thead>
                                  <tr>
                                    <th>Component Name</th>
                                    <th>Type</th>
                                    <th>Description</th>
                                    <th>Linked Requirements</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {currentSrdData.architecture.components.map((c) => (
                                    <tr key={c.id}>
                                      <td><strong>{c.name}</strong></td>
                                      <td><code>{c.type}</code></td>
                                      <td>{c.description || '-'}</td>
                                      <td>{c.linkedRequirementIds?.join(', ') || '-'}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}
                          </>
                        )}

                        {templateConfig.includeConnectionsTable && (
                          <>
                            <h3 className="srd-doc__sub-title">Connections & Data Flows</h3>
                            {currentSrdData.architecture.connections.length === 0 ? (
                              <p style={{ color: '#6b7280', fontStyle: 'italic' }}>
                                No connections defined between components.
                              </p>
                            ) : (
                              <table
                                className={`srd-doc__table ${
                                  templateConfig.theme.tableDense ? 'srd-doc__table--dense' : ''
                                }`}
                              >
                                <thead>
                                  <tr>
                                    <th>Source</th>
                                    <th>Target</th>
                                    <th>Flow Label</th>
                                    <th>Protocol</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {currentSrdData.architecture.connections.map((conn, i) => (
                                    <tr key={i}>
                                      <td><strong>{conn.fromName || conn.from}</strong></td>
                                      <td><strong>{conn.toName || conn.to}</strong></td>
                                      <td>{conn.label || '-'}</td>
                                      <td><code>{conn.protocol || conn.edgeType || '-'}</code></td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}
                          </>
                        )}
                      </div>
                    )}

                    {section.id === 'requirements' && (
                      <div>
                        {currentSrdData.requirements.categories.map((cat) => {
                          const items = currentSrdData.requirements.itemsByCategory[cat.id] || [];
                          if (items.length === 0) return null;

                          const isTableLayout = templateConfig.requirementsLayout === 'table';

                          return (
                            <div key={cat.id} style={{ marginBottom: '2rem' }}>
                              <h3 className="srd-doc__sub-title">
                                Category: {cat.label}
                              </h3>

                              {isTableLayout ? (
                                <table
                                  className={`srd-doc__table ${
                                    templateConfig.theme.tableDense ? 'srd-doc__table--dense' : ''
                                  }`}
                                >
                                  <thead>
                                    <tr>
                                      <th>ID</th>
                                      <th>Title</th>
                                      <th>Type</th>
                                      <th>Status</th>
                                      <th>Effort</th>
                                      <th>Assignee</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {items.map((item) => (
                                      <tr key={item.id}>
                                        <td><code>{item.id}</code></td>
                                        <td><strong>{item.title}</strong></td>
                                        <td>{item.typeLabel}</td>
                                        <td>{item.status || '-'}</td>
                                        <td>{item.points != null ? `${item.points} pts` : '-'}</td>
                                        <td>{item.assigneeName || '-'}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              ) : (
                                <div className="srd-doc__item-cards-list">
                                  {items.map((item) => {
                                    const relatedLinks = currentSrdData.traceability.filter(
                                      (t) => t.sourceId === item.id || t.targetId === item.id,
                                    );

                                    return (
                                      <div key={item.id} className="srd-doc__item-card">
                                        <div className="srd-doc__item-card-header">
                                          <div className="srd-doc__item-card-title-row">
                                            <span className="srd-doc__badge srd-doc__badge--id">
                                              {item.id}
                                            </span>
                                            <h4 className="srd-doc__item-card-title">
                                              {item.title || '(Untitled Requirement)'}
                                            </h4>
                                          </div>
                                          <div className="srd-doc__item-card-pills">
                                            <span className="srd-doc__badge srd-doc__badge--type">
                                              {item.typeLabel}
                                            </span>
                                            {item.status && (
                                              <span
                                                className={`srd-doc__badge srd-doc__badge--status srd-doc__badge--status-${item.status}`}
                                              >
                                                {item.status}
                                              </span>
                                            )}
                                            {item.points != null && (
                                              <span className="srd-doc__badge srd-doc__badge--points">
                                                {item.points} pts
                                              </span>
                                            )}
                                            {item.sprintName && (
                                              <span className="srd-doc__badge srd-doc__badge--sprint">
                                                {item.sprintName}
                                              </span>
                                            )}
                                            {item.assigneeName && (
                                              <span className="srd-doc__badge srd-doc__badge--assignee">
                                                {item.assigneeName}
                                              </span>
                                            )}
                                          </div>
                                        </div>

                                        {item.contextSnapshotBase64 ? (
                                          <div className="srd-doc__item-snapshot-container" style={{ position: 'relative' }}>
                                            {isCapturingItemSnapshot && currentFramingItem?.id === item.id && (
                                              <div className="srd-doc__snapshot-loading-overlay">
                                                <div className="srd-loading-spinner" style={{ width: 22, height: 22, borderWidth: 2 }} />
                                                <span>Updating context snapshot...</span>
                                              </div>
                                            )}
                                            <div className="srd-doc__item-snapshot-caption">
                                              Architecture Context Snapshot
                                            </div>
                                            <img
                                              src={item.contextSnapshotBase64}
                                              alt={`Context snapshot for ${item.id}`}
                                              className="srd-doc__item-snapshot-img"
                                            />
                                          </div>
                                        ) : isCapturingItemSnapshot && currentFramingItem?.id === item.id ? (
                                          <div className="srd-doc__item-snapshot-container" style={{ position: 'relative', minHeight: 120, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                            <div className="srd-doc__snapshot-loading-overlay">
                                              <div className="srd-loading-spinner" style={{ width: 22, height: 22, borderWidth: 2 }} />
                                              <span>Capturing context snapshot...</span>
                                            </div>
                                          </div>
                                        ) : null}

                                        {item.linkedNodeLabels && item.linkedNodeLabels.length > 0 && (
                                          <div className="srd-doc__item-linked-nodes">
                                            <strong>Linked Components: </strong>
                                            {item.linkedNodeLabels.map((lbl, li) => (
                                              <span key={li} className="srd-doc__node-tag">
                                                {lbl}
                                              </span>
                                            ))}
                                          </div>
                                        )}

                                        {item.body && item.body.trim() && (
                                          <div className="srd-doc__item-body">
                                            {item.body.trim()}
                                          </div>
                                        )}

                                        {relatedLinks.length > 0 && (
                                          <div className="srd-doc__item-dependencies">
                                            <strong>Dependencies & Links: </strong>
                                            <span className="srd-doc__deps-list">
                                              {relatedLinks.map((l, li) => (
                                                <span key={li} className="srd-doc__dep-item">
                                                  {l.sourceId === item.id
                                                    ? `${l.relation} ${l.targetId} (${l.targetTitle})`
                                                    : `Linked from ${l.sourceId} (${l.sourceTitle}) via ${l.relation}`}
                                                  {li < relatedLinks.length - 1 ? ' • ' : ''}
                                                </span>
                                              ))}
                                            </span>
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {section.id === 'traceability' && (
                      <div>
                        {currentSrdData.traceability.length === 0 ? (
                          <p style={{ color: '#6b7280', fontStyle: 'italic' }}>
                            No relationships or architecture linkages established.
                          </p>
                        ) : (
                          <table
                            className={`srd-doc__table ${
                              templateConfig.theme.tableDense ? 'srd-doc__table--dense' : ''
                            }`}
                          >
                            <thead>
                              <tr>
                                <th>Source Entity</th>
                                <th>Relationship</th>
                                <th>Target Entity</th>
                              </tr>
                            </thead>
                            <tbody>
                              {currentSrdData.traceability.map((link, idx) => (
                                <tr key={idx}>
                                  <td>
                                    <code>{link.sourceId}</code> ({link.sourceTitle})
                                  </td>
                                  <td><strong>{link.relation}</strong></td>
                                  <td>
                                    <code>{link.targetId}</code> ({link.targetTitle})
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </div>
                    )}

                    {section.id === 'roadmap' && (
                      <div>
                        <h3 className="srd-doc__sub-title">Milestones</h3>
                        {currentSrdData.roadmap.milestones.length === 0 ? (
                          <p style={{ color: '#6b7280', fontStyle: 'italic' }}>
                            No milestones scheduled.
                          </p>
                        ) : (
                          <table
                            className={`srd-doc__table ${
                              templateConfig.theme.tableDense ? 'srd-doc__table--dense' : ''
                            }`}
                          >
                            <thead>
                              <tr>
                                <th>Milestone</th>
                                <th>Type</th>
                                <th>Target Date</th>
                                <th>Description</th>
                              </tr>
                            </thead>
                            <tbody>
                              {currentSrdData.roadmap.milestones.map((m) => (
                                <tr key={m.id}>
                                  <td><strong>{m.title}</strong></td>
                                  <td><code>{m.type}</code></td>
                                  <td>{m.targetDate || '-'}</td>
                                  <td>{m.description || '-'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}

                        <h3 className="srd-doc__sub-title">Program Increments & Sprints</h3>
                        {currentSrdData.roadmap.sprints.length === 0 ? (
                          <p style={{ color: '#6b7280', fontStyle: 'italic' }}>
                            No sprint iterations planned.
                          </p>
                        ) : (
                          <table
                            className={`srd-doc__table ${
                              templateConfig.theme.tableDense ? 'srd-doc__table--dense' : ''
                            }`}
                          >
                            <thead>
                              <tr>
                                <th>PI</th>
                                <th>Sprint</th>
                                <th>Timeline</th>
                                <th>Effort</th>
                                <th>Items</th>
                              </tr>
                            </thead>
                            <tbody>
                              {currentSrdData.roadmap.sprints.map((s) => (
                                <tr key={s.id}>
                                  <td><strong>{s.piName}</strong></td>
                                  <td>{s.name}</td>
                                  <td>{s.startDate} - {s.endDate}</td>
                                  <td>{s.totalPoints} pts</td>
                                  <td>{s.assignedItems.length} items</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Document Footer */}
              <div className="srd-doc__footer">
                <div>
                  {templateConfig.headersAndFooters.footerLeft &&
                    interpolateTokens(templateConfig.headersAndFooters.footerLeft, currentSrdData)}
                </div>
                <div>
                  {templateConfig.headersAndFooters.footerRight &&
                    interpolateTokens(templateConfig.headersAndFooters.footerRight, currentSrdData)}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
