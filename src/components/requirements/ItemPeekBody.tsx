import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import { resolveReferencesToMarkdownLinks } from '../../domain/requirementsRegistry';
import type { RequirementsDocument } from '../../domain/requirementsTypes';
import { markdownPreviewSource } from '../../domain/markdownExcerpt';

/** Same sentinel RequirementBody uses for #ID references turned into links. */
const REF_SCHEME_PREFIX = '#ref:';

/**
 * An item's body rendered as markdown for the hover preview - same parser
 * and plugins as RequirementBody, so a table or list looks the way it does
 * on the card rather than as raw pipes and dashes.
 *
 * References render as chips but aren't interactive: a peek opening its own
 * peek would stack popovers, and the "Go to" button already covers
 * navigation.
 */
export function ItemPeekBody({ markdown, doc }: { markdown: string; doc: RequirementsDocument }) {
  const { source, truncated } = markdownPreviewSource(markdown);
  if (!source) return null;

  const components: Components = {
    a: ({ href, children, node: _n, ...rest }) => {
      void _n;
      if (href?.startsWith(REF_SCHEME_PREFIX)) {
        return <span className="item-peek__ref">{children}</span>;
      }
      return (
        <a href={href} target="_blank" rel="noreferrer" {...rest}>
          {children}
        </a>
      );
    },
    // Wide tables scroll inside the card instead of stretching it.
    table: ({ children, node: _n, ...rest }) => {
      void _n;
      return (
        <div className="item-peek__table-wrap">
          <table {...rest}>{children}</table>
        </div>
      );
    },
  };

  return (
    <div className={`item-peek__body${truncated ? ' is-truncated' : ''}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} components={components}>
        {resolveReferencesToMarkdownLinks(source, doc)}
      </ReactMarkdown>
    </div>
  );
}
