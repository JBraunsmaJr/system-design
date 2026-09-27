const EXCERPT_LENGTH = 240;

/** Markdown reduced to readable plain text for a short excerpt - enough to
 * recognise an item, not a faithful rendering. */
export function markdownExcerpt(markdown: string, maxLength = EXCERPT_LENGTH): string {
  const text = markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, '')
    .replace(/[*_~]{1,3}/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trimEnd()}…` : text;
}

const PREVIEW_SOURCE_LENGTH = 1200;

/** The leading part of a markdown body, for a rendered preview. Cut at a
 * block boundary (a blank line) so a table, list or paragraph is never
 * sliced mid-row or mid-word; a single oversized first block is kept whole
 * and left to the preview's own height clamp. Returns `truncated` so the
 * preview can show that there's more. */
export function markdownPreviewSource(
  markdown: string,
  maxLength = PREVIEW_SOURCE_LENGTH,
): { source: string; truncated: boolean } {
  const text = markdown.trim();
  if (text.length <= maxLength) return { source: text, truncated: false };
  const cut = text.lastIndexOf('\n\n', maxLength);
  if (cut <= 0) {
    const next = text.indexOf('\n\n', maxLength);
    return next === -1
      ? { source: text, truncated: false }
      : { source: text.slice(0, next).trimEnd(), truncated: true };
  }
  let source = text.slice(0, cut).trimEnd();
  // An unclosed code fence would swallow everything after it as code.
  if ((source.match(/^\s{0,3}```/gm)?.length ?? 0) % 2 === 1) source += '\n```';
  return { source, truncated: true };
}
