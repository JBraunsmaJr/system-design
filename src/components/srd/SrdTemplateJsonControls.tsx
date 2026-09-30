import { Upload, Download, RotateCcw } from 'lucide-react';
import { DEFAULT_SRD_TEMPLATE } from '../../domain/srd/srdTemplatePresets';
import type { SrdModalState } from './useSrdPrintModal';

/**
 * Importing and exporting the template configuration as JSON.
 *
 * Moved unchanged from SrdPrintModal.tsx; its props are exactly the modal
 * state it reads. Not memoized: it re-renders whenever the modal does, as
 * this markup did when it was inline, at the cost of one extra function
 * call per modal render.
 */
export function SrdTemplateJsonControls({
  fileInputRef,
  handleSelectPreset,
  handleExportTemplateJson,
  handleImportTemplateJson,
}: Pick<
  SrdModalState,
  'fileInputRef' | 'handleSelectPreset' | 'handleExportTemplateJson' | 'handleImportTemplateJson'
>) {
  return (
    <div
      style={{
        marginTop: 'auto',
        paddingTop: '1rem',
        borderTop: '1px solid #374151',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.5rem',
      }}
    >
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
  );
}
