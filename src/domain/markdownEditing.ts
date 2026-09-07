export interface ListMatch {
  /** Leading whitespace before the marker. */
  indent: string;
  /** The literal marker character(s): "-", "*", "+" for unordered, or "." / ")" for ordered. */
  marker: string;
  /** " ", "x", "X" if this is a checkbox item, null otherwise. */
  checkbox: string | null;
  /** The text after the marker (and checkbox, if any). */
  content: string;
  isOrdered: boolean;
  /** Parsed number for an ordered item, null otherwise. */
  orderedNumber: number | null;
}

// Requires whitespace before the marker to be at the START of the line
// (the ^ anchor), which is what keeps a mid-sentence "3.5 is a number"
// from being mistaken for an ordered list item "3." - the decimal isn't
// at a line start, so it never matches.
const UNORDERED_LIST_RE = /^(\s*)([-*+])\s(?:\[([ xX])\]\s)?(.*)$/;
const ORDERED_LIST_RE = /^(\s*)(\d+)([.)])\s(.*)$/;

export function matchListLine(line: string): ListMatch | null {
  const unordered = line.match(UNORDERED_LIST_RE);
  if (unordered) {
    return {
      indent: unordered[1],
      marker: unordered[2],
      checkbox: unordered[3] ?? null,
      content: unordered[4],
      isOrdered: false,
      orderedNumber: null,
    };
  }
  const ordered = line.match(ORDERED_LIST_RE);
  if (ordered) {
    return {
      indent: ordered[1],
      marker: ordered[3],
      checkbox: null,
      content: ordered[4],
      isOrdered: true,
      orderedNumber: parseInt(ordered[2], 10),
    };
  }
  return null;
}

/** Finds the boundaries of the line containing `caretPos` within `text` -
 * shared by getListEnterBehavior and the Tab-to-indent handler, which both
 * need to isolate "the current line" before doing anything else with it. */
export function getCurrentLineBounds(text: string, caretPos: number): { lineStart: number; lineEnd: number; line: string } {
  const lineStart = text.lastIndexOf("\n", caretPos - 1) + 1;
  const lineEndSearch = text.indexOf("\n", caretPos);
  const lineEnd = lineEndSearch === -1 ? text.length : lineEndSearch;
  return { lineStart, lineEnd, line: text.slice(lineStart, lineEnd) };
}

export interface EnterResult {
  /** Text to splice in. */
  insertText: string;
  /** If true, `insertText` REPLACES the entire current line rather than
   * being inserted at the caret - used only for the "breaking out of an
   * empty list item" case. */
  replaceCurrentLine?: boolean;
  lineStart: number;
  lineEnd: number;
}

/**
 * Determines what pressing Enter should do given the full text and caret
 * position - returns null if the current line isn't a list item at all,
 * meaning a normal newline should be inserted instead.
 *
 * An EMPTY list item (just the marker, nothing typed after it) breaks out
 * of the list instead of continuing it: the marker is removed from the
 * current line and no new line is added. This matches how Notion/Typora/
 * GitHub's own editor behave, and exists specifically to prevent an
 * infinite trail of empty bullets when the user is done with a list and
 * just wants to keep typing normal text.
 */
export function getListEnterBehavior(text: string, caretPos: number): EnterResult | null {
  const { lineStart, lineEnd, line } = getCurrentLineBounds(text, caretPos);

  const match = matchListLine(line);
  if (!match) return null;

  if (match.content.trim() === "") {
    return { insertText: match.indent, replaceCurrentLine: true, lineStart, lineEnd };
  }

  const nextMarker = match.isOrdered
    ? `${match.indent}${(match.orderedNumber ?? 0) + 1}${match.marker} `
    : match.checkbox !== null
      ? `${match.indent}${match.marker} [ ] `
      : `${match.indent}${match.marker} `;

  return { insertText: `\n${nextMarker}`, lineStart, lineEnd };
}

const INDENT_UNIT = "  ";

export interface IndentResult {
  /** The full replacement text for the current line. */
  newLine: string;
  /** How far the caret should shift (positive = right, negative = left). */
  caretDelta: number;
}

/**
 * Returns how Tab (indent=true) or Shift+Tab (indent=false) should modify
 * the current list-item line, or null if the line isn't a list item (Tab
 * should fall back to its normal, non-special behavior) or - for
 * Shift+Tab specifically - the line has no leading indent left to remove.
 */
export function getListIndentBehavior(line: string, indent: boolean): IndentResult | null {
  const match = matchListLine(line);
  if (!match) return null;

  if (indent) {
    return { newLine: INDENT_UNIT + line, caretDelta: INDENT_UNIT.length };
  }
  const leadingSpaces = line.match(/^ */)?.[0].length ?? 0;
  const removeCount = Math.min(INDENT_UNIT.length, leadingSpaces);
  if (removeCount === 0) return null;
  return { newLine: line.slice(removeCount), caretDelta: -removeCount };
}

/**
 * Wraps the selected text in `before`/`after` markers (e.g. bold/italic).
 * If nothing is selected, inserts `before` + `placeholder` + `after` with
 * the placeholder itself selected, so the user can either type over it
 * immediately or click past it to keep the markers empty.
 */
/**
 * Wraps the current selection in `before`/`after`, or inserts
 * `placeholder` wrapped when nothing is selected.
 *
 * Any leading or trailing whitespace in the selection is deliberately
 * left OUTSIDE the delimiters. CommonMark decides whether `**` opens or
 * closes emphasis from what sits immediately next to it: an opening run
 * must not be followed by whitespace, and a closing run must not be
 * preceded by it. So wrapping a selection verbatim turns "bold " into
 * `**bold **`, which is not emphasis at all - it renders as literal
 * asterisks. Double-clicking a word includes the trailing space in most
 * browsers, so the naive version worked or didn't depending on how the
 * text happened to be selected, which is exactly as confusing as it
 * sounds. Hoisting the whitespace out produces `**bold** `, which parses.
 */
export function wrapSelection(
  text: string,
  selStart: number,
  selEnd: number,
  before: string,
  after: string,
  placeholder: string
): { newText: string; newSelStart: number; newSelEnd: number } {
  const selected = text.slice(selStart, selEnd);
  const leading = /^\s*/.exec(selected)![0];
  const rest = selected.slice(leading.length);
  const trailing = /\s*$/.exec(rest)![0];
  const core = rest.slice(0, rest.length - trailing.length);
  // An all-whitespace selection has no core to emphasize, so it's
  // treated the same as no selection at all - the whitespace is kept and
  // the placeholder is wrapped after it.
  const inner = core || placeholder;
  const newText =
    text.slice(0, selStart) + leading + before + inner + after + trailing + text.slice(selEnd);
  const newSelStart = selStart + leading.length + before.length;
  return { newText, newSelStart, newSelEnd: newSelStart + inner.length };
}

/** Inserts `prefix` at the START of the current line (not at the caret),
 * used for the bullet/numbered/checklist toolbar buttons - so clicking
 * the button anywhere within a line always prefixes that whole line. */
export function insertLinePrefix(
  text: string,
  caretPos: number,
  prefix: string
): { newText: string; newCaretPos: number } {
  const lineStart = text.lastIndexOf("\n", caretPos - 1) + 1;
  const newText = text.slice(0, lineStart) + prefix + text.slice(lineStart);
  return { newText, newCaretPos: caretPos + prefix.length };
}

/** Inserts a starter markdown table at the caret, adding a leading
 * newline first only if the caret isn't already at the start of a fresh
 * line (avoiding a redundant blank line in the common case of inserting
 * right after an existing paragraph). Caret lands in the first header
 * cell, ready to type over "Column 1". */
export function insertTableSkeleton(text: string, caretPos: number): { newText: string; newCaretPos: number } {
  const needsLeadingNewline = caretPos > 0 && text[caretPos - 1] !== "\n";
  const table = `${needsLeadingNewline ? "\n" : ""}| Column 1 | Column 2 |\n| --- | --- |\n|  |  |\n`;
  const newText = text.slice(0, caretPos) + table + text.slice(caretPos);
  const firstCellOffset = (needsLeadingNewline ? 1 : 0) + 2;
  return { newText, newCaretPos: caretPos + firstCellOffset };
}
