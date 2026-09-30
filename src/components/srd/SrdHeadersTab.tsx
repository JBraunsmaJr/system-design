import type { SrdModalState } from './useSrdPrintModal';

/**
 * The Headers tab: running header and footer text.
 *
 * Moved unchanged from SrdPrintModal.tsx; its props are exactly the modal
 * state it reads. Not memoized: it re-renders whenever the modal does, as
 * this markup did when it was inline, at the cost of one extra function
 * call per modal render.
 */
export function SrdHeadersTab({
  templateConfig,
  handleHeadersChange,
}: Pick<SrdModalState, 'templateConfig' | 'handleHeadersChange'>) {
  return (
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
  );
}
