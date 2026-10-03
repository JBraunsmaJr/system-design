import { RotateCcw, Camera, Trash2, RefreshCw } from 'lucide-react';
import type { SrdViewState } from './useSrdView';

/**
 * The Snapshots tab: per-requirement diagram snapshots and their framing.
 *
 * Its props are exactly the SRD view state it reads. Not memoized: it
 * re-renders whenever the view does, at the cost of one function call.
 */
export function SrdSnapshotsTab({
  selectedFramingItemId,
  setSelectedFramingItemId,
  isCapturingItemSnapshot,
  setIsInteractingWithSlider,
  batchProgress,
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
  handleCaptureItemSnapshot,
  handleRemoveItemSnapshot,
  handleBatchCaptureAllSnapshots,
}: Pick<
  SrdViewState,
  | 'selectedFramingItemId'
  | 'setSelectedFramingItemId'
  | 'isCapturingItemSnapshot'
  | 'setIsInteractingWithSlider'
  | 'batchProgress'
  | 'linkedRequirementItems'
  | 'currentFramingItem'
  | 'framingPanOffset'
  | 'framingZoom'
  | 'framingRelZoom'
  | 'framingDxPercent'
  | 'framingDyPercent'
  | 'isFramingTransformed'
  | 'setFramingPanX'
  | 'setFramingPanY'
  | 'setFramingZoomScale'
  | 'resetFraming'
  | 'handleCaptureItemSnapshot'
  | 'handleRemoveItemSnapshot'
  | 'handleBatchCaptureAllSnapshots'
>) {
  return (
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
            <RefreshCw
              size={11}
              className={isCapturingItemSnapshot ? 'animate-spin' : ''}
              style={{ marginRight: 3 }}
            />
            {batchProgress
              ? `Capturing (${batchProgress.current}/${batchProgress.total})`
              : 'Batch Capture All'}
          </button>
        )}
      </div>

      {linkedRequirementItems.length === 0 ? (
        <div
          style={{
            backgroundColor: '#1e293b',
            border: '1px solid #374151',
            borderRadius: '6px',
            padding: '1rem',
            textAlign: 'center',
            color: '#9ca3af',
            fontSize: '0.8125rem',
          }}
        >
          <p style={{ margin: '0 0 0.5rem 0', fontWeight: 600, color: '#e2e8f0' }}>
            No Linked Requirements
          </p>
          <p style={{ margin: 0, fontSize: '0.75rem', lineHeight: '1.4' }}>
            To embed focused architectural snapshots, link requirement items to canvas nodes in the
            diagram.
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
                  {item.id}: {item.title || '(Untitled)'} ({item.linkedNodeLabels?.length || 0}{' '}
                  nodes)
                </option>
              ))}
            </select>
          </div>

          {currentFramingItem && (
            <div className="srd-framing-panel">
              <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
                <strong style={{ color: '#ffffff' }}>{currentFramingItem.id}</strong>:{' '}
                {currentFramingItem.title}
                <div
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: '0.25rem',
                    marginTop: '0.35rem',
                  }}
                >
                  {currentFramingItem.linkedNodeLabels?.map((lbl, idx) => (
                    <span key={idx} className="srd-snapshots__node-tag">
                      {lbl}
                    </span>
                  ))}
                </div>
              </div>

              <div className="srd-framing-preview-box">
                {isCapturingItemSnapshot &&
                  (batchProgress ? (
                    <div className="srd-framing-loading-overlay">
                      <div
                        className="srd-loading-spinner"
                        style={{ width: 22, height: 22, borderWidth: 2 }}
                      />
                      <span style={{ fontSize: '0.75rem', fontWeight: 600 }}>
                        Capturing ({batchProgress.current}/{batchProgress.total})...
                      </span>
                    </div>
                  ) : (
                    <div className="srd-framing-sync-badge">
                      <RefreshCw size={11} className="animate-spin" />
                      <span>Rendering hi-res...</span>
                    </div>
                  ))}
                {currentFramingItem.contextSnapshotBase64 ? (
                  <img
                    src={currentFramingItem.contextSnapshotBase64}
                    alt="Context preview"
                    className="srd-framing-preview-img"
                    style={{
                      transform: isFramingTransformed
                        ? `translate(${framingDxPercent}%, ${framingDyPercent}%) scale(${framingRelZoom})`
                        : undefined,
                      transformOrigin: 'center center',
                    }}
                  />
                ) : (
                  <div
                    style={{
                      color: '#64748b',
                      fontSize: '0.75rem',
                      textAlign: 'center',
                      padding: '1rem',
                    }}
                  >
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
                    min="-1000"
                    max="1000"
                    step="10"
                    value={framingPanOffset.x}
                    onPointerDown={() => setIsInteractingWithSlider(true)}
                    onPointerUp={() => setIsInteractingWithSlider(false)}
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
                    min="-800"
                    max="800"
                    step="10"
                    value={framingPanOffset.y}
                    onPointerDown={() => setIsInteractingWithSlider(true)}
                    onPointerUp={() => setIsInteractingWithSlider(false)}
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
                  min="0.3"
                  max="3.5"
                  step="0.05"
                  value={framingZoom}
                  onPointerDown={() => setIsInteractingWithSlider(true)}
                  onPointerUp={() => setIsInteractingWithSlider(false)}
                  onChange={(e) => setFramingZoomScale(parseFloat(e.target.value))}
                />
              </div>

              <div className="srd-framing-btn-row">
                <button
                  type="button"
                  className="srd-btn-icon"
                  style={{
                    flex: 1,
                    padding: '0.4rem',
                    fontSize: '0.75rem',
                    backgroundColor: '#2563eb',
                    color: '#ffffff',
                    fontWeight: 600,
                  }}
                  onClick={() => handleCaptureItemSnapshot()}
                  disabled={isCapturingItemSnapshot}
                >
                  <RefreshCw
                    size={12}
                    className={isCapturingItemSnapshot ? 'animate-spin' : ''}
                    style={{ marginRight: 4 }}
                  />
                  {currentFramingItem.contextSnapshotBase64
                    ? 'Update Snapshot'
                    : 'Capture Snapshot'}
                </button>
                <button
                  type="button"
                  className="srd-btn-icon"
                  style={{ padding: '0.4rem 0.6rem', fontSize: '0.75rem' }}
                  onClick={resetFraming}
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
  );
}
