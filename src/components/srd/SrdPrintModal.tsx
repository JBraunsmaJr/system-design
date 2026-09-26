import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  Printer,
  FileDown,
  Upload,
  Download,
  X,
  ArrowUp,
  ArrowDown,
  RotateCcw,
  Palette,
  Sliders,
  FileText,
} from 'lucide-react';
import type { SrdDataContext, SrdTemplateConfig } from '../../domain/srdTypes';
import {
  BUILTIN_SRD_TEMPLATES,
  DEFAULT_SRD_TEMPLATE,
  cloneTemplateConfig,
  serializeTemplateConfig,
  parseTemplateConfig,
} from '../../domain/srdTemplatePresets';
import { downloadSrdMarkdown, interpolateTokens } from '../../domain/srdMarkdownExport';
import './SrdPrintModal.css';

interface SrdPrintModalProps {
  isOpen: boolean;
  onClose: () => void;
  srdData: SrdDataContext;
}

export function SrdPrintModal({ isOpen, onClose, srdData }: SrdPrintModalProps) {
  const [activePresetId, setActivePresetId] = useState<string>('enterprise_formal');
  const [templateConfig, setTemplateConfig] = useState<SrdTemplateConfig>(() =>
    cloneTemplateConfig(DEFAULT_SRD_TEMPLATE),
  );
  const [activeTab, setActiveTab] = useState<'theme' | 'sections' | 'headers'>('theme');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const handleSelectPreset = (presetId: string) => {
    setActivePresetId(presetId);
    const found = BUILTIN_SRD_TEMPLATES.find((t) => t.id === presetId);
    if (found) {
      setTemplateConfig(cloneTemplateConfig(found));
    }
  };

  const handleThemeChange = <K extends keyof SrdTemplateConfig['theme']>(
    key: K,
    value: SrdTemplateConfig['theme'][K],
  ) => {
    setTemplateConfig((prev) => ({
      ...prev,
      theme: {
        ...prev.theme,
        [key]: value,
      },
    }));
    setActivePresetId('custom');
  };

  const handleHeadersChange = <K extends keyof SrdTemplateConfig['headersAndFooters']>(
    key: K,
    value: SrdTemplateConfig['headersAndFooters'][K],
  ) => {
    setTemplateConfig((prev) => ({
      ...prev,
      headersAndFooters: {
        ...prev.headersAndFooters,
        [key]: value,
      },
    }));
    setActivePresetId('custom');
  };

  const handleToggleSection = (sectionId: string, enabled: boolean) => {
    setTemplateConfig((prev) => ({
      ...prev,
      sections: prev.sections.map((s) => (s.id === sectionId ? { ...s, enabled } : s)),
    }));
    setActivePresetId('custom');
  };

  const handleMoveSection = (index: number, direction: 'up' | 'down') => {
    const sorted = [...templateConfig.sections].sort((a, b) => a.order - b.order);
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= sorted.length) return;

    const item = sorted[index];
    const targetItem = sorted[targetIndex];

    const newOrder = targetItem.order;
    targetItem.order = item.order;
    item.order = newOrder;

    setTemplateConfig((prev) => ({
      ...prev,
      sections: sorted,
    }));
    setActivePresetId('custom');
  };

  const handleSectionIntroChange = (sectionId: string, customIntroText: string) => {
    setTemplateConfig((prev) => ({
      ...prev,
      sections: prev.sections.map((s) => (s.id === sectionId ? { ...s, customIntroText } : s)),
    }));
    setActivePresetId('custom');
  };

  const handlePrint = () => {
    window.print();
  };

  const handleDownloadMarkdown = () => {
    downloadSrdMarkdown(srdData, templateConfig);
  };

  const handleExportTemplateJson = () => {
    const jsonStr = serializeTemplateConfig(templateConfig);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `srd-template-${templateConfig.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const handleImportTemplateJson = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const parsed = parseTemplateConfig(event.target?.result as string);
        setTemplateConfig(parsed);
        setActivePresetId('custom');
      } catch (err) {
        alert((err as Error).message);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const sortedSections = useMemo(
    () => [...templateConfig.sections].sort((a, b) => a.order - b.order),
    [templateConfig.sections],
  );

  const activeSortedSections = useMemo(
    () => sortedSections.filter((s) => s.enabled),
    [sortedSections],
  );

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
                Customize corporate theming, configure sections, and export as Markdown or Print/PDF.
              </p>
            </div>
          </div>
          <div className="srd-modal__header-actions">
            <button
              type="button"
              className="srd-btn-icon"
              onClick={handlePrint}
              title="Print / Save as PDF (Ctrl+P)"
              style={{
                backgroundColor: '#2563eb',
                color: '#ffffff',
                padding: '0.4rem 0.8rem',
                gap: '0.4rem',
                fontWeight: 600,
              }}
            >
              <Printer size={16} />
              <span>Print / PDF</span>
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
                {activePresetId === 'custom' && <option value="custom">Custom Configuration</option>}
              </select>
            </div>

            {/* Sidebar Tabs */}
            <div style={{ display: 'flex', gap: '0.25rem', borderBottom: '1px solid #374151' }}>
              <button
                type="button"
                className="srd-btn-icon"
                style={{
                  flex: 1,
                  padding: '0.5rem',
                  borderRadius: '4px 4px 0 0',
                  borderBottom: 'none',
                  backgroundColor: activeTab === 'theme' ? '#1f2937' : 'transparent',
                  color: activeTab === 'theme' ? '#3b82f6' : '#9ca3af',
                  fontWeight: 600,
                }}
                onClick={() => setActiveTab('theme')}
              >
                <Palette size={14} style={{ marginRight: 4 }} /> Theme
              </button>
              <button
                type="button"
                className="srd-btn-icon"
                style={{
                  flex: 1,
                  padding: '0.5rem',
                  borderRadius: '4px 4px 0 0',
                  borderBottom: 'none',
                  backgroundColor: activeTab === 'sections' ? '#1f2937' : 'transparent',
                  color: activeTab === 'sections' ? '#3b82f6' : '#9ca3af',
                  fontWeight: 600,
                }}
                onClick={() => setActiveTab('sections')}
              >
                <Sliders size={14} style={{ marginRight: 4 }} /> Sections
              </button>
              <button
                type="button"
                className="srd-btn-icon"
                style={{
                  flex: 1,
                  padding: '0.5rem',
                  borderRadius: '4px 4px 0 0',
                  borderBottom: 'none',
                  backgroundColor: activeTab === 'headers' ? '#1f2937' : 'transparent',
                  color: activeTab === 'headers' ? '#3b82f6' : '#9ca3af',
                  fontWeight: 600,
                }}
                onClick={() => setActiveTab('headers')}
              >
                <FileText size={14} style={{ marginRight: 4 }} /> Headers
              </button>
            </div>

            {/* Tab: Theme */}
            {activeTab === 'theme' && (
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

                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.5rem' }}>
                  <input
                    type="checkbox"
                    id="denseTablesCheckbox"
                    checked={templateConfig.theme.tableDense}
                    onChange={(e) => handleThemeChange('tableDense', e.target.checked)}
                  />
                  <label htmlFor="denseTablesCheckbox" className="srd-sidebar__label" style={{ cursor: 'pointer' }}>
                    Compact / Dense Table Layout
                  </label>
                </div>
              </div>
            )}

            {/* Tab: Sections */}
            {activeTab === 'sections' && (
              <div>
                <div className="srd-sidebar__section-title">Toggle & Order Sections</div>
                {sortedSections.map((section, idx) => (
                  <div key={section.id} style={{ marginBottom: '0.75rem' }}>
                    <div className="srd-sidebar__section-item" style={{ marginBottom: section.enabled ? '0.25rem' : '0' }}>
                      <div className="srd-sidebar__section-item-left">
                        <input
                          type="checkbox"
                          checked={section.enabled}
                          onChange={(e) => handleToggleSection(section.id, e.target.checked)}
                        />
                        <span style={{ fontWeight: section.enabled ? 600 : 400, color: section.enabled ? '#ffffff' : '#6b7280' }}>
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
                      <textarea
                        className="srd-sidebar__textarea"
                        rows={2}
                        style={{ width: '100%', fontSize: '0.75rem', resize: 'vertical' }}
                        placeholder="Custom section introduction text..."
                        value={section.customIntroText || ''}
                        onChange={(e) => handleSectionIntroChange(section.id, e.target.value)}
                      />
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Tab: Headers & Footers */}
            {activeTab === 'headers' && (
              <div className="srd-sidebar__field-group">
                <div className="srd-sidebar__field">
                  <label className="srd-sidebar__label">Classification Banner</label>
                  <input
                    type="text"
                    className="srd-sidebar__input"
                    placeholder="e.g. CONFIDENTIAL, INTERNAL ONLY"
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
                  <label className="srd-sidebar__label">Footer Left</label>
                  <input
                    type="text"
                    className="srd-sidebar__input"
                    value={templateConfig.headersAndFooters.footerLeft || ''}
                    onChange={(e) => handleHeadersChange('footerLeft', e.target.value)}
                  />
                </div>
                <div className="srd-sidebar__field">
                  <label className="srd-sidebar__label">Footer Right</label>
                  <input
                    type="text"
                    className="srd-sidebar__input"
                    value={templateConfig.headersAndFooters.footerRight || ''}
                    onChange={(e) => handleHeadersChange('footerRight', e.target.value)}
                  />
                </div>
              </div>
            )}

            {/* Template JSON Import/Export */}
            <div style={{ marginTop: 'auto', paddingTop: '1rem', borderTop: '1px solid #374151', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
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
          </div>

          {/* Document Preview Paper */}
          <div className="srd-preview-container">
            <div
              className={`srd-preview-paper ${
                templateConfig.theme.pageOrientation === 'landscape'
                  ? 'srd-preview-paper--landscape'
                  : ''
              }`}
              style={
                {
                  '--srd-primary': templateConfig.theme.primaryColor,
                  '--srd-accent': templateConfig.theme.accentColor,
                  '--srd-font': templateConfig.theme.fontFamily,
                } as React.CSSProperties
              }
            >
              {/* Classification Banner */}
              {templateConfig.headersAndFooters.classificationBanner && (
                <div className="srd-doc__banner">
                  {interpolateTokens(
                    templateConfig.headersAndFooters.classificationBanner,
                    srdData,
                  )}
                </div>
              )}

              {/* Document Header */}
              <div className="srd-doc__header">
                <h1 className="srd-doc__title">{srdData.metadata.title}</h1>
                <div className="srd-doc__meta-grid">
                  <div className="srd-doc__meta-item">
                    <strong>Version:</strong> {srdData.metadata.version}
                  </div>
                  <div className="srd-doc__meta-item">
                    <strong>Date:</strong> {srdData.metadata.generatedAt}
                  </div>
                  {srdData.metadata.organization && (
                    <div className="srd-doc__meta-item">
                      <strong>Organization:</strong> {srdData.metadata.organization}
                    </div>
                  )}
                  {srdData.metadata.authors.length > 0 && (
                    <div className="srd-doc__meta-item">
                      <strong>Authors:</strong>{' '}
                      {srdData.metadata.authors
                        .map((a) => (a.role ? `${a.name} (${a.role})` : a.name))
                        .join(', ')}
                    </div>
                  )}
                </div>
              </div>

              {/* Dynamic Sections */}
              {activeSortedSections.map((section) => {
                const sectionTitle = interpolateTokens(section.title, srdData);

                return (
                  <div key={section.id} className="srd-doc__section">
                    <h2 className="srd-doc__section-title">{sectionTitle}</h2>
                    {section.customIntroText && (
                      <p className="srd-doc__intro-text">
                        {interpolateTokens(section.customIntroText, srdData)}
                      </p>
                    )}

                    {section.id === 'executive_summary' && (
                      <div>
                        {srdData.metadata.description && (
                          <div style={{ marginBottom: '1.25rem' }}>
                            <h3 className="srd-doc__sub-title">Scope & Objectives</h3>
                            <p style={{ lineHeight: 1.6, color: '#374151' }}>
                              {srdData.metadata.description}
                            </p>
                          </div>
                        )}
                        <h3 className="srd-doc__sub-title">Key Metrics</h3>
                        <table
                          className={`srd-doc__table ${
                            templateConfig.theme.tableDense ? 'srd-doc__table--dense' : ''
                          }`}
                        >
                          <tbody>
                            <tr>
                              <td>Total Requirements & Items</td>
                              <td><strong>{srdData.requirements.summaryStats.total}</strong></td>
                            </tr>
                            <tr>
                              <td>Completed Work Items</td>
                              <td><strong>{srdData.requirements.summaryStats.completed}</strong></td>
                            </tr>
                            <tr>
                              <td>In-Progress Work Items</td>
                              <td><strong>{srdData.requirements.summaryStats.inProgress}</strong></td>
                            </tr>
                            <tr>
                              <td>Total Estimated Story Points</td>
                              <td><strong>{srdData.requirements.summaryStats.totalPoints} pts</strong></td>
                            </tr>
                            <tr>
                              <td>Completed Story Points</td>
                              <td><strong>{srdData.requirements.summaryStats.completedPoints} pts</strong></td>
                            </tr>
                            <tr>
                              <td>Architecture Components</td>
                              <td><strong>{srdData.architecture.components.length}</strong></td>
                            </tr>
                            <tr>
                              <td>Milestones Defined</td>
                              <td><strong>{srdData.roadmap.milestones.length}</strong></td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    )}

                    {section.id === 'architecture' && (
                      <div>
                        {srdData.architecture.diagramImageBase64 && (
                          <div className="srd-doc__diagram-container">
                            <img
                              src={srdData.architecture.diagramImageBase64}
                              alt="System Architecture Diagram"
                              className="srd-doc__diagram-img"
                            />
                          </div>
                        )}
                        <h3 className="srd-doc__sub-title">Component Inventory</h3>
                        {srdData.architecture.components.length === 0 ? (
                          <p style={{ color: '#6b7280', fontStyle: 'italic' }}>
                            No architecture components defined in canvas.
                          </p>
                        ) : (
                          <table
                            className={`srd-doc__table ${
                              templateConfig.theme.tableDense ? 'srd-doc__table--dense' : ''
                            }`}
                          >
                            <thead>
                              <tr>
                                <th>Component Name</th>
                                <th>Type</th>
                                <th>Description</th>
                                <th>Linked Requirements</th>
                              </tr>
                            </thead>
                            <tbody>
                              {srdData.architecture.components.map((c) => (
                                <tr key={c.id}>
                                  <td><strong>{c.name}</strong></td>
                                  <td><code>{c.type}</code></td>
                                  <td>{c.description || '-'}</td>
                                  <td>{c.linkedRequirementIds?.join(', ') || '-'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}

                        <h3 className="srd-doc__sub-title">Connections & Data Flows</h3>
                        {srdData.architecture.connections.length === 0 ? (
                          <p style={{ color: '#6b7280', fontStyle: 'italic' }}>
                            No connections defined between components.
                          </p>
                        ) : (
                          <table
                            className={`srd-doc__table ${
                              templateConfig.theme.tableDense ? 'srd-doc__table--dense' : ''
                            }`}
                          >
                            <thead>
                              <tr>
                                <th>Source</th>
                                <th>Target</th>
                                <th>Flow Label</th>
                                <th>Protocol</th>
                              </tr>
                            </thead>
                            <tbody>
                              {srdData.architecture.connections.map((conn, i) => (
                                <tr key={i}>
                                  <td><strong>{conn.fromName || conn.from}</strong></td>
                                  <td><strong>{conn.toName || conn.to}</strong></td>
                                  <td>{conn.label || '-'}</td>
                                  <td><code>{conn.protocol || conn.edgeType || '-'}</code></td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </div>
                    )}

                    {section.id === 'requirements' && (
                      <div>
                        {srdData.requirements.categories.map((cat) => {
                          const items = srdData.requirements.itemsByCategory[cat.id] || [];
                          if (items.length === 0) return null;

                          return (
                            <div key={cat.id} style={{ marginBottom: '1.5rem' }}>
                              <h3 className="srd-doc__sub-title" style={{ color: '#2563eb' }}>
                                Category: {cat.label}
                              </h3>
                              <table
                                className={`srd-doc__table ${
                                  templateConfig.theme.tableDense ? 'srd-doc__table--dense' : ''
                                }`}
                              >
                                <thead>
                                  <tr>
                                    <th>ID</th>
                                    <th>Title</th>
                                    <th>Type</th>
                                    <th>Status</th>
                                    <th>Effort</th>
                                    <th>Assignee</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {items.map((item) => (
                                    <tr key={item.id}>
                                      <td><code>{item.id}</code></td>
                                      <td><strong>{item.title}</strong></td>
                                      <td>{item.typeLabel}</td>
                                      <td>{item.status || '-'}</td>
                                      <td>{item.points != null ? `${item.points} pts` : '-'}</td>
                                      <td>{item.assigneeName || '-'}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {section.id === 'traceability' && (
                      <div>
                        {srdData.traceability.length === 0 ? (
                          <p style={{ color: '#6b7280', fontStyle: 'italic' }}>
                            No relationships or architecture linkages established.
                          </p>
                        ) : (
                          <table
                            className={`srd-doc__table ${
                              templateConfig.theme.tableDense ? 'srd-doc__table--dense' : ''
                            }`}
                          >
                            <thead>
                              <tr>
                                <th>Source Entity</th>
                                <th>Relationship</th>
                                <th>Target Entity</th>
                              </tr>
                            </thead>
                            <tbody>
                              {srdData.traceability.map((link, idx) => (
                                <tr key={idx}>
                                  <td>
                                    <code>{link.sourceId}</code> ({link.sourceTitle})
                                  </td>
                                  <td><strong>{link.relation}</strong></td>
                                  <td>
                                    <code>{link.targetId}</code> ({link.targetTitle})
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </div>
                    )}

                    {section.id === 'roadmap' && (
                      <div>
                        <h3 className="srd-doc__sub-title">Milestones</h3>
                        {srdData.roadmap.milestones.length === 0 ? (
                          <p style={{ color: '#6b7280', fontStyle: 'italic' }}>
                            No milestones scheduled.
                          </p>
                        ) : (
                          <table
                            className={`srd-doc__table ${
                              templateConfig.theme.tableDense ? 'srd-doc__table--dense' : ''
                            }`}
                          >
                            <thead>
                              <tr>
                                <th>Milestone</th>
                                <th>Type</th>
                                <th>Target Date</th>
                                <th>Description</th>
                              </tr>
                            </thead>
                            <tbody>
                              {srdData.roadmap.milestones.map((m) => (
                                <tr key={m.id}>
                                  <td><strong>{m.title}</strong></td>
                                  <td><code>{m.type}</code></td>
                                  <td>{m.targetDate || '-'}</td>
                                  <td>{m.description || '-'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}

                        <h3 className="srd-doc__sub-title">Program Increments & Sprints</h3>
                        {srdData.roadmap.sprints.length === 0 ? (
                          <p style={{ color: '#6b7280', fontStyle: 'italic' }}>
                            No sprint iterations planned.
                          </p>
                        ) : (
                          <table
                            className={`srd-doc__table ${
                              templateConfig.theme.tableDense ? 'srd-doc__table--dense' : ''
                            }`}
                          >
                            <thead>
                              <tr>
                                <th>PI</th>
                                <th>Sprint</th>
                                <th>Timeline</th>
                                <th>Effort</th>
                                <th>Items</th>
                              </tr>
                            </thead>
                            <tbody>
                              {srdData.roadmap.sprints.map((s) => (
                                <tr key={s.id}>
                                  <td><strong>{s.piName}</strong></td>
                                  <td>{s.name}</td>
                                  <td>{s.startDate} - {s.endDate}</td>
                                  <td>{s.totalPoints} pts</td>
                                  <td>{s.assignedItems.length} items</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Document Footer */}
              <div className="srd-doc__footer">
                <div>
                  {templateConfig.headersAndFooters.footerLeft &&
                    interpolateTokens(templateConfig.headersAndFooters.footerLeft, srdData)}
                </div>
                <div>
                  {templateConfig.headersAndFooters.footerRight &&
                    interpolateTokens(templateConfig.headersAndFooters.footerRight, srdData)}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
