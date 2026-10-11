import {useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import {ChevronDown, Scale} from 'lucide-react';
import {DECISION_STATUSES, getDecisionStatusMeta,} from '../../domain/requirements/decisionRecords';
import type {DecisionStatus} from '../../domain/requirements/requirementsTypes';
import {useOutsideClick} from '../../common/hooks/useOutsideClick';
import {usePositionedDropdown} from '../../common/hooks/usePositionedDropdown';

interface DecisionStatusPickerProps {
  status: DecisionStatus | undefined;
  onChange: (status: DecisionStatus) => void;
}

const DROPDOWN_WIDTH = 170;

/**
 * StatusPicker's counterpart for a decision's lifecycle. Same portal and
 * positioning, and deliberately the same `status-picker` classes, so a
 * decision's status sits in the card header looking exactly like a
 * ticket's does - one visual language for "where is this item at".
 */
export function DecisionStatusPicker({status, onChange}: DecisionStatusPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const meta = getDecisionStatusMeta(status);

    const {position: dropdownPos} = usePositionedDropdown({
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
              style={{color: meta.color, borderColor: `${meta.color}66`}}
              onClick={() => setIsOpen((prev) => !prev)}
              title={`Decision status: ${meta.label} - ${meta.description}`}
          >
              <Scale size={11}/>
              <span>{meta.label}</span>
              <ChevronDown size={10} className="status-picker__chevron"/>
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
                      {DECISION_STATUSES.map((s) => (
                          <button
                              key={s.id}
                              type="button"
                              className={`status-picker__option${s.id === meta.id ? ' is-selected' : ''}`}
                              style={{color: s.color}}
                              title={s.description}
                              onClick={() => {
                                  onChange(s.id);
                                  setIsOpen(false);
                              }}
                          >
                              <Scale size={13}/>
                              {s.label}
                          </button>
                      ))}
                  </div>,
                  document.body,
              )}
      </div>
  );
}
