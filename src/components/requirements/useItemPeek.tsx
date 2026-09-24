import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { FocusEvent, MouseEvent as ReactMouseEvent } from 'react';
import { createPortal } from 'react-dom';
import type { RequirementsDocument } from '../../domain/requirementsTypes';
import { ItemPeekContent } from './ItemPeekContent';

const PEEK_WIDTH = 320;
const SHOW_DELAY_MS = 350;
const HIDE_DELAY_MS = 150;

interface PeekState {
  itemId: string;
  anchor: DOMRect;
}

/**
 * Shows a small preview card for a related item when its chip is hovered
 * (or focused from the keyboard), so checking what "TICKET-12" is doesn't
 * mean scrolling away from where you're working. The preview stays open
 * while the pointer moves into it, and its "Go to" button does the full
 * navigation when that's what's wanted.
 *
 * Returns handlers to spread onto each trigger and the popover node to
 * render once.
 */
export function useItemPeek(doc: RequirementsDocument, onGoTo: (itemId: string) => void) {
  const [peek, setPeek] = useState<PeekState | null>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const showTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const clearTimers = () => {
    if (showTimer.current) clearTimeout(showTimer.current);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    showTimer.current = null;
    hideTimer.current = null;
  };

  useEffect(() => clearTimers, []);

  const scheduleShow = useCallback((itemId: string, target: HTMLElement) => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    if (showTimer.current) clearTimeout(showTimer.current);
    showTimer.current = setTimeout(() => {
      setPeek({ itemId, anchor: target.getBoundingClientRect() });
    }, SHOW_DELAY_MS);
  }, []);

  const scheduleHide = useCallback(() => {
    if (showTimer.current) clearTimeout(showTimer.current);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setPeek(null), HIDE_DELAY_MS);
  }, []);

  const cancelHide = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
  }, []);

  // Place below the anchor, or above it when there's more room there;
  // clamped horizontally. Measured after render so the real height is used.
  useLayoutEffect(() => {
    if (!peek) return;
    const height = popoverRef.current?.getBoundingClientRect().height ?? 160;
    const { anchor } = peek;
    const spaceBelow = window.innerHeight - anchor.bottom;
    const openAbove = spaceBelow < height + 12 && anchor.top > spaceBelow;
    const top = openAbove ? Math.max(8, anchor.top - height - 6) : anchor.bottom + 6;
    const left = Math.min(
      Math.max(8, anchor.left),
      Math.max(8, window.innerWidth - PEEK_WIDTH - 8),
    );
    setPosition((prev) => (prev && prev.top === top && prev.left === left ? prev : { top, left }));
  }, [peek]);

  // A peek is a transient glance: any scroll or Escape dismisses it.
  useEffect(() => {
    if (!peek) return;
    const dismiss = () => setPeek(null);
    // Scrolling the page moves the anchor out from under the peek, but
    // scrolling inside the peek itself (a long body, a wide table) is just
    // reading it.
    const onScroll = (e: Event) => {
      if (e.target instanceof Node && popoverRef.current?.contains(e.target)) return;
      dismiss();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismiss();
    };
    window.addEventListener('scroll', onScroll, true);
    document.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [peek]);

  const peekHandlers = (itemId: string) => ({
    onMouseEnter: (e: ReactMouseEvent<HTMLElement>) => scheduleShow(itemId, e.currentTarget),
    onMouseLeave: scheduleHide,
    onFocus: (e: FocusEvent<HTMLElement>) => {
      if (e.currentTarget.matches(':focus-visible')) scheduleShow(itemId, e.currentTarget);
    },
    onBlur: scheduleHide,
    // Clicking navigates; a peek left open over the destination would
    // just be in the way.
    onClickCapture: () => {
      clearTimers();
      setPeek(null);
    },
  });

  const item = peek ? doc.items.find((i) => i.id === peek.itemId) : undefined;
  const peekNode =
    peek && item
      ? createPortal(
          <div
            ref={popoverRef}
            className="item-peek"
            role="tooltip"
            style={{
              position: 'fixed',
              top: position?.top ?? -9999,
              left: position?.left ?? -9999,
              width: PEEK_WIDTH,
            }}
            onMouseEnter={cancelHide}
            onMouseLeave={scheduleHide}
            // Portaled, but React still bubbles its events through the card
            // it came from - keep a double-click here from opening that
            // card's body editor.
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
          >
            <ItemPeekContent
              doc={doc}
              itemId={item.id}
              onGoTo={() => {
                setPeek(null);
                onGoTo(item.id);
              }}
            />
          </div>,
          document.body,
        )
      : null;

  return { peekHandlers, peekNode };
}
