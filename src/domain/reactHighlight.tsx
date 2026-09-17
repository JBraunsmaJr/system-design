import React from "react";
import { splitByHighlight } from "./textHighlight";

/**
 * Recursively traverses a React node tree and highlights matching text segments.
 */
export function highlightInReactNode(node: React.ReactNode, search?: string): React.ReactNode {
  if (!search || !search.trim() || node == null) return node;

  if (typeof node === "string") {
    const segments = splitByHighlight(node, search);
    return (
      <>
        {segments.map((seg, idx) =>
          seg.isMatch ? (
            <mark key={idx} className="search-highlight">
              {seg.text}
            </mark>
          ) : (
            <React.Fragment key={idx}>{seg.text}</React.Fragment>
          )
        )}
      </>
    );
  }

  if (typeof node === "number" || typeof node === "boolean") {
    return node;
  }

  if (Array.isArray(node)) {
    return node.map((child, i) => (
      <React.Fragment key={i}>{highlightInReactNode(child, search)}</React.Fragment>
    ));
  }

  if (React.isValidElement(node)) {
    const props = node.props as { children?: React.ReactNode };
    if (props && props.children) {
      return React.cloneElement(
        node,
        undefined,
        highlightInReactNode(props.children, search)
      );
    }
  }

  return node;
}
