import { Camera, Trash2, RefreshCw, Undo2 } from 'lucide-react';
import { AutoResizeTextarea } from './AutoResizeTextarea';
import type { SrdViewState } from './useSrdView';

/**
 * The Doc tab: document metadata and the architecture snapshot controls.
 *
 * Its props are exactly the SRD view state it reads. Not memoized: it
 * re-renders whenever the view does, at the cost of one function call.
 */
export function SrdDocTab({
  currentSrdData,
  isCapturingSnapshot,
  isDiagramHidden,
  handleMetadataChange,
  handleAuthorsStringChange,
  authorsDisplayString,
  handleCaptureSnapshot,
  handleRemoveDiagram,
}: Pick<
  SrdViewState,
  | 'currentSrdData'
  | 'isCapturingSnapshot'
  | 'isDiagramHidden'
  | 'handleMetadataChange'
  | 'handleAuthorsStringChange'
  | 'authorsDisplayString'
  | 'handleCaptureSnapshot'
  | 'handleRemoveDiagram'
>) {
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

        <p className="srd-sidebar__hint">
          The full architecture diagram, rendered from the document so everyone sees the same image.
          It updates automatically as the diagram changes.
        </p>

        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
          {isDiagramHidden ? (
            <button
              type="button"
              className="srd-btn-icon"
              style={{ flex: 1, padding: '0.4rem', gap: '0.3rem' }}
              onClick={handleCaptureSnapshot}
              title="Add the architecture diagram back to the document"
            >
              <Undo2 size={13} />
              <span>Restore Diagram</span>
            </button>
          ) : (
            <>
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
                title="Render the diagram snapshot again"
              >
                <RefreshCw size={13} className={isCapturingSnapshot ? 'animate-spin' : ''} />
                <span>{isCapturingSnapshot ? 'Rendering...' : 'Refresh Snapshot'}</span>
              </button>
              {currentSrdData.architecture.diagramImageBase64 && (
                <button
                  type="button"
                  className="srd-btn-icon"
                  style={{ padding: '0.4rem', color: '#f87171' }}
                  onClick={handleRemoveDiagram}
                  title="Remove the diagram from the document, for everyone"
                >
                  <Trash2 size={13} />
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
