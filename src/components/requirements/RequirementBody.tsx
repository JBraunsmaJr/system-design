import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
/**
 * Makes a single newline render as an actual line break.
 *
 * CommonMark treats one newline as a "soft break" and renders it as a
 * space, so consecutive lines collapse into one reflowed paragraph -
 * which is not what anyone typing line by line into a plain textarea
 * expects, and not what the chat and issue trackers people are used to
 * do either. A blank line between every line would technically work, but
 * that's a markdown rule to know rather than something the editor
 * surfaces, and it doubles the vertical space.
 *
 * remark-breaks only rewrites soft breaks inside paragraphs, so code
 * blocks, tables and lists keep their own line handling.
 */
import remarkBreaks from 'remark-breaks';
import { resolveReferencesToMarkdownLinks } from '../../domain/requirementsRegistry';
import type { RequirementsDocument } from '../../domain/requirementsTypes';
import { highlightInReactNode } from '../../domain/reactHighlight';
import { useItemPeek } from './useItemPeek';

interface RequirementBodyProps {
  text: string;
  doc: RequirementsDocument;
  onNavigateToItem: (itemId: string) => void;
  searchQuery?: string;
}

/** Not a real URL scheme - resolveReferencesToMarkdownLinks uses this
 * specifically so the custom `a` override below can tell "a real link the
 * user wrote" apart from "a #REQ-3 reference that got turned into
 * markdown-link syntax so it renders through the normal link machinery",
 * and handle the two completely differently (scroll-to vs navigate). */
const REF_SCHEME_PREFIX = '#ref:';

export function RequirementBody({
  text,
  doc,
  onNavigateToItem,
  searchQuery,
}: RequirementBodyProps) {
  const resolved = resolveReferencesToMarkdownLinks(text, doc);
  // #REQ-3 references get the same hover preview as relationship chips.
  const { peekHandlers, peekNode } = useItemPeek(doc, onNavigateToItem);

  const trimmedQuery = searchQuery?.trim();

  const highlight = (children: React.ReactNode) => {
    return trimmedQuery ? highlightInReactNode(children, trimmedQuery) : children;
  };

  const linkComponent = (
    props: React.AnchorHTMLAttributes<HTMLAnchorElement> & { node?: unknown },
  ) => {
    const { href, children, node: _node, ...rest } = props;
    void _node;
    if (href?.startsWith(REF_SCHEME_PREFIX)) {
      const itemId = href.slice(REF_SCHEME_PREFIX.length);
      return (
        <button
          type="button"
          className="requirement-body__ref-link"
          {...peekHandlers(itemId)}
          onClick={(e) => {
            e.preventDefault();
            onNavigateToItem(itemId);
          }}
        >
          {highlight(children)}
        </button>
      );
    }
    return (
      <a href={href} target="_blank" rel="noreferrer" {...rest}>
        {highlight(children)}
      </a>
    );
  };

  const components: Components = trimmedQuery
    ? {
        a: linkComponent,
        p: ({ children, node: _n, ...rest }) => {
          void _n;
          return <p {...rest}>{highlight(children)}</p>;
        },
        li: ({ children, node: _n, ...rest }) => {
          void _n;
          return <li {...rest}>{highlight(children)}</li>;
        },
        h1: ({ children, node: _n, ...rest }) => {
          void _n;
          return <h1 {...rest}>{highlight(children)}</h1>;
        },
        h2: ({ children, node: _n, ...rest }) => {
          void _n;
          return <h2 {...rest}>{highlight(children)}</h2>;
        },
        h3: ({ children, node: _n, ...rest }) => {
          void _n;
          return <h3 {...rest}>{highlight(children)}</h3>;
        },
        h4: ({ children, node: _n, ...rest }) => {
          void _n;
          return <h4 {...rest}>{highlight(children)}</h4>;
        },
        h5: ({ children, node: _n, ...rest }) => {
          void _n;
          return <h5 {...rest}>{highlight(children)}</h5>;
        },
        h6: ({ children, node: _n, ...rest }) => {
          void _n;
          return <h6 {...rest}>{highlight(children)}</h6>;
        },
        blockquote: ({ children, node: _n, ...rest }) => {
          void _n;
          return <blockquote {...rest}>{highlight(children)}</blockquote>;
        },
        strong: ({ children, node: _n, ...rest }) => {
          void _n;
          return <strong {...rest}>{highlight(children)}</strong>;
        },
        em: ({ children, node: _n, ...rest }) => {
          void _n;
          return <em {...rest}>{highlight(children)}</em>;
        },
        td: ({ children, node: _n, ...rest }) => {
          void _n;
          return <td {...rest}>{highlight(children)}</td>;
        },
        th: ({ children, node: _n, ...rest }) => {
          void _n;
          return <th {...rest}>{highlight(children)}</th>;
        },
        code: ({ children, className, node: _n, ...rest }) => {
          void _n;
          return (
            <code className={className} {...rest}>
              {highlight(children)}
            </code>
          );
        },
      }
    : {
        a: linkComponent,
      };

  return (
    <div className="requirement-body">
      {text.trim() ? (
        <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} components={components}>
          {resolved}
        </ReactMarkdown>
      ) : (
        <span className="requirement-body__placeholder">Double-click to edit</span>
      )}
      {peekNode}
    </div>
  );
}
