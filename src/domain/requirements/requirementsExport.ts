import type { RequirementsDocument } from './requirementsTypes';
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
export function toMarkdownDocument(title: string, doc: RequirementsDocument): string {
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
      if (item.body.trim()) {
        lines.push(item.body.trim(), '');
      }
    }
  }
  return lines.join('\n');
}

/** Triggers a browser download of the requirements document as a .md file. */
export function downloadRequirementsMarkdown(title: string, doc: RequirementsDocument): void {
  const markdown = toMarkdownDocument(title, doc);
  const safeName = sanitizeFileName(title, 'requirements');
  downloadFile(markdown, `${safeName}.md`, 'text/markdown');
}
