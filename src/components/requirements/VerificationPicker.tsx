import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, FlaskConical } from 'lucide-react';
import {
  describeVerification,
  getVerificationMethodMeta,
  getVerificationStatusMeta,
  VERIFICATION_METHODS,
  VERIFICATION_STATUSES,
} from '../../domain/requirements/verification';
import type {
  VerificationMethod,
  VerificationStatus,
} from '../../domain/requirements/requirementsTypes';
import { useOutsideClick } from '../../common/hooks/useOutsideClick';
import { usePositionedDropdown } from '../../common/hooks/usePositionedDropdown';

interface VerificationPickerProps {
  method: VerificationMethod | undefined;
  status: VerificationStatus | undefined;
  onChange: (patch: {
    verificationMethod?: VerificationMethod;
    verificationStatus?: VerificationStatus;
  }) => void;
}

const DROPDOWN_WIDTH = 190;

/**
 * How a requirement is verified and where that stands, in the card header
 * beside the type and category. One menu with two short lists - the status
 * and the method - because they are chosen together and neither is worth a
 * control of its own. Uses the `status-picker` classes so it reads as the
 * same kind of thing as a ticket's status.
 */
export function VerificationPicker({ method, status, onChange }: VerificationPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const statusMeta = getVerificationStatusMeta(status);
  const methodMeta = getVerificationMethodMeta(method);

  const { position: dropdownPos } = usePositionedDropdown({ triggerRef, dropdownRef, isOpen });
  useOutsideClick({ refs: [triggerRef, dropdownRef], isOpen, onClose: () => setIsOpen(false) });

  return (
    <div className="status-picker" onClick={(e) => e.stopPropagation()}>
      <button
        ref={triggerRef}
        type="button"
        className="status-picker__trigger"
        style={{ color: statusMeta.color, borderColor: `${statusMeta.color}66` }}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((prev) => !prev)}
        title={`Verification: ${describeVerification({ verificationMethod: method, verificationStatus: status })} - ${statusMeta.description}`}
      >
        <FlaskConical size={11} />
        <span>{statusMeta.label}</span>
        {methodMeta && <span className="status-picker__detail">{methodMeta.label}</span>}
        <ChevronDown size={10} className="status-picker__chevron" />
      </button>

      {isOpen &&
        dropdownPos &&
        createPortal(
          <div
            ref={dropdownRef}
            className="status-picker__dropdown"
            role="menu"
            style={{
              position: 'fixed',
              top: dropdownPos.top,
              left: dropdownPos.left,
              width: DROPDOWN_WIDTH,
            }}
          >
            {VERIFICATION_STATUSES.map((s) => (
              <button
                key={s.id}
                type="button"
                role="menuitemradio"
                aria-checked={s.id === statusMeta.id}
                className={`status-picker__option${s.id === statusMeta.id ? ' is-selected' : ''}`}
                style={{ color: s.color }}
                title={s.description}
                onClick={() => {
                  onChange({ verificationStatus: s.id });
                  setIsOpen(false);
                }}
              >
                <FlaskConical size={13} />
                {s.label}
              </button>
            ))}
            <div className="status-picker__heading">Checked by</div>
            {VERIFICATION_METHODS.map((m) => (
              <button
                key={m.id}
                type="button"
                role="menuitemradio"
                aria-checked={m.id === method}
                className={`status-picker__option${m.id === method ? ' is-selected' : ''}`}
                title={m.description}
                onClick={() => onChange({ verificationMethod: m.id })}
              >
                <Check
                  size={13}
                  style={{ visibility: m.id === method ? 'visible' : 'hidden' }}
                  aria-hidden
                />
                {m.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}
