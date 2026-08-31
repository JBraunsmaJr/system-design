import Prism from "prismjs";

// Import order matters here - each of these registers itself onto the
// shared `Prism.languages` object as a side effect, and a few extend an
// earlier one rather than starting from scratch:
//   javascript extends clike; typescript extends javascript; markdown
//   extends markup. Importing a dependency AFTER the thing that extends it
// would silently leave the extending language broken (it would be
// extending whatever partial/undefined grammar existed at that point), so
// each base is imported immediately before what builds on it.
import "prismjs/components/prism-clike";
import "prismjs/components/prism-javascript";
import "prismjs/components/prism-typescript";
import "prismjs/components/prism-markup";
import "prismjs/components/prism-markdown";
import "prismjs/components/prism-json";
import "prismjs/components/prism-python";
import "prismjs/components/prism-yaml";
import "prismjs/components/prism-sql";
import "prismjs/components/prism-bash";

export { Prism };

/** Highlights `code` for `languageId`, returning safe-to-render HTML (Prism
 * escapes the underlying text itself, only adding its own `<span
 * class="token ...">` wrappers - this is Prism's own standard, documented
 * output shape for exactly this kind of embedding). Falls back to
 * HTML-escaped plain text for "plaintext" or any language id Prism doesn't
 * recognize, rather than throwing. */
export function highlightCode(code: string, languageId: string): string {
  const grammar = Prism.languages[languageId];
  if (!grammar) {
    return code.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  return Prism.highlight(code, grammar, languageId);
}
