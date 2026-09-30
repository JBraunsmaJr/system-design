import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import { interpolateTokens } from '../../domain/srd/srdMarkdownExport';
import type { SrdModalState, SrdPrintModalProps } from './useSrdPrintModal';

/**
 * The live document preview. Its DOM is what the PDF export and printing
 * capture, so its markup must not change without intent.
 *
 * Moved unchanged from SrdPrintModal.tsx; its props are exactly the modal
 * state it reads. Not memoized: it re-renders whenever the modal does, as
 * this markup did when it was inline, at the cost of one extra function
 * call per modal render.
 */
export function SrdDocumentPreview({
  templateConfig,
  currentSrdData,
  isCapturingSnapshot,
  isCapturingItemSnapshot,
  paperRef,
  currentFramingItem,
  framingRelZoom,
  framingDxPercent,
  framingDyPercent,
  isFramingTransformed,
  activeSortedSections,
}: Pick<
  SrdModalState,
  | 'templateConfig'
  | 'currentSrdData'
  | 'isCapturingSnapshot'
  | 'isCapturingItemSnapshot'
  | 'paperRef'
  | 'currentFramingItem'
  | 'framingRelZoom'
  | 'framingDxPercent'
  | 'framingDyPercent'
  | 'isFramingTransformed'
  | 'activeSortedSections'
> &
  Required<Pick<SrdPrintModalProps, 'nodes'>>) {
  return (
    <div className="srd-preview-container">
      <div
        ref={paperRef}
        className={`srd-preview-paper ${
          templateConfig.theme.pageOrientation === 'landscape' ? 'srd-preview-paper--landscape' : ''
        }`}
        style={
          {
            '--srd-primary': templateConfig.theme.primaryColor,
            '--srd-accent': templateConfig.theme.accentColor,
            '--srd-font': templateConfig.theme.fontFamily,
          } as React.CSSProperties
        }
      >
        {/* Running Header Container (for preview) */}
        <div className="srd-doc__running-header-container">
          {/* Classification Banner */}
          {templateConfig.headersAndFooters.classificationBanner && (
            <div className="srd-doc__banner">
              {interpolateTokens(
                templateConfig.headersAndFooters.classificationBanner,
                currentSrdData,
              )}
            </div>
          )}

          {/* Document Running Header */}
          {(templateConfig.headersAndFooters.headerLeft ||
            templateConfig.headersAndFooters.headerRight) && (
            <div className="srd-doc__running-header">
              <div>
                {templateConfig.headersAndFooters.headerLeft &&
                  interpolateTokens(templateConfig.headersAndFooters.headerLeft, currentSrdData)}
              </div>
              <div>
                {templateConfig.headersAndFooters.headerRight &&
                  interpolateTokens(templateConfig.headersAndFooters.headerRight, currentSrdData)}
              </div>
            </div>
          )}
        </div>

        {/* Main Document Content */}
        <div className="srd-doc__content-container">
          {/* Document Header */}
          <div className="srd-doc__header">
            <h1 className="srd-doc__title">{currentSrdData.metadata.title}</h1>
            <div className="srd-doc__meta-grid">
              <div className="srd-doc__meta-item">
                <strong>Version:</strong> {currentSrdData.metadata.version}
              </div>
              <div className="srd-doc__meta-item">
                <strong>Date:</strong> {currentSrdData.metadata.generatedAt}
              </div>
              {currentSrdData.metadata.organization && (
                <div className="srd-doc__meta-item">
                  <strong>Organization:</strong> {currentSrdData.metadata.organization}
                </div>
              )}
              {currentSrdData.metadata.authors.length > 0 && (
                <div className="srd-doc__meta-item">
                  <strong>Authors:</strong>{' '}
                  {currentSrdData.metadata.authors
                    .map((a) => (a.role ? `${a.name} (${a.role})` : a.name))
                    .join(', ')}
                </div>
              )}
            </div>
          </div>

          {/* Dynamic Sections */}
          {activeSortedSections.map((section) => {
            const sectionTitle = interpolateTokens(section.title, currentSrdData);

            return (
              <div key={section.id} className="srd-doc__section">
                <h2 className="srd-doc__section-title">{sectionTitle}</h2>
                {section.customIntroText && (
                  <p className="srd-doc__intro-text">
                    {interpolateTokens(section.customIntroText, currentSrdData)}
                  </p>
                )}

                {section.id === 'executive_summary' && (
                  <div>
                    {currentSrdData.metadata.description && (
                      <div style={{ marginBottom: '1.25rem' }}>
                        <h3 className="srd-doc__sub-title">Scope & Objectives</h3>
                        <div style={{ lineHeight: 1.6, color: '#374151' }}>
                          <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>
                            {currentSrdData.metadata.description}
                          </ReactMarkdown>
                        </div>
                      </div>
                    )}
                    <h3 className="srd-doc__sub-title">Scope & Architecture Metrics</h3>
                    <table
                      className={`srd-doc__table ${
                        templateConfig.theme.tableDense ? 'srd-doc__table--dense' : ''
                      }`}
                    >
                      <tbody>
                        <tr>
                          <td>Total Requirements & Scope Items</td>
                          <td>
                            <strong>{currentSrdData.requirements.summaryStats.total}</strong>
                          </td>
                        </tr>
                        <tr>
                          <td>Requirement Categories Defined</td>
                          <td>
                            <strong>{currentSrdData.requirements.categories.length}</strong>
                          </td>
                        </tr>
                        <tr>
                          <td>Total Estimated Scope / Effort</td>
                          <td>
                            <strong>
                              {currentSrdData.requirements.summaryStats.totalPoints > 0
                                ? `${currentSrdData.requirements.summaryStats.totalPoints} pts`
                                : 'Unestimated'}
                            </strong>
                          </td>
                        </tr>
                        <tr>
                          <td>Architecture Components Defined</td>
                          <td>
                            <strong>{currentSrdData.architecture.components.length}</strong>
                          </td>
                        </tr>
                        <tr>
                          <td>Component Interfaces & Data Flows</td>
                          <td>
                            <strong>{currentSrdData.architecture.connections.length}</strong>
                          </td>
                        </tr>
                        <tr>
                          <td>Target Delivery Milestones</td>
                          <td>
                            <strong>{currentSrdData.roadmap.milestones.length}</strong>
                          </td>
                        </tr>
                        <tr>
                          <td>Planned Delivery Sprints</td>
                          <td>
                            <strong>{currentSrdData.roadmap.sprints.length}</strong>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                )}

                {section.id === 'architecture' && (
                  <div>
                    {currentSrdData.architecture.diagramImageBase64 ? (
                      <div className="srd-doc__diagram-container" style={{ position: 'relative' }}>
                        {isCapturingSnapshot && (
                          <div className="srd-doc__snapshot-loading-overlay">
                            <div
                              className="srd-loading-spinner"
                              style={{ width: 28, height: 28, borderWidth: 2.5 }}
                            />
                            <span>Refreshing architecture snapshot...</span>
                          </div>
                        )}
                        <img
                          src={currentSrdData.architecture.diagramImageBase64}
                          alt="System Architecture Diagram"
                          className="srd-doc__diagram-img"
                        />
                      </div>
                    ) : isCapturingSnapshot ? (
                      <div
                        className="srd-doc__diagram-container"
                        style={{
                          position: 'relative',
                          minHeight: 140,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <div className="srd-doc__snapshot-loading-overlay">
                          <div
                            className="srd-loading-spinner"
                            style={{ width: 28, height: 28, borderWidth: 2.5 }}
                          />
                          <span>Capturing architecture snapshot...</span>
                        </div>
                      </div>
                    ) : null}

                    {templateConfig.includeComponentTable && (
                      <>
                        <h3 className="srd-doc__sub-title">Component Inventory</h3>
                        {currentSrdData.architecture.components.length === 0 ? (
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
                              {currentSrdData.architecture.components.map((c) => (
                                <tr key={c.id}>
                                  <td>
                                    <strong>{c.name}</strong>
                                  </td>
                                  <td>
                                    <code>{c.type}</code>
                                  </td>
                                  <td>{c.description || '-'}</td>
                                  <td>{c.linkedRequirementIds?.join(', ') || '-'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </>
                    )}

                    {templateConfig.includeConnectionsTable && (
                      <>
                        <h3 className="srd-doc__sub-title">Connections & Data Flows</h3>
                        {currentSrdData.architecture.connections.length === 0 ? (
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
                              {currentSrdData.architecture.connections.map((conn, i) => (
                                <tr key={i}>
                                  <td>
                                    <strong>{conn.fromName || conn.from}</strong>
                                  </td>
                                  <td>
                                    <strong>{conn.toName || conn.to}</strong>
                                  </td>
                                  <td>{conn.label || '-'}</td>
                                  <td>
                                    <code>{conn.protocol || conn.edgeType || '-'}</code>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </>
                    )}
                  </div>
                )}

                {section.id === 'requirements' && (
                  <div>
                    {currentSrdData.requirements.categories.map((cat) => {
                      const items = currentSrdData.requirements.itemsByCategory[cat.id] || [];
                      if (items.length === 0) return null;

                      const isTableLayout = templateConfig.requirementsLayout === 'table';

                      return (
                        <div key={cat.id} style={{ marginBottom: '2rem' }}>
                          <h3 className="srd-doc__sub-title">Category: {cat.label}</h3>

                          {isTableLayout ? (
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
                                    <td>
                                      <code>{item.id}</code>
                                    </td>
                                    <td>
                                      <strong>{item.title}</strong>
                                    </td>
                                    <td>{item.typeLabel}</td>
                                    <td>{item.status || '-'}</td>
                                    <td>{item.points != null ? `${item.points} pts` : '-'}</td>
                                    <td>{item.assigneeName || '-'}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          ) : (
                            <div className="srd-doc__item-cards-list">
                              {items.map((item) => {
                                const relatedLinks = currentSrdData.traceability.filter(
                                  (t) => t.sourceId === item.id || t.targetId === item.id,
                                );

                                return (
                                  <div key={item.id} className="srd-doc__item-card">
                                    <div className="srd-doc__item-card-header">
                                      <div className="srd-doc__item-card-title-row">
                                        <span className="srd-doc__badge srd-doc__badge--id">
                                          {item.id}
                                        </span>
                                        <h4 className="srd-doc__item-card-title">
                                          {item.title || '(Untitled Requirement)'}
                                        </h4>
                                      </div>
                                      <div className="srd-doc__item-card-pills">
                                        <span className="srd-doc__badge srd-doc__badge--type">
                                          {item.typeLabel}
                                        </span>
                                        {item.status && (
                                          <span
                                            className={`srd-doc__badge srd-doc__badge--status srd-doc__badge--status-${item.status}`}
                                          >
                                            {item.status}
                                          </span>
                                        )}
                                        {item.points != null && (
                                          <span className="srd-doc__badge srd-doc__badge--points">
                                            {item.points} pts
                                          </span>
                                        )}
                                        {item.sprintName && (
                                          <span className="srd-doc__badge srd-doc__badge--sprint">
                                            {item.sprintName}
                                          </span>
                                        )}
                                        {item.assigneeName && (
                                          <span className="srd-doc__badge srd-doc__badge--assignee">
                                            {item.assigneeName}
                                          </span>
                                        )}
                                      </div>
                                    </div>

                                    {item.contextSnapshotBase64 ? (
                                      <div
                                        className="srd-doc__item-snapshot-container"
                                        style={{ position: 'relative' }}
                                      >
                                        <div className="srd-doc__item-snapshot-caption">
                                          Architecture Context Snapshot
                                        </div>
                                        <img
                                          src={item.contextSnapshotBase64}
                                          alt={`Context snapshot for ${item.id}`}
                                          className="srd-doc__item-snapshot-img"
                                          style={{
                                            transform:
                                              currentFramingItem?.id === item.id &&
                                              isFramingTransformed
                                                ? `translate(${framingDxPercent}%, ${framingDyPercent}%) scale(${framingRelZoom})`
                                                : undefined,
                                            transformOrigin: 'center center',
                                          }}
                                        />
                                      </div>
                                    ) : isCapturingItemSnapshot &&
                                      currentFramingItem?.id === item.id ? (
                                      <div
                                        className="srd-doc__item-snapshot-container"
                                        style={{
                                          position: 'relative',
                                          minHeight: 120,
                                          display: 'flex',
                                          alignItems: 'center',
                                          justifyContent: 'center',
                                        }}
                                      >
                                        <div className="srd-doc__snapshot-loading-overlay">
                                          <div
                                            className="srd-loading-spinner"
                                            style={{ width: 22, height: 22, borderWidth: 2 }}
                                          />
                                          <span>Capturing context snapshot...</span>
                                        </div>
                                      </div>
                                    ) : null}

                                    {item.linkedNodeLabels && item.linkedNodeLabels.length > 0 && (
                                      <div className="srd-doc__item-linked-nodes">
                                        <strong>Linked Components: </strong>
                                        {item.linkedNodeLabels.map((lbl, li) => (
                                          <span key={li} className="srd-doc__node-tag">
                                            {lbl}
                                          </span>
                                        ))}
                                      </div>
                                    )}

                                    {item.body && item.body.trim() && (
                                      <div className="srd-doc__item-body">
                                        <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>
                                          {item.body.trim()}
                                        </ReactMarkdown>
                                      </div>
                                    )}

                                    {relatedLinks.length > 0 && (
                                      <div className="srd-doc__item-dependencies">
                                        <strong>Dependencies & Links: </strong>
                                        <span className="srd-doc__deps-list">
                                          {relatedLinks.map((l, li) => (
                                            <span key={li} className="srd-doc__dep-item">
                                              {l.sourceId === item.id
                                                ? `${l.relation} ${l.targetId} (${l.targetTitle})`
                                                : `Linked from ${l.sourceId} (${l.sourceTitle}) via ${l.relation}`}
                                              {li < relatedLinks.length - 1 ? ' • ' : ''}
                                            </span>
                                          ))}
                                        </span>
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {section.id === 'traceability' && (
                  <div>
                    {currentSrdData.traceability.length === 0 ? (
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
                          {currentSrdData.traceability.map((link, idx) => (
                            <tr key={idx}>
                              <td>
                                <code>{link.sourceId}</code> ({link.sourceTitle})
                              </td>
                              <td>
                                <strong>{link.relation}</strong>
                              </td>
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
                    {currentSrdData.roadmap.milestones.length === 0 ? (
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
                          {currentSrdData.roadmap.milestones.map((m) => (
                            <tr key={m.id}>
                              <td>
                                <strong>{m.title}</strong>
                              </td>
                              <td>
                                <code>{m.type}</code>
                              </td>
                              <td>{m.targetDate || '-'}</td>
                              <td>{m.description || '-'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}

                    <h3 className="srd-doc__sub-title">Program Increments & Sprints</h3>
                    {currentSrdData.roadmap.sprints.length === 0 ? (
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
                          {currentSrdData.roadmap.sprints.map((s) => (
                            <tr key={s.id}>
                              <td>
                                <strong>{s.piName}</strong>
                              </td>
                              <td>{s.name}</td>
                              <td>
                                {s.startDate} - {s.endDate}
                              </td>
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
        </div>

        {/* Running Footer Container (for preview) */}
        <div className="srd-doc__footer-container">
          {(templateConfig.headersAndFooters.footerLeft ||
            templateConfig.headersAndFooters.footerRight) && (
            <div className="srd-doc__footer">
              <div>
                {templateConfig.headersAndFooters.footerLeft &&
                  interpolateTokens(templateConfig.headersAndFooters.footerLeft, currentSrdData)}
              </div>
              <div>
                {templateConfig.headersAndFooters.footerRight &&
                  interpolateTokens(templateConfig.headersAndFooters.footerRight, currentSrdData, {
                    pageNumber: 1,
                    totalPages: 1,
                  })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
