import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Hash, X } from "lucide-react";
import { computeFlippedPosition } from "../../domain/popoverPosition";

interface PointsPickerProps {
  points?: number;
  onChange: (points: number | undefined) => void;
  compact?: boolean;
}

const COMMON_POINTS = [0.5, 1, 2, 3, 5, 8, 13, 21];
const POPOVER_WIDTH = 170;

/**
 * Same portal + flip-positioning rewrite as MemberPicker, for the same
 * reason - this trigger lives inside a sprint board column too, and the
 * old locally-positioned popover got clipped by that column's own
 * scrolling/overflow regardless of z-index.
 */
export function PointsPicker({ points, onChange, compact = false }: PointsPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [customInput, setCustomInput] = useState<string>("");
  const [popoverPos, setPopoverPos] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const open = () => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    // Set directly here (a plain click handler) rather than syncing via a
    // useEffect keyed on isOpen - this is the value at the moment the
    // popover is opened, not something that needs to stay in sync with
    // `points` for as long as it's open, so there's no actual need for
    // effect-based state syncing here at all.
    setCustomInput(points !== undefined ? String(points) : "");
    const rect = trigger.getBoundingClientRect();
    setPopoverPos({ top: rect.bottom + 4, left: Math.max(8, rect.right - POPOVER_WIDTH) });
    setIsOpen(true);
  };
  const close = () => setIsOpen(false);

  useLayoutEffect(() => {
    if (!isOpen) return;
    const trigger = triggerRef.current;
    const popover = popoverRef.current;
    if (!trigger || !popover) return;
    const triggerRect = trigger.getBoundingClientRect();
    const popoverRect = popover.getBoundingClientRect();
    const next = computeFlippedPosition(
      triggerRect,
      { width: popoverRect.width, height: popoverRect.height },
      { width: window.innerWidth, height: window.innerHeight }
    );
    setPopoverPos((prev) => (prev && prev.top === next.top && prev.left === next.left ? prev : next));
  }, [isOpen]);

  const reposition = useCallback(() => {
    const trigger = triggerRef.current;
    const popover = popoverRef.current;
    if (!trigger || !popover) return;
    const triggerRect = trigger.getBoundingClientRect();
    const popoverRect = popover.getBoundingClientRect();
    setPopoverPos(
      computeFlippedPosition(
        triggerRect,
        { width: popoverRect.width, height: popoverRect.height },
        { width: window.innerWidth, height: window.innerHeight }
      )
    );
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (popoverRef.current?.contains(target)) return;
      close();
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [isOpen, reposition]);

  const handleSelect = (val: number | undefined) => {
    onChange(val);
    close();
  };

  const handleCustomSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = parseFloat(customInput.trim());
    if (!isNaN(parsed) && parsed >= 0) {
      onChange(Math.round(parsed * 10) / 10);
    } else if (customInput.trim() === "") {
      onChange(undefined);
    }
    close();
  };

  const hasPoints = points !== undefined && !isNaN(points);

  return (
    <div className="points-picker" onClick={(e) => e.stopPropagation()}>
      <button
        ref={triggerRef}
        type="button"
        className={`points-picker__trigger${compact ? " points-picker__trigger--compact" : ""}${
          hasPoints ? " has-points" : ""
        }`}
        onClick={() => (isOpen ? close() : open())}
        title={hasPoints ? `${points} point${points === 1 ? "" : "s"}` : "Assign points"}
        aria-label={hasPoints ? `${points} points` : "Assign points"}
      >
        <Hash size={11} className="points-picker__icon" />
        <span className="points-picker__value">{hasPoints ? `${points} pt${points === 1 ? "" : "s"}` : "--"}</span>
      </button>

      {isOpen &&
        popoverPos &&
        createPortal(
          <div
            ref={popoverRef}
            className="points-picker__popover"
            role="dialog"
            style={{ position: "fixed", top: popoverPos.top, left: popoverPos.left, width: POPOVER_WIDTH }}
          >
            <div className="points-picker__header">
              <span>Story Points</span>
              {hasPoints && (
                <button
                  type="button"
                  className="points-picker__clear"
                  onClick={() => handleSelect(undefined)}
                  title="Clear points"
                >
                  <X size={12} /> Clear
                </button>
              )}
            </div>
            <div className="points-picker__presets">
              {COMMON_POINTS.map((p) => (
                <button
                  key={p}
                  type="button"
                  className={`points-picker__preset-btn${points === p ? " is-active" : ""}`}
                  onClick={() => handleSelect(p)}
                >
                  {p}
                </button>
              ))}
            </div>
            <form className="points-picker__custom" onSubmit={handleCustomSubmit}>
              <input
                type="number"
                step="0.5"
                min="0"
                max="999"
                placeholder="Custom..."
                value={customInput}
                onChange={(e) => setCustomInput(e.target.value)}
                autoFocus
              />
              <button type="submit">Set</button>
            </form>
          </div>,
          document.body
        )}
    </div>
  );
}
