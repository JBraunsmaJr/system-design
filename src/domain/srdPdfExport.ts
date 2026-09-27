import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type {
  SrdDataContext,
  SrdTemplateConfig,
  RequirementItemViewModel,
} from './srdTypes';
import { interpolateTokens } from './srdMarkdownExport';

function hexToRgb(hex: string): [number, number, number] {
  const cleanHex = hex.replace('#', '').trim();
  if (cleanHex.length === 3) {
    const r = parseInt(cleanHex[0] + cleanHex[0], 16);
    const g = parseInt(cleanHex[1] + cleanHex[1], 16);
    const b = parseInt(cleanHex[2] + cleanHex[2], 16);
    return [isNaN(r) ? 30 : r, isNaN(g) ? 58 : g, isNaN(b) ? 138 : b];
  }
  if (cleanHex.length === 6) {
    const r = parseInt(cleanHex.substring(0, 2), 16);
    const g = parseInt(cleanHex.substring(2, 4), 16);
    const b = parseInt(cleanHex.substring(4, 6), 16);
    return [isNaN(r) ? 30 : r, isNaN(g) ? 58 : g, isNaN(b) ? 138 : b];
  }
  return [30, 58, 138];
}

export interface GeneratePdfOptions {
  filename?: string;
  onProgress?: (status: string) => void;
}

/**
 * Builds a deterministic, high-fidelity PDF from the SRD Data Context and Template Configuration.
 */
export async function buildSrdPdf(
  srdData: SrdDataContext,
  templateConfig: SrdTemplateConfig,
  options?: GeneratePdfOptions,
): Promise<jsPDF> {
  const orientation = templateConfig.theme.pageOrientation === 'landscape' ? 'landscape' : 'portrait';
  const doc = new jsPDF({
    orientation,
    unit: 'pt',
    format: 'letter',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginLeft = 40;
  const marginRight = 40;
  const contentWidth = pageWidth - marginLeft - marginRight;

  const primaryRgb = hexToRgb(templateConfig.theme.primaryColor || '#1e3a8a');
  const secondaryRgb = hexToRgb(templateConfig.theme.secondaryColor || '#475569');

  const topMargin = templateConfig.headersAndFooters.classificationBanner ||
    templateConfig.headersAndFooters.headerLeft ||
    templateConfig.headersAndFooters.headerRight
      ? 54
      : 40;
  const bottomMargin = templateConfig.headersAndFooters.footerLeft ||
    templateConfig.headersAndFooters.footerRight ||
    templateConfig.headersAndFooters.showPageNumbers
      ? 48
      : 36;
  const maxContentY = pageHeight - bottomMargin;

  let currentY = topMargin + 10;

  function ensureSpace(neededHeight: number) {
    if (currentY + neededHeight > maxContentY) {
      doc.addPage();
      currentY = topMargin + 10;
    }
  }

  // 1. Title & Metadata Header
  options?.onProgress?.('Generating document header...');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.setTextColor(primaryRgb[0], primaryRgb[1], primaryRgb[2]);

  const titleLines = doc.splitTextToSize(srdData.metadata.title, contentWidth);
  doc.text(titleLines, marginLeft, currentY);
  currentY += titleLines.length * 24 + 6;

  // Metadata Grid / Table
  const authorsStr = srdData.metadata.authors.length > 0
    ? srdData.metadata.authors.map((a) => (a.role ? `${a.name} (${a.role})` : a.name)).join(', ')
    : 'Not specified';

  const metaRows: string[][] = [
    ['Version:', srdData.metadata.version, 'Date:', srdData.metadata.generatedAt],
  ];
  if (srdData.metadata.organization) {
    metaRows.push(['Organization:', srdData.metadata.organization, 'Authors:', authorsStr]);
  } else {
    metaRows.push(['Authors:', authorsStr, 'Template:', templateConfig.name]);
  }

  autoTable(doc, {
    startY: currentY,
    margin: { left: marginLeft, right: marginRight, top: topMargin, bottom: bottomMargin },
    theme: 'plain',
    body: metaRows,
    styles: {
      fontSize: 8.5,
      textColor: [71, 85, 105],
      cellPadding: { top: 2, bottom: 2, left: 4, right: 4 },
      font: 'helvetica',
    },
    columnStyles: {
      0: { fontStyle: 'bold', textColor: [30, 41, 59], cellWidth: 70 },
      1: { cellWidth: (contentWidth - 140) / 2 },
      2: { fontStyle: 'bold', textColor: [30, 41, 59], cellWidth: 70 },
      3: { cellWidth: (contentWidth - 140) / 2 },
    },
  });

  currentY = ((doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable?.finalY ?? currentY) + 12;

  // Horizontal divider
  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(1);
  doc.line(marginLeft, currentY, pageWidth - marginRight, currentY);
  currentY += 16;

  // 2. Dynamic Sections
  const activeSortedSections = [...templateConfig.sections]
    .filter((s) => s.enabled)
    .sort((a, b) => a.order - b.order);

  for (const section of activeSortedSections) {
    options?.onProgress?.(`Rendering ${section.title}...`);
    const sectionTitle = interpolateTokens(section.title, srdData);

    const minSectionSpace = section.id === 'architecture' && srdData.architecture.diagramImageBase64 ? 100 : 40;
    ensureSpace(minSectionSpace);

    // Section Heading
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.setTextColor(primaryRgb[0], primaryRgb[1], primaryRgb[2]);
    doc.text(sectionTitle, marginLeft, currentY);
    currentY += 6;

    doc.setDrawColor(primaryRgb[0], primaryRgb[1], primaryRgb[2]);
    doc.setLineWidth(1.5);
    doc.line(marginLeft, currentY, pageWidth - marginRight, currentY);
    currentY += 14;

    // Intro text if present
    if (section.customIntroText) {
      const intro = interpolateTokens(section.customIntroText, srdData);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(71, 85, 105);
      const introLines = doc.splitTextToSize(intro, contentWidth);
      ensureSpace(introLines.length * 12 + 6);
      doc.text(introLines, marginLeft, currentY);
      currentY += introLines.length * 12 + 10;
    }

    // Section Content
    switch (section.id) {
      case 'executive_summary': {
        if (srdData.metadata.description) {
          ensureSpace(30);
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(10);
          doc.setTextColor(30, 41, 59);
          doc.text('Scope & Objectives', marginLeft, currentY);
          currentY += 12;

          doc.setFont('helvetica', 'normal');
          doc.setFontSize(9);
          doc.setTextColor(55, 65, 81);
          const descLines = doc.splitTextToSize(srdData.metadata.description, contentWidth);
          ensureSpace(descLines.length * 12 + 8);
          doc.text(descLines, marginLeft, currentY);
          currentY += descLines.length * 12 + 12;
        }

        ensureSpace(24);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10);
        doc.setTextColor(30, 41, 59);
        doc.text('Scope & Architecture Metrics', marginLeft, currentY);
        currentY += 8;

        const stats = srdData.requirements.summaryStats;
        const metricsData = [
          ['Total Requirements & Scope Items', String(stats.total)],
          ['Requirement Categories Defined', String(srdData.requirements.categories.length)],
          ['Total Estimated Scope / Effort', stats.totalPoints > 0 ? `${stats.totalPoints} pts` : 'Unestimated'],
          ['Architecture Components Defined', String(srdData.architecture.components.length)],
          ['Component Interfaces & Data Flows', String(srdData.architecture.connections.length)],
          ['Target Delivery Milestones', String(srdData.roadmap.milestones.length)],
          ['Planned Delivery Sprints', String(srdData.roadmap.sprints.length)],
        ];

        autoTable(doc, {
          startY: currentY,
          margin: { left: marginLeft, right: marginRight, top: topMargin, bottom: bottomMargin },
          head: [['Metric', 'Value']],
          body: metricsData,
          theme: 'striped',
          styles: {
            fontSize: 8.5,
            cellPadding: templateConfig.theme.tableDense ? 3 : 5,
            font: 'helvetica',
          },
          headStyles: {
            fillColor: [primaryRgb[0], primaryRgb[1], primaryRgb[2]],
            textColor: [255, 255, 255],
            fontStyle: 'bold',
          },
          columnStyles: {
            0: { cellWidth: contentWidth * 0.7 },
            1: { cellWidth: contentWidth * 0.3, fontStyle: 'bold' },
          },
        });

        currentY = ((doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable?.finalY ?? currentY) + 16;
        break;
      }

      case 'architecture': {
        if (srdData.architecture.diagramImageBase64) {
          let imgWidth = contentWidth;
          let imgHeight = Math.min(260, contentWidth * 0.55);

          try {
            const props = doc.getImageProperties(srdData.architecture.diagramImageBase64);
            if (props && props.width && props.height) {
              const naturalRatio = props.height / props.width;
              const maxAllowedHeight = Math.min(340, maxContentY - topMargin - 40);
              imgHeight = Math.min(maxAllowedHeight, contentWidth * naturalRatio);
              imgWidth = imgHeight / naturalRatio;
              if (imgWidth > contentWidth) {
                imgWidth = contentWidth;
                imgHeight = imgWidth * naturalRatio;
              }
            }
          } catch {
            imgHeight = Math.min(240, contentWidth * 0.55);
            imgWidth = contentWidth;
          }

          // Ensure full block (heading + image + margin) fits without overflowing into footer
          const neededSpace = 18 + imgHeight + 16;
          ensureSpace(neededSpace);

          doc.setFont('helvetica', 'bold');
          doc.setFontSize(10);
          doc.setTextColor(30, 41, 59);
          doc.text('System Architecture Diagram', marginLeft, currentY);
          currentY += 10;

          try {
            const imgX = marginLeft + (contentWidth - imgWidth) / 2;
            doc.addImage(
              srdData.architecture.diagramImageBase64,
              'PNG',
              imgX,
              currentY,
              imgWidth,
              imgHeight,
              undefined,
              'FAST',
            );
            currentY += imgHeight + 16;
          } catch {
            // Fallback if image format parse error
            currentY += 10;
          }
        }

        if (templateConfig.includeComponentTable) {
          ensureSpace(24);
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(10);
          doc.setTextColor(30, 41, 59);
          doc.text('Component Inventory', marginLeft, currentY);
          currentY += 8;

          if (srdData.architecture.components.length === 0) {
            doc.setFont('helvetica', 'italic');
            doc.setFontSize(8.5);
            doc.setTextColor(107, 114, 128);
            doc.text('No architecture components defined in canvas.', marginLeft, currentY);
            currentY += 14;
          } else {
            const compRows = srdData.architecture.components.map((c) => [
              c.name,
              c.type,
              c.description || '-',
              c.linkedRequirementIds?.join(', ') || '-',
            ]);

            autoTable(doc, {
              startY: currentY,
              margin: { left: marginLeft, right: marginRight, top: topMargin, bottom: bottomMargin },
              head: [['Component Name', 'Type', 'Description', 'Linked Requirements']],
              body: compRows,
              theme: 'striped',
              styles: {
                fontSize: 8,
                cellPadding: templateConfig.theme.tableDense ? 3 : 5,
                font: 'helvetica',
              },
              headStyles: {
                fillColor: [primaryRgb[0], primaryRgb[1], primaryRgb[2]],
                textColor: [255, 255, 255],
                fontStyle: 'bold',
              },
              columnStyles: {
                0: { fontStyle: 'bold', cellWidth: contentWidth * 0.25 },
                1: { cellWidth: contentWidth * 0.18 },
                2: { cellWidth: contentWidth * 0.32 },
                3: { cellWidth: contentWidth * 0.25 },
              },
            });

            currentY = ((doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable?.finalY ?? currentY) + 16;
          }
        }

        if (templateConfig.includeConnectionsTable) {
          ensureSpace(24);
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(10);
          doc.setTextColor(30, 41, 59);
          doc.text('Connections & Data Flows', marginLeft, currentY);
          currentY += 8;

          if (srdData.architecture.connections.length === 0) {
            doc.setFont('helvetica', 'italic');
            doc.setFontSize(8.5);
            doc.setTextColor(107, 114, 128);
            doc.text('No connections defined between components.', marginLeft, currentY);
            currentY += 14;
          } else {
            const connRows = srdData.architecture.connections.map((c) => [
              c.fromName || c.from,
              c.toName || c.to,
              c.label || '-',
              c.protocol || c.edgeType || '-',
            ]);

            autoTable(doc, {
              startY: currentY,
              margin: { left: marginLeft, right: marginRight, top: topMargin, bottom: bottomMargin },
              head: [['Source', 'Target', 'Flow Label', 'Protocol']],
              body: connRows,
              theme: 'striped',
              styles: {
                fontSize: 8,
                cellPadding: templateConfig.theme.tableDense ? 3 : 5,
                font: 'helvetica',
              },
              headStyles: {
                fillColor: [primaryRgb[0], primaryRgb[1], primaryRgb[2]],
                textColor: [255, 255, 255],
                fontStyle: 'bold',
              },
              columnStyles: {
                0: { fontStyle: 'bold', cellWidth: contentWidth * 0.28 },
                1: { fontStyle: 'bold', cellWidth: contentWidth * 0.28 },
                2: { cellWidth: contentWidth * 0.24 },
                3: { cellWidth: contentWidth * 0.2 },
              },
            });

            currentY = ((doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable?.finalY ?? currentY) + 16;
          }
        }
        break;
      }

      case 'requirements': {
        const isTableLayout = templateConfig.requirementsLayout === 'table';

        for (const cat of srdData.requirements.categories) {
          const items: RequirementItemViewModel[] = srdData.requirements.itemsByCategory[cat.id] || [];
          if (items.length === 0) continue;

          ensureSpace(30);
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(10.5);
          doc.setTextColor(secondaryRgb[0], secondaryRgb[1], secondaryRgb[2]);
          doc.text(`Category: ${cat.label}`, marginLeft, currentY);
          currentY += 8;

          if (isTableLayout) {
            const reqRows = items.map((it) => [
              it.id,
              it.title || '(Untitled)',
              it.typeLabel,
              it.status || '-',
              it.points != null ? `${it.points} pts` : '-',
              it.assigneeName || '-',
            ]);

            autoTable(doc, {
              startY: currentY,
              margin: { left: marginLeft, right: marginRight, top: topMargin, bottom: bottomMargin },
              head: [['ID', 'Title', 'Type', 'Status', 'Effort', 'Assignee']],
              body: reqRows,
              theme: 'striped',
              styles: {
                fontSize: 8,
                cellPadding: templateConfig.theme.tableDense ? 3 : 5,
                font: 'helvetica',
              },
              headStyles: {
                fillColor: [primaryRgb[0], primaryRgb[1], primaryRgb[2]],
                textColor: [255, 255, 255],
                fontStyle: 'bold',
              },
              columnStyles: {
                0: { fontStyle: 'bold', cellWidth: contentWidth * 0.16 },
                1: { cellWidth: contentWidth * 0.34 },
                2: { cellWidth: contentWidth * 0.14 },
                3: { cellWidth: contentWidth * 0.12 },
                4: { cellWidth: contentWidth * 0.1 },
                5: { cellWidth: contentWidth * 0.14 },
              },
            });

            currentY = ((doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable?.finalY ?? currentY) + 14;
          } else {
            // Card / List Layout
            for (const item of items) {
              let itemBodyLines: string[] = [];
              if (item.body && item.body.trim()) {
                doc.setFont('helvetica', 'normal');
                doc.setFontSize(8);
                itemBodyLines = doc.splitTextToSize(item.body.trim(), contentWidth - 12);
              }

              let snapshotHeight = 0;
              let snapshotWidth = contentWidth - 12;
              if (item.contextSnapshotBase64) {
                try {
                  const sProps = doc.getImageProperties(item.contextSnapshotBase64);
                  if (sProps && sProps.width && sProps.height) {
                    const ratio = sProps.height / sProps.width;
                    snapshotHeight = Math.min(150, (contentWidth - 12) * ratio);
                    snapshotWidth = snapshotHeight / ratio;
                    if (snapshotWidth > contentWidth - 12) {
                      snapshotWidth = contentWidth - 12;
                      snapshotHeight = snapshotWidth * ratio;
                    }
                  } else {
                    snapshotHeight = Math.min(130, (contentWidth - 12) * 0.45);
                  }
                } catch {
                  snapshotHeight = Math.min(130, (contentWidth - 12) * 0.45);
                }
              }

              const estimatedCardHeight =
                34 +
                (snapshotHeight > 0 ? snapshotHeight + 8 : 0) +
                (item.linkedNodeLabels && item.linkedNodeLabels.length > 0 ? 14 : 0) +
                (itemBodyLines.length > 0 ? itemBodyLines.length * 10 + 6 : 0) +
                10;

              // Ensure entire card fits without breaking midway or overlapping footer
              ensureSpace(Math.min(estimatedCardHeight, maxContentY - topMargin - 20));

              // Item Card Container Background & Border
              const cardStartY = currentY;
              doc.setFont('helvetica', 'bold');
              doc.setFontSize(9.5);
              doc.setTextColor(30, 41, 59);

              const headerText = `[${item.id}] ${item.title || '(Untitled Requirement)'}`;
              doc.text(headerText, marginLeft + 6, currentY + 12);

              // Pills (Type, Status, Effort, Assignee)
              const pills: string[] = [item.typeLabel];
              if (item.status) pills.push(item.status);
              if (item.points != null) pills.push(`${item.points} pts`);
              if (item.sprintName) pills.push(item.sprintName);
              if (item.assigneeName) pills.push(item.assigneeName);

              doc.setFont('helvetica', 'normal');
              doc.setFontSize(7.5);
              doc.setTextColor(71, 85, 105);
              doc.text(pills.join('  •  '), marginLeft + 6, currentY + 24);

              currentY += 32;

              // Context Snapshot if present
              if (item.contextSnapshotBase64 && snapshotHeight > 0) {
                try {
                  const snapX = marginLeft + 6 + (contentWidth - 12 - snapshotWidth) / 2;
                  doc.addImage(
                    item.contextSnapshotBase64,
                    'PNG',
                    snapX,
                    currentY,
                    snapshotWidth,
                    snapshotHeight,
                    undefined,
                    'FAST',
                  );
                  currentY += snapshotHeight + 8;
                } catch {
                  // ignore image error
                }
              }

              // Linked Components
              if (item.linkedNodeLabels && item.linkedNodeLabels.length > 0) {
                doc.setFont('helvetica', 'bold');
                doc.setFontSize(8);
                doc.setTextColor(71, 85, 105);
                doc.text('Linked Components: ', marginLeft + 6, currentY);
                doc.setFont('helvetica', 'normal');
                doc.text(item.linkedNodeLabels.join(', '), marginLeft + 95, currentY);
                currentY += 12;
              }

              // Body text
              if (itemBodyLines.length > 0) {
                doc.setFont('helvetica', 'normal');
                doc.setFontSize(8);
                doc.setTextColor(51, 65, 85);
                doc.text(itemBodyLines, marginLeft + 6, currentY);
                currentY += itemBodyLines.length * 10 + 6;
              }

              // Card Border
              const cardEndY = currentY + 4;
              doc.setDrawColor(226, 232, 240);
              doc.setLineWidth(0.8);
              doc.rect(marginLeft, cardStartY, contentWidth, cardEndY - cardStartY, 'S');

              currentY = cardEndY + 10;
            }
          }
        }
        break;
      }

      case 'traceability': {
        if (srdData.traceability.length === 0) {
          doc.setFont('helvetica', 'italic');
          doc.setFontSize(8.5);
          doc.setTextColor(107, 114, 128);
          doc.text('No relationships or architecture linkages established.', marginLeft, currentY);
          currentY += 14;
        } else {
          const traceRows = srdData.traceability.map((t) => [
            `${t.sourceId} (${t.sourceTitle})`,
            t.relation,
            `${t.targetId} (${t.targetTitle})`,
          ]);

          autoTable(doc, {
            startY: currentY,
            margin: { left: marginLeft, right: marginRight, top: topMargin, bottom: bottomMargin },
            head: [['Source Entity', 'Relationship', 'Target Entity']],
            body: traceRows,
            theme: 'striped',
            styles: {
              fontSize: 8,
              cellPadding: templateConfig.theme.tableDense ? 3 : 5,
              font: 'helvetica',
            },
            headStyles: {
              fillColor: [primaryRgb[0], primaryRgb[1], primaryRgb[2]],
              textColor: [255, 255, 255],
              fontStyle: 'bold',
            },
            columnStyles: {
              0: { cellWidth: contentWidth * 0.4 },
              1: { fontStyle: 'bold', cellWidth: contentWidth * 0.2 },
              2: { cellWidth: contentWidth * 0.4 },
            },
          });

          currentY = ((doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable?.finalY ?? currentY) + 16;
        }
        break;
      }

      case 'roadmap': {
        // Milestones
        ensureSpace(24);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10);
        doc.setTextColor(30, 41, 59);
        doc.text('Target Delivery Milestones', marginLeft, currentY);
        currentY += 8;

        if (srdData.roadmap.milestones.length === 0) {
          doc.setFont('helvetica', 'italic');
          doc.setFontSize(8.5);
          doc.setTextColor(107, 114, 128);
          doc.text('No milestones scheduled.', marginLeft, currentY);
          currentY += 14;
        } else {
          const mRows = srdData.roadmap.milestones.map((m) => [
            m.title,
            m.type,
            m.targetDate || '-',
            m.description || '-',
          ]);

          autoTable(doc, {
            startY: currentY,
            margin: { left: marginLeft, right: marginRight, top: topMargin, bottom: bottomMargin },
            head: [['Milestone', 'Type', 'Target Date', 'Description']],
            body: mRows,
            theme: 'striped',
            styles: {
              fontSize: 8,
              cellPadding: templateConfig.theme.tableDense ? 3 : 5,
              font: 'helvetica',
            },
            headStyles: {
              fillColor: [primaryRgb[0], primaryRgb[1], primaryRgb[2]],
              textColor: [255, 255, 255],
              fontStyle: 'bold',
            },
            columnStyles: {
              0: { fontStyle: 'bold', cellWidth: contentWidth * 0.3 },
              1: { cellWidth: contentWidth * 0.18 },
              2: { cellWidth: contentWidth * 0.18 },
              3: { cellWidth: contentWidth * 0.34 },
            },
          });

          currentY = ((doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable?.finalY ?? currentY) + 16;
        }

        // Sprints
        ensureSpace(24);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10);
        doc.setTextColor(30, 41, 59);
        doc.text('Program Increments & Sprints', marginLeft, currentY);
        currentY += 8;

        if (srdData.roadmap.sprints.length === 0) {
          doc.setFont('helvetica', 'italic');
          doc.setFontSize(8.5);
          doc.setTextColor(107, 114, 128);
          doc.text('No sprint iterations planned.', marginLeft, currentY);
          currentY += 14;
        } else {
          const spRows = srdData.roadmap.sprints.map((s) => [
            s.piName,
            s.name,
            `${s.startDate} - ${s.endDate}`,
            `${s.totalPoints} pts`,
            `${s.assignedItems.length} items`,
          ]);

          autoTable(doc, {
            startY: currentY,
            margin: { left: marginLeft, right: marginRight, top: topMargin, bottom: bottomMargin },
            head: [['PI', 'Sprint', 'Timeline', 'Effort', 'Assigned Scope']],
            body: spRows,
            theme: 'striped',
            styles: {
              fontSize: 8,
              cellPadding: templateConfig.theme.tableDense ? 3 : 5,
              font: 'helvetica',
            },
            headStyles: {
              fillColor: [primaryRgb[0], primaryRgb[1], primaryRgb[2]],
              textColor: [255, 255, 255],
              fontStyle: 'bold',
            },
            columnStyles: {
              0: { fontStyle: 'bold', cellWidth: contentWidth * 0.2 },
              1: { cellWidth: contentWidth * 0.2 },
              2: { cellWidth: contentWidth * 0.26 },
              3: { cellWidth: contentWidth * 0.16 },
              4: { cellWidth: contentWidth * 0.18 },
            },
          });

          currentY = ((doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable?.finalY ?? currentY) + 16;
        }
        break;
      }
    }
  }

  // 3. Stamp Running Headers, Footers, and Classification Banners on Every Page
  const totalPages = doc.getNumberOfPages();
  options?.onProgress?.(`Applying running headers and footers across ${totalPages} pages...`);

  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);

    // Top Classification Banner
    if (templateConfig.headersAndFooters.classificationBanner) {
      const banner = interpolateTokens(templateConfig.headersAndFooters.classificationBanner, srdData, {
        pageNumber: p,
        totalPages,
      });
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.setTextColor(100, 116, 139);
      doc.text(banner.toUpperCase(), pageWidth / 2, 18, { align: 'center' });
    }

    // Running Header (Left and Right)
    const hl = templateConfig.headersAndFooters.headerLeft
      ? interpolateTokens(templateConfig.headersAndFooters.headerLeft, srdData, { pageNumber: p, totalPages })
      : '';
    const hr = templateConfig.headersAndFooters.headerRight
      ? interpolateTokens(templateConfig.headersAndFooters.headerRight, srdData, { pageNumber: p, totalPages })
      : '';

    if (hl || hr) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(primaryRgb[0], primaryRgb[1], primaryRgb[2]);
      if (hl) {
        doc.text(hl, marginLeft, 34);
      }
      if (hr) {
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(100, 116, 139);
        doc.text(hr, pageWidth - marginRight, 34, { align: 'right' });
      }

      // Divider line
      doc.setDrawColor(226, 232, 240);
      doc.setLineWidth(0.75);
      doc.line(marginLeft, 40, pageWidth - marginRight, 40);
    }

    // Running Footer (Left and Right)
    const fl = templateConfig.headersAndFooters.footerLeft
      ? interpolateTokens(templateConfig.headersAndFooters.footerLeft, srdData, { pageNumber: p, totalPages })
      : '';
    const fr = templateConfig.headersAndFooters.footerRight
      ? interpolateTokens(templateConfig.headersAndFooters.footerRight, srdData, { pageNumber: p, totalPages })
      : templateConfig.headersAndFooters.showPageNumbers
        ? `Page ${p} of ${totalPages}`
        : '';

    if (fl || fr) {
      // Divider line
      doc.setDrawColor(226, 232, 240);
      doc.setLineWidth(0.75);
      doc.line(marginLeft, pageHeight - 32, pageWidth - marginRight, pageHeight - 32);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(100, 116, 139);

      if (fl) {
        doc.text(fl, marginLeft, pageHeight - 20);
      }
      if (fr) {
        doc.text(fr, pageWidth - marginRight, pageHeight - 20, { align: 'right' });
      }
    }
  }

  return doc;
}

/**
 * Direct download of the compiled PDF in the browser.
 */
export async function downloadSrdPdf(
  srdData: SrdDataContext,
  templateConfig: SrdTemplateConfig,
  filename?: string,
  onProgress?: (status: string) => void,
): Promise<void> {
  const doc = await buildSrdPdf(srdData, templateConfig, { onProgress });
  const safeTitle = srdData.metadata.title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const actualFilename = filename || `srd-${safeTitle}-v${srdData.metadata.version}.pdf`;
  doc.save(actualFilename);
}
