import type { RequirementsDocument } from './requirementsTypes';
import { composeItemMarkdown } from './decisionRecords';
import { describeVerification, isVerifiable } from './verification';
import { describeAttributes } from './requirementAttributes';

/** The names an item's owner and target are stored by id for. Left out,
 * an owner on the team and a target are simply not written. */
export interface ExportNames {
  memberNameById: ReadonlyMap<string, string>;
  milestoneNameById: ReadonlyMap<string, string>;
}
import { sanitizeFileName } from '../../common/utils/string';
import { downloadFile } from '../../common/utils/download';

/**
 * Renders the full requirements document as a single markdown string,
 * grouped by item type (in the document's own type order), each item as
 * its own heading with its category (if any) noted underneath. #REQ-3
 * style references are left exactly as written (plain "#REQ-3" text)
 * rather than being rewritten into the app's internal "#ref:" link scheme
 * used for in-app navigation - that scheme only means anything within the
 * app itself. A reader of the exported .md file can still see which items
 * are referenced, just without a clickable link, the same way a
 * plain-text export of any issue tracker would still show "#123" without
 * it being a live link.
 */
export function toMarkdownDocument(
  title: string,
  doc: RequirementsDocument,
  names: Partial<ExportNames> = {},
): string {
  const lookups: ExportNames = {
    memberNameById: names.memberNameById ?? new Map(),
    milestoneNameById: names.milestoneNameById ?? new Map(),
  };
  const lines: string[] = [`# ${title}`, ''];
  for (const type of doc.itemTypes) {
    const items = doc.items.filter((i) => i.typeId === type.id);
    if (items.length === 0) continue;
    lines.push(`## ${type.label}s`, '');
    for (const item of items) {
      lines.push(`### ${item.id}${item.title ? `: ${item.title}` : ''}`, '');
      const category = doc.categories.find((c) => c.id === item.categoryId);
      if (category) {
        lines.push(`*Category: ${category.label}*`, '');
      }
      if (item.tags && item.tags.length > 0) {
        lines.push(`*Tags: ${item.tags.join(', ')}*`, '');
      }
      if (isVerifiable(doc, item)) {
        lines.push(`*${describeAttributes(item, lookups)}*`, '');
        const note = item.verificationNote ? ` (${item.verificationNote})` : '';
        lines.push(`*Verification: ${describeVerification(item)}${note}*`, '');
      }
      // A decision's sections as well as its context (composeItemMarkdown).
      const content = composeItemMarkdown(item).trim();
      if (content) {
        lines.push(content, '');
      }
    }
  }
  return lines.join('\n');
}

/** Triggers a browser download of the requirements document as a .md file. */
export function downloadRequirementsMarkdown(
  title: string,
  doc: RequirementsDocument,
  names: Partial<ExportNames> = {},
): void {
  const markdown = toMarkdownDocument(title, doc, names);
  const safeName = sanitizeFileName(title, 'requirements');
  downloadFile(markdown, `${safeName}.md`, 'text/markdown');
}
