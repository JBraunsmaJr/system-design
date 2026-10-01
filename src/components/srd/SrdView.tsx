import { useMemo, useSyncExternalStore } from 'react';
import type { Edge, Node } from '@xyflow/react';
import {
  Printer,
  FileDown,
  Download,
  Palette,
  Sliders,
  FileText,
  Building2,
  Camera,
  RefreshCw,
} from 'lucide-react';
import { BUILTIN_SRD_TEMPLATES } from '../../domain/srd/srdTemplatePresets';
import type { ArchEdgeData, ArchNodeData } from '../../domain/canvas/types';
import type { RequirementsDocument } from '../../domain/requirements/requirementsTypes';
import type { ProgramIncrement } from '../../domain/timeline/programIncrements';
import type { TeamDocument } from '../../domain/timeline/teamTypes';
import type { Milestone } from '../../domain/timeline/milestones';
import type { SrdStore } from '../../collab/stores/yjsSrdStore';
import { SrdDocTab } from './SrdDocTab';
import { SrdThemeTab } from './SrdThemeTab';
import { SrdLayoutTab } from './SrdLayoutTab';
import { SrdSnapshotsTab } from './SrdSnapshotsTab';
import { SrdHeadersTab } from './SrdHeadersTab';
import { SrdTemplateJsonControls } from './SrdTemplateJsonControls';
import { SrdDocumentPreview } from './SrdDocumentPreview';
import { useSrdSnapshots } from './capture/useSrdSnapshots';
import { useSrdDocumentData } from './useSrdDocumentData';
import { useSrdView } from './useSrdView';

export interface SrdViewProps {
  /** The document's SRD settings, metadata and framing. */
  srdStore: SrdStore;
  title: string;
  diagramSnapshot: { nodes: Node<ArchNodeData>[]; edges: Edge<ArchEdgeData>[] };
  requirementsSnapshot: RequirementsDocument;
  milestonesSnapshot: Milestone[];
  programIncrementsSnapshot: ProgramIncrement[];
  teamSnapshot: TeamDocument;
}

/**
 * The Solution Requirement Document view: a customization sidebar and a live
 * preview of exactly what will print or export.
 *
 * A view rather than a modal: it cannot be dismissed by a stray click, and
 * it shows the document as it is now. Its content is derived live from the
 * document; its settings, metadata and framing are document content shared
 * with collaborators; its snapshots are rendered on this device from both.
 *
 * Default export, so App can load it lazily through SrdViewEntry: it carries
 * the PDF exporter, which nothing else in the app needs.
 */
export default function SrdView({
  srdStore,
  title,
  diagramSnapshot,
  requirementsSnapshot,
  milestonesSnapshot,
  programIncrementsSnapshot,
  teamSnapshot,
}: SrdViewProps) {
  // getSnapshot doubles as the server snapshot: the store is a plain object
  // over the document, identical wherever it is rendered.
  const srd = useSyncExternalStore(srdStore.subscribe, srdStore.getSnapshot, srdStore.getSnapshot);
  const itemIds = useMemo(
    () => requirementsSnapshot.items.map((item) => item.id),
    [requirementsSnapshot.items],
  );
  const snapshots = useSrdSnapshots({ diagramSnapshot, itemIds, framing: srd.framing });
  const currentSrdData = useSrdDocumentData({
    title,
    diagramSnapshot,
    requirementsSnapshot,
    milestonesSnapshot,
    programIncrementsSnapshot,
    teamSnapshot,
    srd,
    images: snapshots.images,
  });
  const {
    activePresetId,
    templateConfig,
    activeTab,
    setActiveTab,
    isCapturingSnapshot,
    isDiagramHidden,
    isExportingPdf,
    pdfStatus,
    selectedFramingItemId,
    setSelectedFramingItemId,
    isCapturingItemSnapshot,
    setIsInteractingWithSlider,
    batchProgress,
    fileInputRef,
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
  } = useSrdView({ srdStore, srd, currentSrdData, snapshots });

  return (
    <div className="srd-view">
      {snapshots.surface}
      {/* Header */}
      <div className="srd-view__header">
        <div className="srd-view__title-group">
          <FileText size={20} color="#3b82f6" />
          <div>
            <h2 className="srd-view__title">Solution Requirement Document (SRD) Generator</h2>
            <p className="srd-view__subtitle">
              Shared with everyone in this document. Export as Markdown or Print/PDF.
            </p>
          </div>
        </div>
        <div className="srd-view__header-actions">
          <button
            type="button"
            className="srd-btn-icon"
            onClick={handleExportPdf}
            disabled={isExportingPdf}
            title="Generate and download vector PDF with dynamic page numbering"
            style={{
              backgroundColor: isExportingPdf ? '#1d4ed8' : '#2563eb',
              color: '#ffffff',
              padding: '0.4rem 0.8rem',
              gap: '0.4rem',
              fontWeight: 600,
              opacity: isExportingPdf ? 0.85 : 1,
              cursor: isExportingPdf ? 'wait' : 'pointer',
            }}
          >
            {isExportingPdf ? (
              <>
                <RefreshCw size={16} className="srd-spin" />
                <span>{pdfStatus || 'Compiling PDF...'}</span>
              </>
            ) : (
              <>
                <Download size={16} />
                <span>Export PDF</span>
              </>
            )}
          </button>
          <button
            type="button"
            className="srd-btn-icon"
            onClick={handlePrint}
            title="Print document via browser (Ctrl+P)"
            style={{ padding: '0.4rem 0.8rem', gap: '0.4rem', fontWeight: 500 }}
          >
            <Printer size={16} />
            <span>Print</span>
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
        </div>
      </div>

      {/* Modal Body */}
      <div className="srd-view__body">
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
            <SrdDocTab
              currentSrdData={currentSrdData}
              isCapturingSnapshot={isCapturingSnapshot}
              isDiagramHidden={isDiagramHidden}
              handleMetadataChange={handleMetadataChange}
              handleAuthorsStringChange={handleAuthorsStringChange}
              authorsDisplayString={authorsDisplayString}
              handleCaptureSnapshot={handleCaptureSnapshot}
              handleRemoveDiagram={handleRemoveDiagram}
            />
          )}

          {/* Tab: Theme */}
          {activeTab === 'theme' && (
            <SrdThemeTab templateConfig={templateConfig} handleThemeChange={handleThemeChange} />
          )}

          {/* Tab: Sections & Layout */}
          {activeTab === 'sections' && (
            <SrdLayoutTab
              templateConfig={templateConfig}
              handleToggleSection={handleToggleSection}
              handleMoveSection={handleMoveSection}
              handleSectionIntroChange={handleSectionIntroChange}
              handleLayoutChange={handleLayoutChange}
              handleToggleComponentTable={handleToggleComponentTable}
              handleToggleConnectionsTable={handleToggleConnectionsTable}
              sortedSections={sortedSections}
            />
          )}

          {/* Tab: Snapshots & Framing */}
          {activeTab === 'snapshots' && (
            <SrdSnapshotsTab
              selectedFramingItemId={selectedFramingItemId}
              setSelectedFramingItemId={setSelectedFramingItemId}
              isCapturingItemSnapshot={isCapturingItemSnapshot}
              setIsInteractingWithSlider={setIsInteractingWithSlider}
              batchProgress={batchProgress}
              linkedRequirementItems={linkedRequirementItems}
              currentFramingItem={currentFramingItem}
              framingPanOffset={framingPanOffset}
              framingZoom={framingZoom}
              framingRelZoom={framingRelZoom}
              framingDxPercent={framingDxPercent}
              framingDyPercent={framingDyPercent}
              isFramingTransformed={isFramingTransformed}
              setFramingPanX={setFramingPanX}
              setFramingPanY={setFramingPanY}
              setFramingZoomScale={setFramingZoomScale}
              resetFraming={resetFraming}
              handleCaptureItemSnapshot={handleCaptureItemSnapshot}
              handleRemoveItemSnapshot={handleRemoveItemSnapshot}
              handleBatchCaptureAllSnapshots={handleBatchCaptureAllSnapshots}
            />
          )}

          {/* Tab: Headers & Footers */}
          {activeTab === 'headers' && (
            <SrdHeadersTab
              templateConfig={templateConfig}
              handleHeadersChange={handleHeadersChange}
            />
          )}

          {/* Template JSON Import/Export */}
          <SrdTemplateJsonControls
            fileInputRef={fileInputRef}
            handleSelectPreset={handleSelectPreset}
            handleExportTemplateJson={handleExportTemplateJson}
            handleImportTemplateJson={handleImportTemplateJson}
          />
        </div>

        {/* Document Preview Paper */}
        <SrdDocumentPreview
          templateConfig={templateConfig}
          currentSrdData={currentSrdData}
          paperRef={paperRef}
          activeSortedSections={activeSortedSections}
        />
      </div>
    </div>
  );
}
