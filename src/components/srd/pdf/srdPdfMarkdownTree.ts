import {unified} from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import type {Root} from 'mdast';

/**
 * Markdown to a syntax tree, with the same remark plugins as the HTML
 * preview: GitHub-flavored Markdown, and single line breaks kept. Separate
 * from the renderer so that module exports only components.
 */
const processor = unified().use(remarkParse).use(remarkGfm).use(remarkBreaks);

export function parseMarkdown(markdown: string): Root {
  return processor.runSync(processor.parse(markdown)) as Root;
}
