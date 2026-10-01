import type { SrdViewState } from './useSrdView';

/**
 * The Theme tab: colors and typography of the generated document.
 *
 * Its props are exactly the SRD view state it reads. Not memoized: it
 * re-renders whenever the view does, at the cost of one function call.
 */
export function SrdThemeTab({
  templateConfig,
  handleThemeChange,
}: Pick<SrdViewState, 'templateConfig' | 'handleThemeChange'>) {
  return (
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

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          marginTop: '0.5rem',
        }}
      >
        <input
          type="checkbox"
          id="denseTablesCheckbox"
          checked={templateConfig.theme.tableDense}
          onChange={(e) => handleThemeChange('tableDense', e.target.checked)}
        />
        <label
          htmlFor="denseTablesCheckbox"
          className="srd-sidebar__label"
          style={{ cursor: 'pointer' }}
        >
          Compact / Dense Table Layout
        </label>
      </div>
    </div>
  );
}
