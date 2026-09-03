import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { User, UserX, Check, ChevronDown } from "lucide-react";
import type { TeamDocument } from "../../domain/teamTypes";
import { computeFlippedPosition } from "../../domain/popoverPosition";

interface MemberPickerProps {
  team: TeamDocument;
  assigneeId?: string;
  onAssign: (memberId: string) => void;
  onClear: () => void;
  compact?: boolean;
}

const MENU_WIDTH = 210;

/**
 * Portals its dropdown to document.body with flip-positioning, same
 * pattern as every other picker in this app (see CategoryPicker for the
 * full reasoning). This trigger commonly sits inside a sprint board
 * column - a scrolling, overflow-clipped container - so a locally
 * position:absolute dropdown gets cut off there regardless of its own
 * z-index; z-index only resolves stacking order *within* a clipping
 * context, it can't escape one. Confirmed this was actually happening
 * (not just a z-index number too low) before rewriting: the old version
 * had z-index:300, already higher than its siblings, and was still
 * getting clipped.
 */
export function MemberPicker({ team, assigneeId, onAssign, onClear, compact = false }: MemberPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const assignedMember = assigneeId ? team.members.find((m) => m.id === assigneeId) : undefined;

  const open = () => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    setMenuPos({ top: rect.bottom + 4, left: Math.max(8, rect.right - MENU_WIDTH) });
    setIsOpen(true);
  };
  const close = () => setIsOpen(false);

  useLayoutEffect(() => {
    if (!isOpen) return;
    const trigger = triggerRef.current;
    const menu = menuRef.current;
    if (!trigger || !menu) return;
    const triggerRect = trigger.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    const next = computeFlippedPosition(
      triggerRect,
      { width: menuRect.width, height: menuRect.height },
      { width: window.innerWidth, height: window.innerHeight }
    );
    setMenuPos((prev) => (prev && prev.top === next.top && prev.left === next.left ? prev : next));
  }, [isOpen]);

  const reposition = useCallback(() => {
    const trigger = triggerRef.current;
    const menu = menuRef.current;
    if (!trigger || !menu) return;
    const triggerRect = trigger.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    setMenuPos(
      computeFlippedPosition(
        triggerRect,
        { width: menuRect.width, height: menuRect.height },
        { width: window.innerWidth, height: window.innerHeight }
      )
    );
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
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
    <div className="member-picker" onClick={(e) => e.stopPropagation()}>
      <button
        ref={triggerRef}
        type="button"
        className={`member-picker__trigger${compact ? " member-picker__trigger--compact" : ""}${
          assignedMember ? " is-assigned" : ""
        }`}
        onClick={() => (isOpen ? close() : open())}
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

      {isOpen &&
        menuPos &&
        createPortal(
          <div
            ref={menuRef}
            className="member-picker__menu"
            role="menu"
            style={{ position: "fixed", top: menuPos.top, left: menuPos.left, width: MENU_WIDTH }}
          >
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
                      className={`member-picker__option${isSelected ? " is-selected" : ""}`}
                      onClick={() => {
                        onAssign(member.id);
                        close();
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
          </div>,
          document.body
        )}
    </div>
  );
}
