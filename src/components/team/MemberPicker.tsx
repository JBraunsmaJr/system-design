import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { User, UserX, Check, ChevronDown } from 'lucide-react';
import type { TeamDocument } from '../../domain/timeline/teamTypes';
import { useOutsideClick } from '../../common/hooks/useOutsideClick';
import { usePositionedDropdown } from '../../common/hooks/usePositionedDropdown';

interface MemberPickerProps {
  team: TeamDocument;
  assigneeId?: string;
  onAssign: (memberId: string) => void;
  onClear: () => void;
  compact?: boolean;
}

const MENU_WIDTH = 210;

/**
 * Portals its dropdown to document.body with flip-positioning.
 */
export function MemberPicker({
  team,
  assigneeId,
  onAssign,
  onClear,
  compact = false,
}: MemberPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const assignedMember = assigneeId ? team.members.find((m) => m.id === assigneeId) : undefined;

  const { position: menuPos } = usePositionedDropdown({
    triggerRef,
    dropdownRef: menuRef,
    isOpen,
  });

  const close = () => {
    setIsOpen(false);
  };

  useOutsideClick({
    refs: [triggerRef, menuRef],
    isOpen,
    onClose: close,
  });

  const getInitials = (name: string) => {
    return name
      .trim()
      .split(/\s+/)
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  return (
    <div className="member-picker" onClick={(e) => e.stopPropagation()}>
      <button
        ref={triggerRef}
        type="button"
        className={`member-picker__trigger${compact ? ' member-picker__trigger--compact' : ''}${
          assignedMember ? ' is-assigned' : ''
        }`}
        onClick={() => setIsOpen((prev) => !prev)}
        title={assignedMember ? `Assigned to ${assignedMember.name}` : 'Assign team member'}
        aria-label={assignedMember ? `Assigned to ${assignedMember.name}` : 'Assign team member'}
      >
        {assignedMember ? (
          <>
            <span
              className="member-picker__avatar"
              style={{
                backgroundColor: assignedMember.avatarColor ?? '#5b7cfa',
              }}
            >
              {getInitials(assignedMember.name)}
            </span>
            {!compact && <span className="member-picker__name">{assignedMember.name}</span>}
          </>
        ) : (
          <>
            <User size={13} className="member-picker__icon" />
            {!compact && <span className="member-picker__placeholder">Unassigned</span>}
          </>
        )}
        <ChevronDown size={11} className="member-picker__chevron" />
      </button>

      {isOpen &&
        menuPos &&
        createPortal(
          <div
            ref={menuRef}
            className="member-picker__menu"
            role="menu"
            style={{ position: 'fixed', top: menuPos.top, left: menuPos.left, width: MENU_WIDTH }}
          >
            <div className="member-picker__menu-header">Assign Member</div>
            {team.members.length === 0 ? (
              <div className="member-picker__empty">
                No team members added yet. Go to the Team tab to add members.
              </div>
            ) : (
              <div className="member-picker__list">
                {assignedMember && (
                  <button
                    type="button"
                    className="member-picker__option member-picker__option--unassign"
                    onClick={() => {
                      onClear();
                      close();
                    }}
                    role="menuitem"
                  >
                    <UserX size={13} />
                    <span>Unassign</span>
                  </button>
                )}
                {team.members.map((member) => {
                  const isSelected = member.id === assigneeId;
                  return (
                    <button
                      key={member.id}
                      type="button"
                      className={`member-picker__option${isSelected ? ' is-selected' : ''}`}
                      onClick={() => {
                        onAssign(member.id);
                        close();
                      }}
                      role="menuitem"
                    >
                      <span
                        className="member-picker__avatar"
                        style={{
                          backgroundColor: member.avatarColor ?? '#5b7cfa',
                        }}
                      >
                        {getInitials(member.name)}
                      </span>
                      <div className="member-picker__option-info">
                        <span className="member-picker__option-name">{member.name}</span>
                        {member.role && (
                          <span className="member-picker__option-role">{member.role}</span>
                        )}
                      </div>
                      {isSelected && <Check size={13} className="member-picker__check" />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}
