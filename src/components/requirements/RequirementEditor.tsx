import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { getCaretPixelPosition } from "../../domain/caretPosition";
import type { RequirementItem, RequirementsDocument } from "../../domain/requirementsTypes";
import { ReferencePopover } from "./ReferencePopover";

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
  const [trigger, setTrigger] = useState<ActiveTrigger | null>(null);
  const [popoverPos, setPopoverPos] = useState({ top: 0, left: 0 });
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    if (autoFocus) textareaRef.current?.focus();
  }, [autoFocus]);

  const candidates = trigger ? filterCandidates(doc.items, trigger.query) : [];

  const updateTriggerState = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const caretPos = textarea.selectionStart;
    const active = detectActiveTrigger(textarea.value, caretPos);
    setTrigger(active);
    setSelectedIndex(0);
    if (active) {
      const caret = getCaretPixelPosition(textarea, caretPos);
      setPopoverPos({ top: caret.top + caret.lineHeight, left: caret.left });
    }
  }, []);

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
  };

  return (
    <div className="requirement-editor">
      <textarea
        ref={textareaRef}
        className="requirement-editor__textarea nodrag nopan nowheel"
        value={value}
        placeholder={placeholder}
        spellCheck={false}
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
      {trigger && candidates.length > 0 && (
        <ReferencePopover
          doc={doc}
          candidates={candidates}
          selectedIndex={selectedIndex}
          position={popoverPos}
          onSelect={insertReference}
          onHoverIndex={setSelectedIndex}
        />
      )}
    </div>
  );
}
