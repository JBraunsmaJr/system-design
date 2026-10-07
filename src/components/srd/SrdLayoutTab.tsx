import {ArrowDown, ArrowUp, List, Table as TableIcon} from 'lucide-react';
import {AutoResizeTextarea} from './AutoResizeTextarea';
import type {SrdViewState} from './useSrdView';

/**
 * The Layout tab: which sections appear, their order and table options.
 *
 * Its props are exactly the SRD view state it reads. Not memoized: it
 * re-renders whenever the view does, at the cost of one function call.
 */
export function SrdLayoutTab({
  templateConfig,
  handleToggleSection,
  handleMoveSection,
  handleSectionIntroChange,
  handleLayoutChange,
  handleToggleComponentTable,
  handleToggleConnectionsTable,
  sortedSections,
}: Pick<
  SrdViewState,
  | 'templateConfig'
  | 'handleToggleSection'
  | 'handleMoveSection'
  | 'handleSectionIntroChange'
  | 'handleLayoutChange'
  | 'handleToggleComponentTable'
  | 'handleToggleConnectionsTable'
  | 'sortedSections'
>) {
  return (
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
              templateConfig.requirementsLayout === 'table' ? 'srd-layout-toggle-btn--active' : ''
            }`}
            onClick={() => handleLayoutChange('table')}
          >
            <TableIcon size={16} />
            <span>Table View (Dense)</span>
          </button>
        </div>
      </div>

      <div
        className="srd-sidebar__field"
        style={{
          marginTop: '0.25rem',
          paddingBottom: '0.75rem',
          borderBottom: '1px solid #374151',
        }}
      >
        <label className="srd-sidebar__label">Architecture Detail Tables</label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <input
              type="checkbox"
              id="includeComponentTableCheckbox"
              checked={!!templateConfig.includeComponentTable}
              onChange={(e) => handleToggleComponentTable(e.target.checked)}
            />
            <label
              htmlFor="includeComponentTableCheckbox"
              className="srd-sidebar__label"
              style={{ cursor: 'pointer', margin: 0 }}
            >
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
            <label
              htmlFor="includeConnectionsTableCheckbox"
              className="srd-sidebar__label"
              style={{ cursor: 'pointer', margin: 0 }}
            >
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
          <div
            className="srd-sidebar__section-item"
            style={{ marginBottom: section.enabled ? '0.35rem' : '0' }}
          >
            <div className="srd-sidebar__section-item-left">
              <input
                type="checkbox"
                checked={section.enabled}
                onChange={(e) => handleToggleSection(section.id, e.target.checked)}
              />
              <span
                style={{
                  fontWeight: section.enabled ? 600 : 400,
                  color: section.enabled ? '#ffffff' : '#6b7280',
                }}
              >
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
  );
}
