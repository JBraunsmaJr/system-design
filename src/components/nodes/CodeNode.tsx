import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent, type UIEvent as ReactUIEvent } from "react";
import { NodeResizer, type NodeProps, type Node } from "@xyflow/react";
import * as Icons from "lucide-react";
import { getCodeLanguage } from "../../domain/codeRegistry";
import { highlightCode } from "../../domain/prismSetup";
import { BidirectionalHandles } from "./BidirectionalHandles";
import type { ArchNodeData } from "../../domain/types";

type CodeNodeType = Node<ArchNodeData, "code">;

interface CodeNodeProps extends NodeProps<CodeNodeType> {
  // Same "which node is being edited right now" mechanism Text/Shape nodes
  // use - shared state in Canvas.tsx. onChangeCode is separate from the
  // text/shape nodes' onChangeText since this writes to codeContent, not
  // label (label is this node's optional title instead - see Inspector).
  isEditing?: boolean;
  onStartEditing?: (nodeId: string) => void;
  onFinishEditing?: () => void;
  onChangeCode?: (nodeId: string, code: string) => void;
}

// Inserted for Tab in the editor, since real indentation is fairly
// essential for JSON/code to stay readable as you type it.
const INDENT = "  ";

/**
 * A resizable, connectable code snippet with syntax highlighting -
 * double-click to edit, same interaction pattern as Text/Shape annotations.
 * Language and the optional title (data.label) are set via the Inspector,
 * not inline - only the code content itself is directly editable on the
 * canvas.
 *
 * Highlighting updates live as you type: this is the standard "transparent
 * textarea layered exactly over a highlighted <pre>" technique (the
 * textarea's own text is invisible via `color: transparent`, but its caret
 * stays visible via `caret-color`, and both layers share identical
 * font/padding/line-height so the invisible caret always lines up with the
 * highlighted character underneath). Built directly rather than via a
 * third-party editor package - react-simple-code-editor implements this
 * same technique and was tried first, but it's a plain CommonJS package
 * with no "exports" field, and its compiled `exports.default = Editor`
 * shape triggered "Element type is invalid... got: object" at runtime, a
 * known class of bundler/CJS-interop mismatch. Since that failure mode
 * isn't something reproducible/verifiable outside an actual browser,
 * removing the dependency entirely was more reliable than guessing at a
 * workaround - the technique itself is genuinely just a textarea, a <pre>,
 * and a scroll-sync handler, none of which needed a library to begin with.
 */
export function CodeNode({
  id,
  data,
  selected,
  isEditing,
  onStartEditing,
  onFinishEditing,
  onChangeCode,
}: CodeNodeProps) {
  const languageId = data.codeLanguage ?? "json";
  const lang = getCodeLanguage(languageId);
  const code = data.codeContent ?? "";
  const accent = data.color ?? "#22B8CF";
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const highlightRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (isEditing) textareaRef.current?.focus();
  }, [isEditing]);

  const onCodeKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Escape") {
      event.currentTarget.blur();
      return;
    }
    if (event.key !== "Tab" || !onChangeCode) return;
    event.preventDefault();
    const textarea = event.currentTarget;
    const { selectionStart: start, selectionEnd: end } = textarea;
    const nextValue = textarea.value.slice(0, start) + INDENT + textarea.value.slice(end);
    onChangeCode(id, nextValue);
    // The DOM value won't reflect nextValue until React re-renders with it -
    // restoring the cursor has to wait for that, not happen synchronously.
    requestAnimationFrame(() => {
      textarea.selectionStart = textarea.selectionEnd = start + INDENT.length;
    });
  };

  // Keeps the highlighted layer underneath scrolled to the same position as
  // the (invisible-text, interactive) textarea on top of it - without this,
  // scrolling a long snippet would visually separate the caret from the
  // highlighted text it's supposed to sit on.
  const onEditorScroll = (event: ReactUIEvent<HTMLTextAreaElement>) => {
    if (!highlightRef.current) return;
    highlightRef.current.scrollTop = event.currentTarget.scrollTop;
    highlightRef.current.scrollLeft = event.currentTarget.scrollLeft;
  };

  return (
    <>
      <NodeResizer
        isVisible={!!selected && !isEditing}
        minWidth={200}
        minHeight={120}
        lineClassName="node-resize-line"
        handleClassName="node-resize-handle"
      />
      <BidirectionalHandles />
      <div
        className={`code-node${selected ? " is-selected" : ""}`}
        style={{ borderColor: selected ? "var(--accent)" : `${accent}66` }}
      >
        <div className="code-node__header">
          <Icons.FileCode2 size={12} color={accent} />
          <span className="code-node__lang">{lang.label}</span>
          {data.label && <span className="code-node__title">{data.label}</span>}
        </div>
        {isEditing ? (
          <div className="code-node__editor-wrap nodrag nopan nowheel">
            <pre
              ref={highlightRef}
              aria-hidden="true"
              className="code-node__editor-highlight"
              // Prism's own output for its own recognized languages - see
              // prismSetup.ts's doc comment on highlightCode for why this
              // is safe. Trailing newline keeps the last line's height
              // consistent with the textarea's own (which always renders
              // at least one trailing empty line's worth of space).
              dangerouslySetInnerHTML={{ __html: highlightCode(code, languageId) + "\n" }}
            />
            <textarea
              ref={textareaRef}
              className="code-node__editor-textarea"
              spellCheck={false}
              value={code}
              onChange={(e) => onChangeCode?.(id, e.target.value)}
              onKeyDown={onCodeKeyDown}
              onScroll={onEditorScroll}
              onBlur={() => onFinishEditing?.()}
            />
          </div>
        ) : (
          <pre
            className="code-node__display nodrag nopan nowheel"
            onDoubleClick={(e) => {
              e.stopPropagation();
              onStartEditing?.(id);
            }}
          >
            {code ? (
              <code dangerouslySetInnerHTML={{ __html: highlightCode(code, languageId) }} />
            ) : (
              <span className="code-node__placeholder">Double-click to edit</span>
            )}
          </pre>
        )}
      </div>
    </>
  );
}
