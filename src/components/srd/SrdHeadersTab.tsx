import type {SrdViewState} from './useSrdView';

/**
 * The Headers tab: running header and footer text.
 *
 * Its props are exactly the SRD view state it reads. Not memoized: it
 * re-renders whenever the view does, at the cost of one function call.
 */
export function SrdHeadersTab({
  templateConfig,
  handleHeadersChange,
}: Pick<SrdViewState, 'templateConfig' | 'handleHeadersChange'>) {
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
