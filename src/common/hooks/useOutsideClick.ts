import { useEffect, type RefObject } from 'react';

export type DomElementOrRef = RefObject<HTMLElement | null> | HTMLElement | null | undefined;

export interface UseOutsideClickOptions {
  refs: DomElementOrRef[];
  isOpen: boolean;
  onClose: () => void;
  closeOnEscape?: boolean;
}

/**
 * Standard hook to handle outside clicks and escape key presses for popovers, menus, and pickers.
 */
export function useOutsideClick({
  refs,
  isOpen,
  onClose,
  closeOnEscape = true,
}: UseOutsideClickOptions): void {
  useEffect(() => {
    if (!isOpen) return;

    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      const isInside = refs.some((r) => {
        if (!r) return false;
        const el = 'current' in r ? r.current : r;
        return el?.contains(target);
      });
      if (!isInside) {
        onClose();
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (closeOnEscape && e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleMouseDown);
    if (closeOnEscape) {
      document.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      if (closeOnEscape) {
        document.removeEventListener('keydown', handleKeyDown);
      }
    };
  }, [refs, isOpen, onClose, closeOnEscape]);
}
