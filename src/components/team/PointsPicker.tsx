import { useState, useRef, useEffect } from "react";
import { Hash, X } from "lucide-react";

interface PointsPickerProps {
  points?: number;
  onChange: (points: number | undefined) => void;
  compact?: boolean;
}

const COMMON_POINTS = [0.5, 1, 2, 3, 5, 8, 13, 21];

export function PointsPicker({ points, onChange, compact = false }: PointsPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [customInput, setCustomInput] = useState<string>("");
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    setCustomInput(points !== undefined ? String(points) : "");
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isOpen, points]);

  const handleSelect = (val: number | undefined) => {
    onChange(val);
    setIsOpen(false);
  };

  const handleCustomSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = parseFloat(customInput.trim());
    if (!isNaN(parsed) && parsed >= 0) {
      onChange(Math.round(parsed * 10) / 10);
    } else if (customInput.trim() === "") {
      onChange(undefined);
    }
    setIsOpen(false);
  };

  const hasPoints = points !== undefined && !isNaN(points);

  return (
    <div className="points-picker" ref={containerRef} onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        className={`points-picker__trigger${compact ? " points-picker__trigger--compact" : ""}${
          hasPoints ? " has-points" : ""
        }`}
        onClick={() => setIsOpen((prev) => !prev)}
        title={hasPoints ? `${points} point${points === 1 ? "" : "s"}` : "Assign points"}
        aria-label={hasPoints ? `${points} points` : "Assign points"}
      >
        <Hash size={11} className="points-picker__icon" />
        <span className="points-picker__value">{hasPoints ? `${points} pt${points === 1 ? "" : "s"}` : "--"}</span>
      </button>

      {isOpen && (
        <div className="points-picker__popover" role="dialog">
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
        </div>
      )}
    </div>
  );
}
