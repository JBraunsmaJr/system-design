/**
 * Run with: npx tsx --tsconfig tsconfig.app.json src/domain/markdownEditing.verify.ts
 *
 * The key assertions here don't just compare strings - they run the
 * produced text through the SAME markdown parser the app renders with,
 * and check that emphasis actually came out as emphasis. A string
 * assertion would have happily accepted `**bold **`, which is precisely
 * the bug this suite exists to prevent: it looks correct, and renders as
 * literal asterisks.
 */
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import { wrapSelection, insertLinePrefix, insertTableSkeleton } from "./markdownEditing";

let failures = 0;
function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`ok: ${message}`);
  } else {
    failures++;
    console.error(`FAIL: ${message}`);
  }
}

const processor = unified().use(remarkParse).use(remarkGfm);

/** True when the parsed markdown contains a strong/emphasis node whose
 * text content is exactly `expected` - i.e. the delimiters really did
 * parse as emphasis rather than surviving as literal characters. */
function hasEmphasis(markdown: string, kind: "strong" | "emphasis", expected: string): boolean {
  const tree = processor.parse(markdown);
  let found = false;
  const walk = (node: { type: string; children?: unknown[]; value?: string }) => {
    if (node.type === kind) {
      const text = collectText(node);
      if (text === expected) found = true;
    }
    for (const child of (node.children ?? []) as { type: string; children?: unknown[] }[]) walk(child);
  };
  const collectText = (node: { children?: unknown[]; value?: string }): string => {
    if (typeof node.value === "string") return node.value;
    return ((node.children ?? []) as { children?: unknown[]; value?: string }[]).map(collectText).join("");
  };
  walk(tree as never);
  return found;
}

// === Part 1: a clean selection wraps and parses as bold ===
{
  const text = "make this bold please";
  const r = wrapSelection(text, 10, 14, "**", "**", "bold text");

  assert(r.newText === "make this **bold** please", "a whitespace-free selection is wrapped exactly as before");
  assert(hasEmphasis(r.newText, "strong", "bold"), "and the result genuinely parses as strong emphasis");
  assert(r.newText.slice(r.newSelStart, r.newSelEnd) === "bold", "the new selection covers the wrapped word, not the delimiters");
}

// === Part 2: a TRAILING space in the selection - the reported bug ===
// Double-clicking a word includes the trailing space in most browsers,
// so this is the common case, not an edge case.
{
  const text = "make this bold please";
  const r = wrapSelection(text, 10, 15, "**", "**", "bold text");

  assert(r.newText === "make this **bold** please", "a trailing space is hoisted OUT of the delimiters rather than trapped inside them");
  assert(hasEmphasis(r.newText, "strong", "bold"), "so the result parses as bold - the old behavior produced `**bold **`, which CommonMark renders as literal asterisks because a closing run may not be preceded by whitespace");
  assert(r.newText !== "make this **bold **please", "specifically, the old output `**bold **please` is no longer produced");
}

// === Part 3: a LEADING space in the selection ===
{
  const text = "make this bold please";
  const r = wrapSelection(text, 9, 14, "**", "**", "bold text");

  assert(r.newText === "make this **bold** please", "a leading space is hoisted out too - an opening run may not be FOLLOWED by whitespace");
  assert(hasEmphasis(r.newText, "strong", "bold"), "and the result parses as bold");
}

// === Part 4: whitespace on both sides, and multiple spaces ===
{
  const text = "a  bold  b";
  const r = wrapSelection(text, 1, 9, "**", "**", "bold text");

  assert(r.newText === "a  **bold**  b", "leading and trailing runs of whitespace are both preserved in place, outside the delimiters");
  assert(hasEmphasis(r.newText, "strong", "bold"), "and the result parses as bold");
}

// === Part 5: the same fix applies to italics ===
// Underscore emphasis follows the same flanking rules, so `_italic _`
// fails in exactly the same way `**bold **` does.
{
  const text = "some italic text";
  const r = wrapSelection(text, 5, 12, "_", "_", "italic text");

  assert(r.newText === "some _italic_ text", "italics hoist trailing whitespace out as well");
  assert(hasEmphasis(r.newText, "emphasis", "italic"), "and parse as real emphasis");
}

// === Part 6: an empty selection still inserts the placeholder ===
{
  const text = "before after";
  const r = wrapSelection(text, 7, 7, "**", "**", "bold text");

  assert(r.newText === "before **bold text**after", "an empty selection inserts the wrapped placeholder at the caret");
  assert(r.newText.slice(r.newSelStart, r.newSelEnd) === "bold text", "with the placeholder selected so it can be typed over");
  assert(hasEmphasis(r.newText, "strong", "bold text"), "and the inserted placeholder parses as bold");
}

// === Part 7: an all-whitespace selection behaves like an empty one ===
// There's no word to emphasize, so the whitespace is kept and the
// placeholder is wrapped - rather than producing `**   **`, which is not
// emphasis and leaves the user with stray asterisks to clean up.
{
  const text = "a   b";
  const r = wrapSelection(text, 1, 4, "**", "**", "bold text");

  assert(r.newText === "a   **bold text**b", "an all-whitespace selection keeps its whitespace and wraps the placeholder after it");
  assert(hasEmphasis(r.newText, "strong", "bold text"), "and the result parses as bold");
}

// === Part 8: a multi-word selection with internal spaces is untouched ===
// Only the OUTER edges matter to the flanking rules - internal
// whitespace is part of the emphasized text and must stay inside.
{
  const text = "wrap two words here";
  const r = wrapSelection(text, 5, 14, "**", "**", "bold text");

  assert(r.newText === "wrap **two words** here", "internal whitespace stays inside the delimiters");
  assert(hasEmphasis(r.newText, "strong", "two words"), "and the whole phrase parses as one bold run");
}

// === Part 9: a selection ending in a newline ===
// Selecting to the end of a line often includes the line break; that
// break belongs outside the emphasis, and leaving it inside would break
// the paragraph structure as well as the emphasis.
{
  const text = "line one\nline two";
  const r = wrapSelection(text, 5, 9, "**", "**", "bold text");

  assert(r.newText === "line **one**\nline two", "a trailing newline is hoisted out, keeping the line structure intact");
  assert(hasEmphasis(r.newText, "strong", "one"), "and the result parses as bold");
}

// === Part 10: the other helpers are unaffected ===
{
  const prefixed = insertLinePrefix("first\nsecond", 8, "- ");
  assert(prefixed.newText === "first\n- second", "insertLinePrefix still prefixes the caret's own line");

  const table = insertTableSkeleton("text", 4);
  assert(table.newText.startsWith("text\n| Column 1 |"), "insertTableSkeleton still inserts a leading newline when not at a line start");
  assert(table.newText.slice(table.newCaretPos).startsWith("Column 1"), "and still lands the caret in the first header cell");
}

console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILURE(S)`);
