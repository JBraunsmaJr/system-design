import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  type ChangeEvent as ReactChangeEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type UIEvent as ReactUIEvent,
} from "react";
import { NodeResizer, type NodeProps, type Node } from "@xyflow/react";
import * as Icons from "lucide-react";
import { getCodeLanguage } from "../../domain/codeRegistry";
import { highlightCode } from "../../domain/prismSetup";
import { BidirectionalHandles } from "./BidirectionalHandles";
import type { ArchNodeData } from "../../domain/types";
import { useCanvasContext } from "../CanvasContext";
import { recordNodeRender } from "../../perf/instrumentation";

type CodeNodeType = Node<ArchNodeData, "code">;

interface CodeNodeProps extends NodeProps<CodeNodeType> {
  isEditing?: boolean;
  onStartEditing?: (nodeId: string) => void;
  onFinishEditing?: () => void;
  onChangeCode?: (nodeId: string, code: string) => void;
}

const INDENT = "  ";

export function CodeNode({
  id,
  data,
  selected,
  isEditing: propIsEditing,
  onStartEditing: propOnStartEditing,
  onFinishEditing: propOnFinishEditing,
  onChangeCode: propOnChangeCode,
}: CodeNodeProps) {
  recordNodeRender();
  const canvasContext = useCanvasContext();
  const isEditing = propIsEditing ?? (canvasContext?.editingLabelNodeId === id);
  const onStartEditing = propOnStartEditing ?? (canvasContext?.isPresenting ? undefined : canvasContext?.setEditingLabelNodeId);
  const onFinishEditing = propOnFinishEditing ?? (() => canvasContext?.setEditingLabelNodeId(null));
  const onChangeCode = propOnChangeCode ?? canvasContext?.onChangeCodeNode;

  const languageId = data.codeLanguage ?? "json";
  const lang = getCodeLanguage(languageId);
  const code = data.codeContent ?? "";
  const accent = data.color ?? "#22B8CF";
  // Prism's syntax highlighting is genuinely expensive (several ms for a
  // realistic snippet) and was previously called directly inline,
  // recomputing on every single render regardless of whether THIS
  // node's own code/language had actually changed - including on every
  // unrelated edit anywhere else in the diagram, since the whole nodes
  // array gets new object references on every mutation today. Memoizing
  // here means the highlight only re-runs when what it actually depends
  // on (code, languageId) changes, not on every incidental re-render.
  const highlightedHtml = useMemo(() => highlightCode(code, languageId), [code, languageId]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const highlightRef = useRef<HTMLPreElement>(null);
  const cursorRef = useRef<{ start: number; end: number } | null>(null);

  useEffect(() => {
    if (isEditing) textareaRef.current?.focus();
  }, [isEditing]);

  // When code changes (from typing, Tab, or external updates), restore the
  // textarea's selection/caret position if an edit originated locally.
  // Otherwise, React re-applying `value={code}` on the controlled textarea
  // would cause the browser to push the cursor to the end of the text.
  useLayoutEffect(() => {
    if (cursorRef.current && textareaRef.current) {
      const { start, end } = cursorRef.current;
      textareaRef.current.setSelectionRange(start, end);
    }
    cursorRef.current = null;
  }, [code]);

  const onCodeChange = (event: ReactChangeEvent<HTMLTextAreaElement>) => {
    const textarea = event.currentTarget;
    cursorRef.current = {
      start: textarea.selectionStart,
      end: textarea.selectionEnd,
    };
    onChangeCode?.(id, textarea.value);
  };

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
    const nextCursor = start + INDENT.length;
    cursorRef.current = { start: nextCursor, end: nextCursor };
    onChangeCode(id, nextValue);
    // In case rendering is deferred, also ensure next frame sets the cursor.
    requestAnimationFrame(() => {
      if (textareaRef.current) {
        textareaRef.current.selectionStart = textareaRef.current.selectionEnd = nextCursor;
      }
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
              dangerouslySetInnerHTML={{ __html: highlightedHtml + "\n" }}
            />
            <textarea
              ref={textareaRef}
              className="code-node__editor-textarea"
              spellCheck={false}
              value={code}
              onChange={onCodeChange}
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
              <code dangerouslySetInnerHTML={{ __html: highlightedHtml }} />
            ) : (
              <span className="code-node__placeholder">Double-click to edit</span>
            )}
          </pre>
        )}
      </div>
    </>
  );
}
