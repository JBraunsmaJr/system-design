import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import {
  formatPropertyValue,
  isMeaningfulValue,
  type DiagramDocumentation,
} from "../../domain/diagramDocumentation";

export interface DocumentationRendererProps {
  documentation: DiagramDocumentation;
  title?: string;
  subtitle?: string;
  className?: string;
}

export function DocumentationRenderer({
  documentation,
  title,
  subtitle,
  className = "",
}: DocumentationRendererProps) {
  const hasDescription =
    typeof documentation.description === "string" &&
    documentation.description.trim().length > 0;

  const validProperties = Object.entries(documentation.properties ?? {}).filter(
    ([key, value]) => key.trim().length > 0 && isMeaningfulValue(value)
  );
  const hasProperties = validProperties.length > 0;

  const validTags = (documentation.tags ?? []).filter(
    (tag) => typeof tag === "string" && tag.trim().length > 0
  );
  const hasTags = validTags.length > 0;

  const hasTitle = typeof title === "string" && title.trim().length > 0;

  // If there is no title and no documentation content at all, don't render empty markup
  if (!hasTitle && !hasDescription && !hasProperties && !hasTags) {
    return null;
  }

  return (
    <div className={`doc-renderer ${className}`.trim()}>
      {/* 1. Optional Header / Name */}
      {(hasTitle || subtitle) && (
        <div className="doc-renderer__header">
          {hasTitle && <h3 className="doc-renderer__title">{title.trim()}</h3>}
          {subtitle && <span className="doc-renderer__subtitle">{subtitle}</span>}
        </div>
      )}

      {/* 2. Description Section */}
      {hasDescription && (
        <div className="doc-renderer__section doc-renderer__description">
          <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>
            {documentation.description!.trim()}
          </ReactMarkdown>
        </div>
      )}

      {/* 3. Properties Section */}
      {hasProperties && (
        <div className="doc-renderer__section doc-renderer__properties">
          <div className="doc-renderer__section-label">Properties</div>
          <div className="doc-renderer__prop-list">
            {validProperties.map(([key, value]) => (
              <div key={key} className="doc-renderer__prop-row">
                <span className="doc-renderer__prop-name">{key.trim()}</span>
                <span className="doc-renderer__prop-value">{formatPropertyValue(value)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 4. Tags Section */}
      {hasTags && (
        <div className="doc-renderer__section doc-renderer__tags">
          <div className="doc-renderer__section-label">Tags</div>
          <div className="doc-renderer__tag-list">
            {validTags.map((tag, idx) => (
              <span key={`${tag}-${idx}`} className="doc-renderer__tag-chip">
                {tag.trim()}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
