import { TriangleAlert } from 'lucide-react';
import { BaseModal } from '../../common/components/modal/BaseModal';

interface LeaveGuardDialogProps {
  isOpen: boolean;
  onStay: () => void;
  onExportAndLeave: () => void;
  onLeave: () => void;
}

/**
 * WS13-R11: shown when the person leaving is the only participant holding a
 * saved copy of the session. The others are working from what is in their
 * open tabs; once this person is gone, nothing else keeps that work if those
 * tabs close. The consequence is named, and an export is offered right here.
 */
export function LeaveGuardDialog({
  isOpen,
  onStay,
  onExportAndLeave,
  onLeave,
}: LeaveGuardDialogProps) {
  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onStay}
      width={460}
      role="alertdialog"
      ariaLabel="You are the only one here with a saved copy"
      className="leave-guard"
      closeOnBackdropClick={false}
      title={
        <span
          id="leave-guard-title"
          style={{
            display: 'flex',
            gap: 8,
            alignItems: 'center',
          }}
        >
          <TriangleAlert size={18} style={{ color: 'var(--warning, #e0a84a)' }} />
          You are the only one here with a saved copy
        </span>
      }
      footer={
        <>
          <button type="button" className="leave-guard__stay" onClick={onStay} autoFocus>
            Stay in session
          </button>
          <button type="button" className="leave-guard__leave" onClick={onLeave}>
            Leave without exporting
          </button>
          <button type="button" className="primary leave-guard__export" onClick={onExportAndLeave}>
            Export a copy and leave
          </button>
        </>
      }
    >
      <p id="leave-guard-detail" style={{ fontSize: 13, lineHeight: 1.5, margin: 0 }}>
        Nobody else in this session is saving it. If you leave and the others close their tabs,
        their changes since joining are lost and the session cannot be reopened from their side.
        Your own copy stays in this browser.
      </p>
    </BaseModal>
  );
}
