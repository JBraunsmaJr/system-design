import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Hash, X } from 'lucide-react';
import { useOutsideClick } from '../../common/hooks/useOutsideClick';
import { usePositionedDropdown } from '../../common/hooks/usePositionedDropdown';

interface PointsPickerProps {
  points?: number;
  onChange: (points: number | undefined) => void;
  compact?: boolean;
}

const COMMON_POINTS = [0.5, 1, 2, 3, 5, 8, 13, 21];
const POPOVER_WIDTH = 170;

/**
 * Portals its popover to document.body with flip-positioning.
 */
export function PointsPicker({ points, onChange, compact = false }: PointsPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [customInput, setCustomInput] = useState<string>('');
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const open = () => {
    setCustomInput(points !== undefined ? String(points) : '');
    setIsOpen(true);
  };
  const close = () => setIsOpen(false);

  const { position: popoverPos } = usePositionedDropdown({
    triggerRef,
    dropdownRef: popoverRef,
    isOpen,
  });

  useOutsideClick({
    refs: [triggerRef, popoverRef],
    isOpen,
    onClose: close,
  });

  const handleSelect = (val: number | undefined) => {
    onChange(val);
    close();
  };

  const handleCustomSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = parseFloat(customInput.trim());
    if (!isNaN(parsed) && parsed >= 0) {
      onChange(Math.round(parsed * 10) / 10);
    } else if (customInput.trim() === '') {
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
        className={`points-picker__trigger${compact ? ' points-picker__trigger--compact' : ''}${
          hasPoints ? ' has-points' : ''
        }`}
        onClick={() => (isOpen ? close() : open())}
        title={hasPoints ? `${points} point${points === 1 ? '' : 's'}` : 'Assign points'}
        aria-label={hasPoints ? `${points} points` : 'Assign points'}
      >
        <Hash size={11} className="points-picker__icon" />
        <span className="points-picker__value">
          {hasPoints ? `${points} pt${points === 1 ? '' : 's'}` : '--'}
        </span>
      </button>

      {isOpen &&
        createPortal(
          <div
            ref={popoverRef}
            className="points-picker__popover"
            role="dialog"
            style={{
              position: 'fixed',
              top: popoverPos?.top ?? 0,
              left: popoverPos?.left ?? 0,
              width: POPOVER_WIDTH,
            }}
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
                  className={`points-picker__preset-btn${points === p ? ' is-active' : ''}`}
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
          document.body,
        )}
    </div>
  );
}
