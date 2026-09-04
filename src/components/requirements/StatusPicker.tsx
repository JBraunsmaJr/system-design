import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CheckCircle2, Circle, CircleDot, ChevronDown } from "lucide-react";
import { REQUIREMENT_STATUSES, getStatusMeta } from "../../domain/requirementsRegistry";
import { computeFlippedPosition } from "../../domain/popoverPosition";
import type { RequirementStatus } from "../../domain/requirementsTypes";

interface StatusPickerProps {
  status: RequirementStatus | undefined;
  onChange: (status: RequirementStatus) => void;
}

const DROPDOWN_WIDTH = 150;

function StatusIcon({ status, size }: { status: RequirementStatus; size: number }) {
  if (status === "done") return <CheckCircle2 size={size} />;
  if (status === "in-progress") return <CircleDot size={size} />;
  return <Circle size={size} />;
}

/**
 * Same portal + flip-positioning approach as every other picker in this
 * app (see CategoryPicker for the full reasoning) - simpler than most of
 * them since status is a fixed three-value set, not a searchable or
 * user-extensible list, so there's no search input or "create new"
 * affordance here. A missing status (item.status undefined, which every
 * workable item created before this field existed will have) displays
 * and behaves identically to "todo" - see defaultStatusForType's doc
 * comment for why that's a display-time fallback rather than a stored
 * default.
 */
export function StatusPicker({ status, onChange }: StatusPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const meta = getStatusMeta(status);

  const open = () => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    setDropdownPos({ top: rect.bottom + 4, left: rect.left });
    setIsOpen(true);
  };
  const close = () => setIsOpen(false);

  useLayoutEffect(() => {
    if (!isOpen) return;
    const trigger = triggerRef.current;
    const dropdown = dropdownRef.current;
    if (!trigger || !dropdown) return;
    const triggerRect = trigger.getBoundingClientRect();
    const dropdownRect = dropdown.getBoundingClientRect();
    const next = computeFlippedPosition(
      triggerRect,
      { width: dropdownRect.width, height: dropdownRect.height },
      { width: window.innerWidth, height: window.innerHeight }
    );
    setDropdownPos((prev) => (prev && prev.top === next.top && prev.left === next.left ? prev : next));
  }, [isOpen]);

  const reposition = useCallback(() => {
    const trigger = triggerRef.current;
    const dropdown = dropdownRef.current;
    if (!trigger || !dropdown) return;
    const triggerRect = trigger.getBoundingClientRect();
    const dropdownRect = dropdown.getBoundingClientRect();
    setDropdownPos(
      computeFlippedPosition(
        triggerRect,
        { width: dropdownRect.width, height: dropdownRect.height },
        { width: window.innerWidth, height: window.innerHeight }
      )
    );
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (dropdownRef.current?.contains(target)) return;
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

  return (
    <div className="status-picker" onClick={(e) => e.stopPropagation()}>
      <button
        ref={triggerRef}
        type="button"
        className="status-picker__trigger"
        style={{ color: meta.color, borderColor: `${meta.color}66` }}
        onClick={() => (isOpen ? close() : open())}
        title={`Status: ${meta.label}`}
      >
        <StatusIcon status={meta.id} size={11} />
        <span>{meta.label}</span>
        <ChevronDown size={10} className="status-picker__chevron" />
      </button>

      {isOpen &&
        dropdownPos &&
        createPortal(
          <div
            ref={dropdownRef}
            className="status-picker__dropdown"
            style={{ position: "fixed", top: dropdownPos.top, left: dropdownPos.left, width: DROPDOWN_WIDTH }}
          >
            {REQUIREMENT_STATUSES.map((s) => (
              <button
                key={s.id}
                type="button"
                className={`status-picker__option${s.id === meta.id ? " is-selected" : ""}`}
                style={{ color: s.color }}
                onClick={() => {
                  onChange(s.id);
                  close();
                }}
              >
                <StatusIcon status={s.id} size={13} />
                {s.label}
              </button>
            ))}
          </div>,
          document.body
        )}
    </div>
  );
}
