import type { SrdDataContext, SrdTemplateConfig } from './srdTypes';

export function interpolateTokens(text: string, data: SrdDataContext): string {
  if (!text) return '';
  const currentYear = new Date().getFullYear().toString();
  return text
    .replace(/\{\{metadata\.title\}\}/g, data.metadata.title)
    .replace(/\{\{title\}\}/g, data.metadata.title)
    .replace(/\{\{metadata\.version\}\}/g, data.metadata.version)
    .replace(/\{\{version\}\}/g, data.metadata.version)
    .replace(/\{\{metadata\.generatedAt\}\}/g, data.metadata.generatedAt)
    .replace(/\{\{generatedAt\}\}/g, data.metadata.generatedAt)
    .replace(/\{\{metadata\.organization\}\}/g, data.metadata.organization || '')
    .replace(/\{\{organization\}\}/g, data.metadata.organization || '')
    .replace(/\{\{year\}\}/g, currentYear);
}

function escapeTableCol(text?: string): string {
  if (!text) return '-';
  return text.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim() || '-';
}

export function generateSrdMarkdown(data: SrdDataContext, config: SrdTemplateConfig): string {
  const lines: string[] = [];

  // 1. Classification Banner / Header
  if (config.headersAndFooters.classificationBanner) {
    const banner = interpolateTokens(config.headersAndFooters.classificationBanner, data);
    lines.push(`> **${banner}**`, '');
  }

  // 2. Document Title & Metadata
  lines.push(`# ${data.metadata.title}`);
  lines.push('');
  lines.push('| Document Property | Value |');
  lines.push('| ----------------- | ----- |');
  lines.push(`| **Document Version** | ${escapeTableCol(data.metadata.version)} |`);
  lines.push(`| **Generated Date** | ${escapeTableCol(data.metadata.generatedAt)} |`);
  if (data.metadata.organization) {
    lines.push(`| **Organization** | ${escapeTableCol(data.metadata.organization)} |`);
  }
  if (data.metadata.authors && data.metadata.authors.length > 0) {
    const authorsStr = data.metadata.authors
      .map((a) => (a.role ? `${a.name} (${a.role})` : a.name))
      .join(', ');
    lines.push(`| **Authors / Contributors** | ${escapeTableCol(authorsStr)} |`);
  }
  lines.push(`| **Template Profile** | ${escapeTableCol(config.name)} |`);
  lines.push('');
  lines.push('---');
  lines.push('');

  // 3. Render Sections by configured order
  const activeSections = config.sections
    .filter((s) => s.enabled)
    .sort((a, b) => a.order - b.order);

  for (const section of activeSections) {
    const sectionTitle = interpolateTokens(section.title, data);
    lines.push(`## ${sectionTitle}`, '');

    if (section.customIntroText) {
      lines.push(interpolateTokens(section.customIntroText, data), '');
    }

    switch (section.id) {
      case 'executive_summary': {
        if (data.metadata.description) {
          lines.push(`### Scope & Objectives`, '', data.metadata.description, '');
        }

        const stats = data.requirements.summaryStats;

        lines.push('### Scope & Architecture Metrics', '');
        lines.push('| Metric | Value |');
        lines.push('| ------ | ----- |');
        lines.push(`| Total Requirements & Scope Items | ${stats.total} |`);
        lines.push(`| Requirement Categories Defined | ${data.requirements.categories.length} |`);
        lines.push(`| Total Estimated Scope / Effort | ${stats.totalPoints > 0 ? `${stats.totalPoints} pts` : 'Unestimated'} |`);
        lines.push(`| Architecture Components Defined | ${data.architecture.components.length} |`);
        lines.push(`| Component Interfaces & Data Flows | ${data.architecture.connections.length} |`);
        lines.push(`| Target Delivery Milestones | ${data.roadmap.milestones.length} |`);
        lines.push(`| Planned Delivery Sprints | ${data.roadmap.sprints.length} |`);
        lines.push('');
        break;
      }

      case 'architecture': {
        if (data.architecture.diagramImageBase64) {
          lines.push('### Architecture Diagram', '');
          lines.push(`![System Architecture Diagram](${data.architecture.diagramImageBase64})`, '');
        }

        if (config.includeComponentTable) {
          lines.push('### Component Inventory', '');
          if (data.architecture.components.length === 0) {
            lines.push('*No architectural components defined in diagram.*', '');
          } else {
            lines.push('| ID | Component Name | Type | Description | Status | Linked Requirements |');
            lines.push('| -- | -------------- | ---- | ----------- | ------ | ------------------- |');
            for (const c of data.architecture.components) {
              const reqs = c.linkedRequirementIds && c.linkedRequirementIds.length > 0
                ? c.linkedRequirementIds.join(', ')
                : '-';
              lines.push(
                `| \`${c.id}\` | **${escapeTableCol(c.name)}** | \`${escapeTableCol(c.type)}\` | ${escapeTableCol(c.description)} | ${escapeTableCol(c.status)} | ${escapeTableCol(reqs)} |`,
              );
            }
            lines.push('');
          }
        }

        lines.push('### Connections & Protocols', '');
        if (data.architecture.connections.length === 0) {
          lines.push('*No connections defined between components.*', '');
        } else {
          lines.push('| Source | Target | Label / Flow | Protocol / Edge Type | Direction |');
          lines.push('| ------ | ------ | ------------ | -------------------- | --------- |');
          for (const conn of data.architecture.connections) {
            lines.push(
              `| **${escapeTableCol(conn.fromName || conn.from)}** | **${escapeTableCol(conn.toName || conn.to)}** | ${escapeTableCol(conn.label)} | \`${escapeTableCol(conn.protocol || conn.edgeType)}\` | ${escapeTableCol(conn.direction || 'forward')} |`,
            );
          }
          lines.push('');
        }
        break;
      }

      case 'requirements': {
        const stats = data.requirements.summaryStats;
        lines.push(
          `*Summary: ${stats.total} total requirements across ${data.requirements.categories.length} categories | ${stats.totalPoints} estimated story points*`,
          '',
        );

        const isListLayout = config.requirementsLayout === 'list';

        for (const cat of data.requirements.categories) {
          const items = data.requirements.itemsByCategory[cat.id] || [];
          if (items.length === 0) continue;

          lines.push(`### Category: ${cat.label}`, '');

          if (!isListLayout) {
            // High-density Table format
            lines.push('| ID | Title | Type | Status | Points | Sprint | Assignee |');
            lines.push('| -- | ----- | ---- | ------ | ------ | ------ | -------- |');
            for (const item of items) {
              lines.push(
                `| \`${item.id}\` | **${escapeTableCol(item.title)}** | ${escapeTableCol(item.typeLabel)} | ${escapeTableCol(item.status)} | ${item.points != null ? `${item.points} pts` : '-'} | ${escapeTableCol(item.sprintName)} | ${escapeTableCol(item.assigneeName)} |`,
              );
            }
            lines.push('');
          } else {
            // Detailed List / Card format with embedded snapshots and links
            for (const item of items) {
              lines.push(`#### ${item.id}: ${item.title || '(Untitled)'}`, '');
              const metaParts: string[] = [];
              metaParts.push(`**Type:** ${item.typeLabel}`);
              if (item.status) metaParts.push(`**Status:** ${item.status}`);
              if (item.points != null) metaParts.push(`**Points:** ${item.points}`);
              if (item.sprintName) metaParts.push(`**Sprint:** ${item.sprintName}`);
              if (item.assigneeName) metaParts.push(`**Assignee:** ${item.assigneeName}`);
              lines.push(metaParts.join(' | '), '');

              if (item.contextSnapshotBase64) {
                lines.push(`![Architecture Context for ${item.id}](${item.contextSnapshotBase64})`, '');
              }

              if (item.linkedNodeLabels && item.linkedNodeLabels.length > 0) {
                lines.push(`*Linked Architecture Components:* ${item.linkedNodeLabels.join(', ')}`, '');
              }

              if (item.body && item.body.trim()) {
                lines.push(item.body.trim(), '');
              }

              const itemLinks = data.traceability.filter(
                (t) => t.sourceId === item.id || t.targetId === item.id,
              );
              if (itemLinks.length > 0) {
                const linkStrs = itemLinks.map((l) =>
                  l.sourceId === item.id
                    ? `${l.relation} \`${l.targetId}\` (${l.targetTitle})`
                    : `Linked from \`${l.sourceId}\` (${l.sourceTitle}) via ${l.relation}`,
                );
                lines.push(`*Dependencies & Links:* ${linkStrs.join('; ')}`, '');
              }
            }
          }
        }
        break;
      }

      case 'traceability': {
        if (data.traceability.length === 0) {
          lines.push('*No relationships or architecture linkages established.*', '');
        } else {
          lines.push('| Source Entity | Relationship | Target Entity |');
          lines.push('| ------------- | ------------ | ------------- |');
          for (const link of data.traceability) {
            lines.push(
              `| \`${link.sourceId}\` (${escapeTableCol(link.sourceTitle)}) | **${escapeTableCol(link.relation)}** | \`${link.targetId}\` (${escapeTableCol(link.targetTitle)}) |`,
            );
          }
          lines.push('');
        }
        break;
      }

      case 'roadmap': {
        lines.push('### Key Milestones', '');
        if (data.roadmap.milestones.length === 0) {
          lines.push('*No milestones scheduled.*', '');
        } else {
          lines.push('| Milestone | Type | Target Date | Description | Related Items |');
          lines.push('| --------- | ---- | ----------- | ----------- | ------------- |');
          for (const m of data.roadmap.milestones) {
            const relItems = m.relatedItemIds && m.relatedItemIds.length > 0
              ? m.relatedItemIds.join(', ')
              : '-';
            lines.push(
              `| **${escapeTableCol(m.title)}** | \`${escapeTableCol(m.type)}\` | ${escapeTableCol(m.targetDate)} | ${escapeTableCol(m.description)} | ${escapeTableCol(relItems)} |`,
            );
          }
          lines.push('');
        }

        lines.push('### Program Increments & Sprints', '');
        if (data.roadmap.sprints.length === 0) {
          lines.push('*No sprint iterations planned.*', '');
        } else {
          lines.push('| Program Increment | Sprint | Start Date | End Date | Effort | Work Items |');
          lines.push('| ----------------- | ------ | ---------- | -------- | ------ | ---------- |');
          for (const s of data.roadmap.sprints) {
            const itemsStr = s.assignedItems.length > 0
              ? `${s.assignedItems.length} items (${s.assignedItems.join(', ')})`
              : '-';
            lines.push(
              `| **${escapeTableCol(s.piName)}** | ${escapeTableCol(s.name)} | ${escapeTableCol(s.startDate)} | ${escapeTableCol(s.endDate)} | ${s.totalPoints} pts | ${escapeTableCol(itemsStr)} |`,
            );
          }
          lines.push('');
        }

        if (data.roadmap.epicSchedules.length > 0) {
          lines.push('### Inferred Epic Schedules', '');
          lines.push('| Epic | Start Date | Inferred End | Status | Workable Items | Points |');
          lines.push('| ---- | ---------- | ------------ | ------ | -------------- | ------ |');
          for (const epic of data.roadmap.epicSchedules) {
            const statusLabel = epic.isFullyScheduled ? 'Scheduled' : 'In Progress / Partial';
            const childProgress = `${epic.completedChildrenCount}/${epic.totalChildrenCount} done (${epic.scheduledChildrenCount} scheduled)`;
            lines.push(
              `| \`${epic.epicId}\` ${escapeTableCol(epic.epicTitle)} | ${escapeTableCol(epic.startDate)} | ${escapeTableCol(epic.endDate)} | ${escapeTableCol(statusLabel)} | ${escapeTableCol(childProgress)} | ${epic.totalPoints} pts |`,
            );
          }
          lines.push('');
        }
        break;
      }
    }

    lines.push('---', '');
  }

  // 4. Footer
  if (config.headersAndFooters.footerLeft || config.headersAndFooters.footerRight) {
    const left = interpolateTokens(config.headersAndFooters.footerLeft || '', data);
    const right = interpolateTokens(config.headersAndFooters.footerRight || '', data);
    lines.push(`*${[left, right].filter(Boolean).join(' — ')}*`, '');
  }

  return lines.join('\n');
}

export function downloadSrdMarkdown(
  data: SrdDataContext,
  config: SrdTemplateConfig,
  filename?: string,
): void {
  const markdown = generateSrdMarkdown(data, config);
  const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;

  const safeTitle = (filename || data.metadata.title || 'srd-specification')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');

  anchor.download = `${safeTitle || 'srd'}.md`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
