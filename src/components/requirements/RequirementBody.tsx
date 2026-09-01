import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { resolveReferencesToMarkdownLinks } from "../../domain/requirementsRegistry";
import type { RequirementsDocument } from "../../domain/requirementsTypes";

interface RequirementBodyProps {
  text: string;
  doc: RequirementsDocument;
  onNavigateToItem: (itemId: string) => void;
}

/** Not a real URL scheme - resolveReferencesToMarkdownLinks uses this
 * specifically so the custom `a` override below can tell "a real link the
 * user wrote" apart from "a #REQ-3 reference that got turned into
 * markdown-link syntax so it renders through the normal link machinery",
 * and handle the two completely differently (scroll-to vs navigate). */
const REF_SCHEME_PREFIX = "#ref:";

export function RequirementBody({ text, doc, onNavigateToItem }: RequirementBodyProps) {
  const resolved = resolveReferencesToMarkdownLinks(text, doc);

  const components: Components = {
    a: ({ href, children, ...rest }) => {
      if (href?.startsWith(REF_SCHEME_PREFIX)) {
        const itemId = href.slice(REF_SCHEME_PREFIX.length);
        return (
          <button
            type="button"
            className="requirement-body__ref-link"
            onClick={(e) => {
              e.preventDefault();
              onNavigateToItem(itemId);
            }}
          >
            {children}
          </button>
        );
      }
      return (
        <a href={href} target="_blank" rel="noreferrer" {...rest}>
          {children}
        </a>
      );
    },
  };

  return (
    <div className="requirement-body">
      {text.trim() ? (
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
          {resolved}
        </ReactMarkdown>
      ) : (
        <span className="requirement-body__placeholder">Double-click to edit</span>
      )}
    </div>
  );
}
