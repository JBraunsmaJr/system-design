import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { getCaretPixelPosition } from "../../domain/caretPosition";
import { computeFlippedPosition, type AnchorRect } from "../../domain/popoverPosition";
import { getCurrentLineBounds, getListEnterBehavior, getListIndentBehavior } from "../../domain/markdownEditing";
import type { RequirementItem, RequirementsDocument } from "../../domain/requirementsTypes";
import { ReferencePopover } from "./ReferencePopover";
import { MarkdownToolbar } from "./MarkdownToolbar";

interface ActiveTrigger {
  triggerIndex: number;
  query: string;
}

/** Walks back from the caret looking for the '#' that started the
 * reference being typed. Whitespace before finding one means there's no
 * active trigger - the caret has moved past a completed word. */
function detectActiveTrigger(text: string, caretPos: number): ActiveTrigger | null {
  let i = caretPos - 1;
  while (i >= 0) {
    const ch = text[i];
    if (ch === "#") return { triggerIndex: i, query: text.slice(i + 1, caretPos) };
    if (/\s/.test(ch)) return null;
    i--;
  }
  return null;
}

function filterCandidates(items: RequirementItem[], query: string, limit = 8): RequirementItem[] {
  const q = query.trim().toLowerCase();
  if (q === "") return items.slice(0, limit);
  return items
    .filter((item) => item.id.toLowerCase().includes(q) || item.title.toLowerCase().includes(q))
    .slice(0, limit);
}

const NON_RETRIGGER_KEYS = new Set(["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"]);
// Used only for the naive initial position guess (left-clamping) before
// the popover has actually rendered and can be measured - the real
// rendered width (CSS min/max-width: 220-320px) is what the layout effect
// below uses once available, so this only has to be a reasonable estimate.
const ESTIMATED_POPOVER_WIDTH = 260;

interface RequirementEditorProps {
  value: string;
  onChange: (value: string) => void;
  onDone: () => void;
  doc: RequirementsDocument;
  autoFocus?: boolean;
  placeholder?: string;
}

export function RequirementEditor({ value, onChange, onDone, doc, autoFocus, placeholder }: RequirementEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<AnchorRect | null>(null);
  const [trigger, setTrigger] = useState<ActiveTrigger | null>(null);
  const [popoverPos, setPopoverPos] = useState({ top: 0, left: 0 });
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    if (autoFocus) textareaRef.current?.focus();
  }, [autoFocus]);

  const candidates = trigger ? filterCandidates(doc.items, trigger.query) : [];

  // Combines the textarea's own on-screen position with the caret's offset
  // WITHIN the textarea to get true viewport coordinates - needed because
  // the popover is portaled (see the render below) and therefore
  // fixed-positioned relative to the viewport, not CSS-relative to
  // anything inside RequirementCard. A non-portaled popover here hit the
  // exact same clipping bug CategoryPicker did: RequirementCard has
  // `overflow: hidden` for its rounded corners, and the scrollable list
  // above it has `overflow: auto` - either would silently cut the popover
  // off the moment it extended past that boundary.
  //
  // This sets a naive "below the caret line" guess - the layout effect
  // below corrects it to "above" if there isn't enough room (e.g. typing
  // a reference near the bottom of the screen), once the popover has
  // actually rendered and its real size can be measured.
  const updateTriggerState = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const caretPos = textarea.selectionStart;
    const active = detectActiveTrigger(textarea.value, caretPos);
    setTrigger(active);
    setSelectedIndex(0);
    if (active) {
      const textareaRect = textarea.getBoundingClientRect();
      const caret = getCaretPixelPosition(textarea, caretPos);
      const anchorTop = textareaRect.top + caret.top;
      const anchorRight = textareaRect.left + caret.left;
      const anchor: AnchorRect = { top: anchorTop, bottom: anchorTop + caret.lineHeight, right: anchorRight };
      anchorRef.current = anchor;
      setPopoverPos({ top: anchor.bottom + 4, left: Math.max(8, anchor.right - ESTIMATED_POPOVER_WIDTH) });
    }
  }, []);

  // Once the popover has actually rendered (so its real size can be
  // measured), checks whether the naive "below the caret" guess actually
  // fits in the viewport and flips it above if not - synchronously before
  // paint (useLayoutEffect, not useEffect), so any correction is invisible
  // rather than a visible jump. Re-runs when the candidate list changes
  // (filtering by query changes the popover's height).
  useLayoutEffect(() => {
    if (!trigger) return;
    const anchor = anchorRef.current;
    const popover = popoverRef.current;
    if (!anchor || !popover) return;
    const rect = popover.getBoundingClientRect();
    const next = computeFlippedPosition(
      anchor,
      { width: rect.width, height: rect.height },
      { width: window.innerWidth, height: window.innerHeight }
    );
    setPopoverPos((prev) => (prev.top === next.top && prev.left === next.left ? prev : next));
  }, [trigger, candidates.length]);

  // A portaled, fixed-position popover doesn't automatically track the
  // caret's on-screen position as the page scrolls the way an in-flow
  // absolutely-positioned one would - recompute while the popover is open.
  // Capture phase (the `true` third argument) catches scroll events from
  // the nested scrollable content area, since scroll events don't bubble.
  useEffect(() => {
    if (!trigger) return;
    window.addEventListener("scroll", updateTriggerState, true);
    window.addEventListener("resize", updateTriggerState);
    return () => {
      window.removeEventListener("scroll", updateTriggerState, true);
      window.removeEventListener("resize", updateTriggerState);
    };
  }, [trigger, updateTriggerState]);

  const insertReference = useCallback(
    (item: RequirementItem) => {
      const textarea = textareaRef.current;
      if (!textarea || !trigger) return;
      const caretPos = textarea.selectionStart;
      const before = value.slice(0, trigger.triggerIndex);
      const after = value.slice(caretPos);
      const inserted = `#${item.id} `;
      onChange(before + inserted + after);
      setTrigger(null);
      const newCaretPos = before.length + inserted.length;
      // The DOM value won't reflect the change until React re-renders with
      // it, so restoring the caret has to wait a frame - same reasoning as
      // the Tab-to-indent handling in CodeNode.
      requestAnimationFrame(() => {
        textarea.focus();
        textarea.selectionStart = textarea.selectionEnd = newCaretPos;
      });
    },
    [trigger, value, onChange]
  );

  // Continues a list on Enter (same marker, incremented number for ordered
  // lists, always-unchecked for checkbox lists) or - for an empty list
  // item - removes the marker and stops there instead of adding a new
  // line, so the user can break out of a list without an endless trail of
  // empty bullets. See markdownEditing.ts's getListEnterBehavior for the
  // actual decision logic; this just applies whichever result it returns.
  const applyListEnter = useCallback(
    (textarea: HTMLTextAreaElement) => {
      const caretPos = textarea.selectionStart;
      const behavior = getListEnterBehavior(value, caretPos);
      if (!behavior) return false;
      let newValue: string;
      let newCaretPos: number;
      if (behavior.replaceCurrentLine) {
        newValue = value.slice(0, behavior.lineStart) + behavior.insertText + value.slice(behavior.lineEnd);
        newCaretPos = behavior.lineStart + behavior.insertText.length;
      } else {
        newValue = value.slice(0, caretPos) + behavior.insertText + value.slice(caretPos);
        newCaretPos = caretPos + behavior.insertText.length;
      }
      onChange(newValue);
      requestAnimationFrame(() => {
        textarea.focus();
        textarea.selectionStart = textarea.selectionEnd = newCaretPos;
      });
      return true;
    },
    [value, onChange]
  );

  // Tab/Shift+Tab indents or outdents the current list item line - a
  // no-op (returns false, so the caller falls back to normal Tab
  // behavior) when the current line isn't a list item at all.
  const applyListIndent = useCallback(
    (textarea: HTMLTextAreaElement, indent: boolean) => {
      const caretPos = textarea.selectionStart;
      const { lineStart, lineEnd, line } = getCurrentLineBounds(value, caretPos);
      const behavior = getListIndentBehavior(line, indent);
      if (!behavior) return false;
      const newValue = value.slice(0, lineStart) + behavior.newLine + value.slice(lineEnd);
      const newCaretPos = Math.max(lineStart, caretPos + behavior.caretDelta);
      onChange(newValue);
      requestAnimationFrame(() => {
        textarea.focus();
        textarea.selectionStart = textarea.selectionEnd = newCaretPos;
      });
      return true;
    },
    [value, onChange]
  );

  const onKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Escape") {
      if (trigger) {
        event.preventDefault();
        setTrigger(null);
        return;
      }
      event.currentTarget.blur();
      return;
    }
    if (trigger && candidates.length > 0) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setSelectedIndex((i) => (i + 1) % candidates.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setSelectedIndex((i) => (i - 1 + candidates.length) % candidates.length);
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        insertReference(candidates[selectedIndex]);
        return;
      }
    }
    // The reference popover isn't consuming this key - check for
    // list-editing behaviors before falling back to the browser's normal
    // Enter (newline) / Tab (focus-shift) handling.
    if (event.key === "Enter" && applyListEnter(event.currentTarget)) {
      event.preventDefault();
      return;
    }
    if (event.key === "Tab" && applyListIndent(event.currentTarget, !event.shiftKey)) {
      event.preventDefault();
      return;
    }
  };

  return (
    <div className="requirement-editor">
      <MarkdownToolbar textareaRef={textareaRef} value={value} onChange={onChange} />
      <textarea
        ref={textareaRef}
        className="requirement-editor__textarea nodrag nopan nowheel"
        value={value}
        placeholder={placeholder}
        spellCheck={true}
        onChange={(e: ChangeEvent<HTMLTextAreaElement>) => {
          onChange(e.target.value);
          requestAnimationFrame(updateTriggerState);
        }}
        onKeyDown={onKeyDown}
        onKeyUp={(e) => {
          if (!NON_RETRIGGER_KEYS.has(e.key)) updateTriggerState();
        }}
        onClick={updateTriggerState}
        onBlur={() => {
          setTrigger(null);
          onDone();
        }}
      />
      {trigger &&
        candidates.length > 0 &&
        createPortal(
          <ReferencePopover
            ref={popoverRef}
            doc={doc}
            candidates={candidates}
            selectedIndex={selectedIndex}
            position={popoverPos}
            onSelect={insertReference}
            onHoverIndex={setSelectedIndex}
          />,
          document.body
        )}
    </div>
  );
}
