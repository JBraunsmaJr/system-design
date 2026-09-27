import { useCallback, useEffect, useLayoutEffect, useState, type RefObject } from 'react';
import { computeFlippedPosition } from '../utils/popoverPosition';

export interface UsePositionedDropdownOptions {
  triggerRef: RefObject<HTMLElement | null>;
  dropdownRef: RefObject<HTMLElement | null>;
  isOpen: boolean;
  offsetY?: number;
  dependencies?: unknown[];
}

/**
 * Hook to compute and track fixed portal position for a dropdown relative to its trigger,
 * handling automatic viewport flipping, scroll, and window resize.
 */
export function usePositionedDropdown({
  triggerRef,
  dropdownRef,
  isOpen,
  offsetY = 4,
}: UsePositionedDropdownOptions): {
  position: { top: number; left: number; width?: number } | null;
  updatePosition: () => void;
} {
  const [position, setPosition] = useState<{ top: number; left: number; width?: number } | null>(
    null,
  );

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const triggerRect = trigger.getBoundingClientRect();
    const dropdown = dropdownRef.current;

    if (!dropdown) {
      const estimatedLeft = Math.max(8, Math.min(triggerRect.right - 240, window.innerWidth - 248));
      setPosition({
        top: triggerRect.bottom + offsetY,
        left: estimatedLeft,
        width: triggerRect.width,
      });
      return;
    }

    const dropdownRect = dropdown.getBoundingClientRect();
    const next = computeFlippedPosition(
      triggerRect,
      { width: dropdownRect.width, height: dropdownRect.height },
      { width: window.innerWidth, height: window.innerHeight },
      offsetY,
    );
    setPosition((prev) =>
      prev && prev.top === next.top && prev.left === next.left && prev.width === triggerRect.width
        ? prev
        : { ...next, width: triggerRect.width },
    );
  }, [triggerRef, dropdownRef, offsetY]);

  useLayoutEffect(() => {
    if (isOpen) {
      updatePosition();
    }
  });

  useEffect(() => {
    if (!isOpen) return;
    window.addEventListener('scroll', updatePosition, true);
    window.addEventListener('resize', updatePosition);
    return () => {
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('resize', updatePosition);
    };
  }, [isOpen, updatePosition]);

  return { position, updatePosition };
}
