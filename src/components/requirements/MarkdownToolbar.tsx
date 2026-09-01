import type { RefObject } from "react";
import { Bold, Italic, List, ListOrdered, ListTodo, Table } from "lucide-react";
import { insertLinePrefix, insertTableSkeleton, wrapSelection } from "../../domain/markdownEditing";

interface MarkdownToolbarProps {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  value: string;
  onChange: (value: string) => void;
}

/**
 * Quick-insert buttons for markdown that doesn't have a natural "just
 * keep typing" continuation the way lists do (see RequirementEditor's
 * Enter/Tab handling for those) - mainly tables, plus bold/italic for
 * convenience. Every button uses onMouseDown + preventDefault rather than
 * onClick: a plain click would blur the textarea first (mousedown fires
 * before click), and RequirementEditor's onBlur exits edit mode entirely -
 * the same race this app already hit and fixed once for the reference
 * popover's own click handling.
 */
export function MarkdownToolbar({ textareaRef, value, onChange }: MarkdownToolbarProps) {
  const applyAndFocus = (newValue: string, newSelStart: number, newSelEnd: number) => {
    const textarea = textareaRef.current;
    onChange(newValue);
    if (!textarea) return;
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.selectionStart = newSelStart;
      textarea.selectionEnd = newSelEnd;
    });
  };

  const onBold = () => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const r = wrapSelection(value, textarea.selectionStart, textarea.selectionEnd, "**", "**", "bold text");
    applyAndFocus(r.newText, r.newSelStart, r.newSelEnd);
  };

  const onItalic = () => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const r = wrapSelection(value, textarea.selectionStart, textarea.selectionEnd, "_", "_", "italic text");
    applyAndFocus(r.newText, r.newSelStart, r.newSelEnd);
  };

  const onBulletList = () => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const r = insertLinePrefix(value, textarea.selectionStart, "- ");
    applyAndFocus(r.newText, r.newCaretPos, r.newCaretPos);
  };

  const onNumberedList = () => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const r = insertLinePrefix(value, textarea.selectionStart, "1. ");
    applyAndFocus(r.newText, r.newCaretPos, r.newCaretPos);
  };

  const onChecklist = () => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const r = insertLinePrefix(value, textarea.selectionStart, "- [ ] ");
    applyAndFocus(r.newText, r.newCaretPos, r.newCaretPos);
  };

  const onTable = () => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const r = insertTableSkeleton(value, textarea.selectionStart);
    applyAndFocus(r.newText, r.newCaretPos, r.newCaretPos);
  };

  return (
    <div className="markdown-toolbar">
      <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={onBold} title="Bold" aria-label="Bold">
        <Bold size={13} />
      </button>
      <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={onItalic} title="Italic" aria-label="Italic">
        <Italic size={13} />
      </button>
      <span className="markdown-toolbar__divider" />
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={onBulletList}
        title="Bullet list"
        aria-label="Bullet list"
      >
        <List size={13} />
      </button>
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={onNumberedList}
        title="Numbered list"
        aria-label="Numbered list"
      >
        <ListOrdered size={13} />
      </button>
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={onChecklist}
        title="Checklist"
        aria-label="Checklist"
      >
        <ListTodo size={13} />
      </button>
      <span className="markdown-toolbar__divider" />
      <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={onTable} title="Table" aria-label="Table">
        <Table size={13} />
      </button>
    </div>
  );
}
