import type { RequirementsDocument } from "./requirementsTypes";

/**
 * Renders the full requirements document as a single markdown string,
 * grouped by item type (in the document's own type order), each item as
 * its own heading. #REQ-3 style references are left exactly as written
 * (plain "#REQ-3" text) rather than being rewritten into the app's
 * internal "#ref:" link scheme used for in-app navigation - that scheme
 * only means anything within the app itself. A reader of the exported .md
 * file can still see which items are referenced, just without a clickable
 * link, the same way a plain-text export of any issue tracker would still
 * show "#123" without it being a live link.
 */
export function toMarkdownDocument(title: string, doc: RequirementsDocument): string {
  const lines: string[] = [`# ${title}`, ""];
  for (const type of doc.itemTypes) {
    const items = doc.items.filter((i) => i.typeId === type.id);
    if (items.length === 0) continue;
    lines.push(`## ${type.label}s`, "");
    for (const item of items) {
      lines.push(`### ${item.id}${item.title ? `: ${item.title}` : ""}`, "");
      if (item.body.trim()) {
        lines.push(item.body.trim(), "");
      }
    }
  }
  return lines.join("\n");
}

/** Triggers a browser download of the requirements document as a .md file. */
export function downloadRequirementsMarkdown(title: string, doc: RequirementsDocument): void {
  const markdown = toMarkdownDocument(title, doc);
  const blob = new Blob([markdown], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  const safeName = title.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  anchor.download = `${safeName || "requirements"}.md`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
