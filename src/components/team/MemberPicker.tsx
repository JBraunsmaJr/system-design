import { useState, useRef, useEffect } from "react";
import { User, UserX, Check, ChevronDown } from "lucide-react";
import type { TeamDocument } from "../../domain/teamTypes";

interface MemberPickerProps {
  team: TeamDocument;
  assigneeId?: string;
  onAssign: (memberId: string) => void;
  onClear: () => void;
  compact?: boolean;
}

export function MemberPicker({ team, assigneeId, onAssign, onClear, compact = false }: MemberPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const assignedMember = assigneeId ? team.members.find((m) => m.id === assigneeId) : undefined;

  useEffect(() => {
    if (!isOpen) return;
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
  }, [isOpen]);

  const getInitials = (name: string) => {
    return name
      .trim()
      .split(/\s+/)
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  return (
    <div className="member-picker" ref={containerRef} onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        className={`member-picker__trigger${compact ? " member-picker__trigger--compact" : ""}${
          assignedMember ? " is-assigned" : ""
        }`}
        onClick={() => setIsOpen((prev) => !prev)}
        title={assignedMember ? `Assigned to ${assignedMember.name}` : "Assign team member"}
        aria-label={assignedMember ? `Assigned to ${assignedMember.name}` : "Assign team member"}
      >
        {assignedMember ? (
          <>
            <span
              className="member-picker__avatar"
              style={{
                backgroundColor: assignedMember.avatarColor ?? "#5b7cfa",
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

      {isOpen && (
        <div className="member-picker__menu" role="menu">
          <div className="member-picker__menu-header">Assign Member</div>
          {team.members.length === 0 ? (
            <div className="member-picker__empty">No team members added yet. Go to the Team tab to add members.</div>
          ) : (
            <div className="member-picker__list">
              {assignedMember && (
                <button
                  type="button"
                  className="member-picker__option member-picker__option--unassign"
                  onClick={() => {
                    onClear();
                    setIsOpen(false);
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
                    className={`member-picker__option${isSelected ? " is-selected" : ""}`}
                    onClick={() => {
                      onAssign(member.id);
                      setIsOpen(false);
                    }}
                    role="menuitem"
                  >
                    <span
                      className="member-picker__avatar"
                      style={{
                        backgroundColor: member.avatarColor ?? "#5b7cfa",
                      }}
                    >
                      {getInitials(member.name)}
                    </span>
                    <div className="member-picker__option-info">
                      <span className="member-picker__option-name">{member.name}</span>
                      {member.role && <span className="member-picker__option-role">{member.role}</span>}
                    </div>
                    {isSelected && <Check size={13} className="member-picker__check" />}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
