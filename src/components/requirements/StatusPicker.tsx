import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2, Circle, CircleDot, ChevronDown } from 'lucide-react';
import {
  REQUIREMENT_STATUSES,
  getStatusMeta,
} from '../../domain/requirements/requirementsRegistry';
import type { RequirementStatus } from '../../domain/requirements/requirementsTypes';
import { useOutsideClick } from '../../common/hooks/useOutsideClick';
import { usePositionedDropdown } from '../../common/hooks/usePositionedDropdown';

interface StatusPickerProps {
  status: RequirementStatus | undefined;
  onChange: (status: RequirementStatus) => void;
}

const DROPDOWN_WIDTH = 150;

function StatusIcon({ status, size }: { status: RequirementStatus; size: number }) {
  if (status === 'done') return <CheckCircle2 size={size} />;
  if (status === 'in-progress') return <CircleDot size={size} />;
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
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const meta = getStatusMeta(status);

  const { position: dropdownPos } = usePositionedDropdown({
    triggerRef,
    dropdownRef,
    isOpen,
  });

  useOutsideClick({
    refs: [triggerRef, dropdownRef],
    isOpen,
    onClose: () => setIsOpen(false),
  });

  return (
    <div className="status-picker" onClick={(e) => e.stopPropagation()}>
      <button
        ref={triggerRef}
        type="button"
        className="status-picker__trigger"
        style={{ color: meta.color, borderColor: `${meta.color}66` }}
        onClick={() => setIsOpen((prev) => !prev)}
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
            style={{
              position: 'fixed',
              top: dropdownPos.top,
              left: dropdownPos.left,
              width: DROPDOWN_WIDTH,
            }}
          >
            {REQUIREMENT_STATUSES.map((s) => (
              <button
                key={s.id}
                type="button"
                className={`status-picker__option${s.id === meta.id ? ' is-selected' : ''}`}
                style={{ color: s.color }}
                onClick={() => {
                  onChange(s.id);
                  setIsOpen(false);
                }}
              >
                <StatusIcon status={s.id} size={13} />
                {s.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}
