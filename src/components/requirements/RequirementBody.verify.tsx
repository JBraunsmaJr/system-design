/**
 * Run with: npx tsx --tsconfig tsconfig.app.json src/components/requirements/RequirementBody.verify.tsx
 *
 * Renders the REAL component to static HTML, so these assertions track
 * what the modal and the requirement cards actually output rather than a
 * reconstruction of the plugin chain. Whether a newline became a break
 * or a space is only visible in the rendered result.
 */
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { RequirementBody } from "./RequirementBody";
import { EMPTY_REQUIREMENTS_DOCUMENT } from "../../domain/requirementsTypes";

let failures = 0;
function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`ok: ${message}`);
  } else {
    failures++;
    console.error(`FAIL: ${message}`);
  }
}

const render = (text: string) =>
  renderToStaticMarkup(
    React.createElement(RequirementBody, { text, doc: EMPTY_REQUIREMENTS_DOCUMENT, onNavigateToItem: () => {} })
  );
const breaks = (html: string) => (html.match(/<br\s*\/?>/g) ?? []).length;

// === Part 1: the reported bug ===
// Lines typed one per line collapsed into a single reflowed paragraph,
// because CommonMark renders a lone newline as a space.
{
  const html = render("first line\nsecond line\nthird line");

  assert(breaks(html) === 2, `three typed lines produce two real line breaks, so they stay on separate lines - got ${breaks(html)}`);
  assert((html.match(/<p>/g) ?? []).length === 1, "and it stays ONE paragraph, so the spacing is tight rather than doubled");
}

// === Part 2: blank lines still start new paragraphs ===
{
  const html = render("para one\n\npara two");
  assert((html.match(/<p>/g) ?? []).length === 2, "a blank line still starts a new paragraph, as it always did");
}

// === Part 3: code blocks are untouched ===
// The important safety check - a break inserted inside code would
// visibly corrupt it.
{
  const html = render("```\nconst a = 1;\nconst b = 2;\n```");
  assert(html.includes("<code"), "a fenced code block still renders as code");
  assert(breaks(html) === 0, "and its internal newlines are NOT turned into breaks - only soft breaks inside paragraphs are rewritten");
}

// === Part 4: lists keep their own line handling ===
{
  const html = render("- alpha\n- beta\n- gamma");
  assert((html.match(/<li>/g) ?? []).length === 3, "a list still parses as three items");
  assert(breaks(html) === 0, "with no stray breaks injected between them");
}

// === Part 5: GFM tables survive ===
{
  const html = render("| a | b |\n| --- | --- |\n| 1 | 2 |");
  assert(html.includes("<table>"), "a GFM table still renders as a table rather than collapsing into broken lines");
}

// === Part 6: explicit hard breaks still work ===
{
  assert(breaks(render("one  \ntwo")) === 1, "the two-trailing-spaces hard break still produces exactly one break");
}

// === Part 7: emphasis across a line end ===
// Guards the interaction with wrapSelection's whitespace handling - a
// break landing mid-emphasis would break the emphasis itself.
{
  const html = render("**bold text**\nnext line");
  assert(html.includes("<strong>bold text</strong>"), "emphasis ending at a line end still parses as bold");
  assert(breaks(html) === 1, "and the following newline still breaks");
}

// === Part 8: #REQ references still resolve alongside breaks ===
// resolveReferencesToMarkdownLinks rewrites references into link syntax
// before rendering; breaks must not interfere with that rewrite.
{
  const doc = { ...EMPTY_REQUIREMENTS_DOCUMENT, items: [{ id: "REQ-1", typeId: "requirement", title: "First", body: "" }] } as never;
  const html = renderToStaticMarkup(
    React.createElement(RequirementBody, { text: "see #REQ-1\nand more", doc, onNavigateToItem: () => {} })
  );
  assert(html.includes("REQ-1"), "an item reference still renders");
  assert(breaks(html) === 1, "and the newline after it still breaks");
}

console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILURE(S)`);
