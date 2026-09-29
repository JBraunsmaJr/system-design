import { Upload, Camera, Trash2, RefreshCw } from 'lucide-react';
import { AutoResizeTextarea } from './AutoResizeTextarea';
import type { SrdModalState, SrdPrintModalProps } from './useSrdPrintModal';

/**
 * The Doc tab: document metadata and the architecture snapshot controls.
 *
 * Moved unchanged from SrdPrintModal.tsx; its props are exactly the modal
 * state it reads. Not memoised: it re-renders whenever the modal does, as
 * this markup did when it was inline, at the cost of one extra function
 * call per modal render.
 */
export function SrdDocTab({
  currentSrdData,
  snapshotScope,
  setSnapshotScope,
  isCapturingSnapshot,
  diagramUploadInputRef,
  handleMetadataChange,
  handleAuthorsStringChange,
  authorsDisplayString,
  handleCaptureSnapshot,
  handleUploadDiagramImage,
  handleRemoveDiagram,
  nodes,
  selectedNodeIds,
}: Pick<
  SrdModalState,
  | 'currentSrdData'
  | 'snapshotScope'
  | 'setSnapshotScope'
  | 'isCapturingSnapshot'
  | 'diagramUploadInputRef'
  | 'handleMetadataChange'
  | 'handleAuthorsStringChange'
  | 'authorsDisplayString'
  | 'handleCaptureSnapshot'
  | 'handleUploadDiagramImage'
  | 'handleRemoveDiagram'
> &
  Required<Pick<SrdPrintModalProps, 'nodes' | 'selectedNodeIds'>>) {
  return (
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

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
          gap: '0.5rem',
          width: '100%',
        }}
      >
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
      <div
        style={{
          marginTop: '0.75rem',
          paddingTop: '0.75rem',
          borderTop: '1px solid #374151',
        }}
      >
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
            style={{
              flex: 1,
              padding: '0.4rem',
              gap: '0.3rem',
              backgroundColor: '#1e3a8a',
              color: '#ffffff',
            }}
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
  );
}
