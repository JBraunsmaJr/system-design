import {
  Printer,
  FileDown,
  Download,
  X,
  Palette,
  Sliders,
  FileText,
  Building2,
  Camera,
  RefreshCw,
} from 'lucide-react';
import { BUILTIN_SRD_TEMPLATES } from '../../domain/srd/srdTemplatePresets';
import { SrdDocTab } from './SrdDocTab';
import { SrdThemeTab } from './SrdThemeTab';
import { SrdLayoutTab } from './SrdLayoutTab';
import { SrdSnapshotsTab } from './SrdSnapshotsTab';
import { SrdHeadersTab } from './SrdHeadersTab';
import { SrdTemplateJsonControls } from './SrdTemplateJsonControls';
import { SrdDocumentPreview } from './SrdDocumentPreview';
import { useSrdPrintModal, type SrdPrintModalProps } from './useSrdPrintModal';

/**
 * The Solution Requirement Document generator: a customization sidebar and a
 * live preview of the document it will print or export.
 *
 * The state and behavior live in useSrdPrintModal; each sidebar tab and
 * the preview are their own components, each receiving exactly the state
 * it reads.
 */
export function SrdPrintModal({
  isOpen,
  onClose,
  srdData,
  nodes = [],
  selectedNodeIds = [],
  currentPath,
  setPath,
}: SrdPrintModalProps) {
  const {
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
  } = useSrdPrintModal({
    isOpen,
    onClose,
    srdData,
    nodes,
    selectedNodeIds,
    currentPath,
    setPath,
  });

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
                Customize corporate metadata, configure sections, and export as Markdown or
                Print/PDF.
              </p>
            </div>
          </div>
          <div className="srd-modal__header-actions">
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
                {activePresetId === 'custom' && (
                  <option value="custom">Custom Configuration</option>
                )}
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
                snapshotScope={snapshotScope}
                setSnapshotScope={setSnapshotScope}
                isCapturingSnapshot={isCapturingSnapshot}
                diagramUploadInputRef={diagramUploadInputRef}
                handleMetadataChange={handleMetadataChange}
                handleAuthorsStringChange={handleAuthorsStringChange}
                authorsDisplayString={authorsDisplayString}
                handleCaptureSnapshot={handleCaptureSnapshot}
                handleUploadDiagramImage={handleUploadDiagramImage}
                handleRemoveDiagram={handleRemoveDiagram}
                nodes={nodes}
                selectedNodeIds={selectedNodeIds}
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
                nodes={nodes}
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
            isCapturingSnapshot={isCapturingSnapshot}
            isCapturingItemSnapshot={isCapturingItemSnapshot}
            paperRef={paperRef}
            currentFramingItem={currentFramingItem}
            framingRelZoom={framingRelZoom}
            framingDxPercent={framingDxPercent}
            framingDyPercent={framingDyPercent}
            isFramingTransformed={isFramingTransformed}
            activeSortedSections={activeSortedSections}
            nodes={nodes}
          />
        </div>
      </div>
    </div>
  );
}
