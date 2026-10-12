import {useEffect} from 'react';
import type {ViewMode} from './useViewNavigation';

export interface UseKeyboardShortcutsOptions {
  isPresenting: boolean;
  viewMode: ViewMode;
  selectedNodeIds: string[];
  selectedEdgeIds: string[];
  onDeleteSelection: () => void;
  onCopy: () => void;
  onPaste: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onPresentNext: () => void;
  onPresentPrev: () => void;
  onExitPresenting: () => void;
    /** Ctrl/Cmd+D. */
    onDuplicate?: (nodeIds: string[]) => void;
    /** Ctrl/Cmd+G. */
    onGroup?: (nodeIds: string[]) => void;
    /** Ctrl/Cmd+Shift+G. */
    onUngroup?: (nodeIds: string[]) => void;
    /** Ctrl/Cmd+Alt+C. */
    onCopyStyle?: (nodeIds: string[], edgeIds: string[]) => void;
    /** Ctrl/Cmd+Alt+V. */
    onPasteStyle?: (nodeIds: string[], edgeIds: string[]) => void;
}

/**
 * Window-level keyboard shortcuts: delete, copy/paste, undo/redo, and
 * presentation navigation. Moved unchanged from App.tsx, in the same order,
 * so listeners are registered in the same order as before.
 *
 * PERFORMANCE: these are effects, not handlers passed to children, so a
 * dependency changing re-registers one window listener and renders nothing.
 * Kept as four effects rather than one so that, e.g., a selection change
 * does not re-register the undo listener.
 */
export function useKeyboardShortcuts({
  isPresenting,
  viewMode,
  selectedNodeIds,
  selectedEdgeIds,
  onDeleteSelection,
  onCopy,
  onPaste,
  onUndo,
  onRedo,
  onPresentNext,
  onPresentPrev,
  onExitPresenting,
                                         onDuplicate,
                                         onGroup,
                                         onUngroup,
                                         onCopyStyle,
                                         onPasteStyle,
}: UseKeyboardShortcutsOptions) {
  // Delete key: acts on whatever's currently multi-selected, but never while
  // presenting, and never while typing in a field.
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (isPresenting) return;
      if (viewMode !== 'diagram') return;
      if (event.key !== 'Backspace' && event.key !== 'Delete') return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return;
      if (selectedNodeIds.length > 0 || selectedEdgeIds.length > 0) {
        onDeleteSelection();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isPresenting, viewMode, selectedNodeIds, selectedEdgeIds, onDeleteSelection]);

  // Copy/paste: Ctrl+C / Cmd+C and Ctrl+V / Cmd+V, same guards as delete -
  // never while presenting, never while typing in a field (so normal text
  // copy/paste inside the Inspector's inputs is completely unaffected), and
  // never when text is highlighted/selected during copy (so users can copy
  // selected text from requirement items and elsewhere via standard clipboard).
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (isPresenting) return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return;

      const key = event.key.toLowerCase();
        // Ctrl+Alt+C/V are copy/paste STYLE - handled below, not here.
        if (event.altKey) return;
      if ((event.ctrlKey || event.metaKey) && key === 'c') {
        const selection = window.getSelection();
        const hasTextSelection = Boolean(
          selection && !selection.isCollapsed && selection.toString().length > 0,
        );
        if (hasTextSelection) return;
        if (viewMode !== 'diagram') return;
        event.preventDefault();
        onCopy();
      } else if ((event.ctrlKey || event.metaKey) && key === 'v') {
        if (viewMode !== 'diagram') return;
        event.preventDefault();
        onPaste();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isPresenting, viewMode, onCopy, onPaste]);

  // Undo/redo: Ctrl+Z / Cmd+Z, and BOTH common redo conventions - Ctrl+Y
  // (Windows-style) and Ctrl+Shift+Z (Mac/many web apps) - same guards as
  // copy/paste. Deliberately a separate effect from copy/paste above rather
  // than folded into it, since the redo-key handling (checking shiftKey,
  // supporting two different keys) is its own bit of complexity worth
  // keeping visually separate from the simpler copy/paste block.
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (isPresenting) return;
      if (viewMode !== 'diagram') return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return;
      if (!(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (key === 'z' && event.shiftKey) {
        event.preventDefault();
        onRedo();
      } else if (key === 'z') {
        event.preventDefault();
        onUndo();
      } else if (key === 'y') {
        event.preventDefault();
        onRedo();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isPresenting, viewMode, onUndo, onRedo]);

    // Selection commands that mirror the context menu: duplicate, group,
    // ungroup, and copy/paste style. Same guards as copy/paste. Matched on
    // event.code for the style pair, because Alt changes event.key on macOS
    // (Option+C types "ç").
    useEffect(() => {
        const handler = (event: KeyboardEvent) => {
            if (isPresenting) return;
            if (viewMode !== 'diagram') return;
            const target = event.target as HTMLElement | null;
            const tag = target?.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return;
            if (!(event.ctrlKey || event.metaKey)) return;
            if (event.altKey && event.code === 'KeyC' && onCopyStyle) {
                if (selectedNodeIds.length === 0 && selectedEdgeIds.length === 0) return;
                event.preventDefault();
                onCopyStyle(selectedNodeIds, selectedEdgeIds);
                return;
            }
            if (event.altKey && event.code === 'KeyV' && onPasteStyle) {
                if (selectedNodeIds.length === 0 && selectedEdgeIds.length === 0) return;
                event.preventDefault();
                onPasteStyle(selectedNodeIds, selectedEdgeIds);
                return;
            }
            if (event.altKey || selectedNodeIds.length === 0) return;
            const key = event.key.toLowerCase();
            if (key === 'd' && !event.shiftKey && onDuplicate) {
                event.preventDefault(); // the browser's "bookmark this page"
                onDuplicate(selectedNodeIds);
            } else if (key === 'g' && event.shiftKey && onUngroup) {
                event.preventDefault();
                onUngroup(selectedNodeIds);
            } else if (key === 'g' && !event.shiftKey && onGroup) {
                event.preventDefault(); // the browser's "find next"
                onGroup(selectedNodeIds);
            }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [
        isPresenting,
        viewMode,
        selectedNodeIds,
        selectedEdgeIds,
        onDuplicate,
        onGroup,
        onUngroup,
        onCopyStyle,
        onPasteStyle,
    ]);

  // Presentation navigation: arrow keys / space / escape.
  useEffect(() => {
    if (!isPresenting) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'ArrowRight' || event.key === ' ') {
        event.preventDefault();
        onPresentNext();
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        onPresentPrev();
      } else if (event.key === 'Escape') {
        onExitPresenting();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isPresenting, onPresentNext, onPresentPrev, onExitPresenting]);
}
