import { type FormEvent } from 'react';
import {
  UserPlus,
  Plus,
  Trash2,
  Palmtree,
} from 'lucide-react';
import type { TeamDocument, TeamMember } from '../../../domain/timeline/teamTypes';
import { AVATAR_COLORS, getInitials, formatPtoSpan } from '../teamUiUtils';

export interface TeamMemberListProps {
  team: TeamDocument;
  onUpdateMember: (memberId: string, patch: Partial<TeamMember>) => void;
  onDeleteMember: (memberId: string) => void;
  onOpenPtoModal: (memberId: string) => void;
  onDeletePtoSpan: (memberId: string, ptoId: string) => void;
  isAddingMember: boolean;
  setIsAddingMember: (b: boolean) => void;
  newMemberName: string;
  setNewMemberName: (s: string) => void;
  newMemberRole: string;
  setNewMemberRole: (s: string) => void;
  newMemberColor: string;
  setNewMemberColor: (s: string) => void;
  newMemberPointsPerDay: string;
  setNewMemberPointsPerDay: (s: string) => void;
  onAddMember: (e: FormEvent<HTMLFormElement>) => void;
}

export function TeamMemberList({
  team,
  onUpdateMember,
  onDeleteMember,
  onOpenPtoModal,
  onDeletePtoSpan,
  isAddingMember,
  setIsAddingMember,
  newMemberName,
  setNewMemberName,
  newMemberRole,
  setNewMemberRole,
  newMemberColor,
  setNewMemberColor,
  newMemberPointsPerDay,
  setNewMemberPointsPerDay,
  onAddMember,
}: TeamMemberListProps) {
  return (
    <div className="team-view__section">
      <div className="team-view__section-header">
        <div>
          <h2>Team Members ({team.members.length})</h2>
          <p className="team-view__section-desc">
            Manage your cross-functional team, individual velocity targets, and scheduled time off.
          </p>
        </div>
        {!isAddingMember && (
          <button
            type="button"
            className="team-view__btn-primary"
            onClick={() => setIsAddingMember(true)}
          >
            <UserPlus size={14} />
            Add Member
          </button>
        )}
      </div>

      {isAddingMember && (
        <form onSubmit={onAddMember} className="team-view__add-form">
          <div className="team-view__add-form-header">
            <h3>Add New Member</h3>
            <button
              type="button"
              className="team-view__icon-btn"
              onClick={() => setIsAddingMember(false)}
            >
              ✕
            </button>
          </div>

          <div className="team-view__form-row">
            <div className="team-view__form-group">
              <label>Name</label>
              <input
                type="text"
                required
                placeholder="e.g. Alex Smith"
                value={newMemberName}
                onChange={(e) => setNewMemberName(e.target.value)}
                autoFocus
              />
            </div>

            <div className="team-view__form-group">
              <label>Role / Title</label>
              <input
                type="text"
                placeholder="e.g. Frontend Engineer"
                value={newMemberRole}
                onChange={(e) => setNewMemberRole(e.target.value)}
              />
            </div>
          </div>

          <div className="team-view__form-row">
            <div className="team-view__form-group">
              <label>Velocity (pts / day)</label>
              <input
                type="number"
                step="0.1"
                min="0"
                placeholder={`Default (${team.settings.defaultPointsPerDay})`}
                value={newMemberPointsPerDay}
                onChange={(e) => setNewMemberPointsPerDay(e.target.value)}
              />
            </div>

            <div className="team-view__form-group">
              <label>Avatar Color</label>
              <div className="team-view__color-palette">
                {AVATAR_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    className={`team-view__color-swatch ${newMemberColor === color ? 'selected' : ''}`}
                    style={{ backgroundColor: color }}
                    onClick={() => setNewMemberColor(color)}
                  />
                ))}
              </div>
            </div>
          </div>

          <div className="team-view__form-actions">
            <button
              type="button"
              className="team-view__btn-secondary"
              onClick={() => setIsAddingMember(false)}
            >
              Cancel
            </button>
            <button type="submit" className="team-view__btn-primary">
              Save Member
            </button>
          </div>
        </form>
      )}

      {team.members.length === 0 ? (
        <div className="team-view__empty-state">
          <p>No team members added yet.</p>
          <button
            type="button"
            className="team-view__btn-secondary"
            onClick={() => setIsAddingMember(true)}
          >
            <UserPlus size={14} /> Add your first team member
          </button>
        </div>
      ) : (
        <div className="team-view__member-grid">
          {team.members.map((member) => (
            <div key={member.id} className="team-view__member-card">
              <div className="team-view__member-card-header">
                <div
                  className="team-view__avatar"
                  style={{ backgroundColor: member.avatarColor || '#5b7cfa' }}
                >
                  {getInitials(member.name)}
                </div>
                <div className="team-view__member-info">
                  <div className="team-view__member-name-row">
                    <span className="team-view__member-name">{member.name}</span>
                    <button
                      type="button"
                      className="team-view__icon-btn team-view__icon-btn--danger"
                      onClick={() => onDeleteMember(member.id)}
                      title="Remove member"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                  <input
                    type="text"
                    className="team-view__inline-input team-view__member-role"
                    placeholder="Add role..."
                    value={member.role || ''}
                    onChange={(e) => onUpdateMember(member.id, { role: e.target.value })}
                  />
                </div>
              </div>

              <div className="team-view__member-stats">
                <div className="team-view__stat">
                  <span className="team-view__stat-label">Daily Capacity</span>
                  <div className="team-view__stat-value-input">
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      className="team-view__inline-input team-view__points-input"
                      value={
                        member.defaultPointsPerDay !== undefined ? member.defaultPointsPerDay : ''
                      }
                      placeholder={String(team.settings.defaultPointsPerDay)}
                      onChange={(e) => {
                        const val = e.target.value.trim();
                        onUpdateMember(member.id, {
                          defaultPointsPerDay: val === '' ? undefined : parseFloat(val),
                        });
                      }}
                    />
                    <span className="team-view__stat-unit">pts/day</span>
                  </div>
                </div>

                <div className="team-view__stat">
                  <span className="team-view__stat-label">PTO Logged</span>
                  <span className="team-view__stat-value">
                    {member.ptoSpans.length} {member.ptoSpans.length === 1 ? 'span' : 'spans'}
                  </span>
                </div>
              </div>

              <div className="team-view__pto-section">
                <div className="team-view__pto-header">
                  <span className="team-view__pto-title">
                    <Palmtree size={12} />
                    Time Off (PTO)
                  </span>
                  <button
                    type="button"
                    className="team-view__pto-add-btn"
                    onClick={() => onOpenPtoModal(member.id)}
                  >
                    <Plus size={11} />
                    Add PTO
                  </button>
                </div>

                {member.ptoSpans.length === 0 ? (
                  <div className="team-view__pto-empty">No time off scheduled</div>
                ) : (
                  <div className="team-view__pto-list">
                    {member.ptoSpans.map((pto) => (
                      <div key={pto.id} className="team-view__pto-item">
                        <div className="team-view__pto-info">
                          <span className="team-view__pto-dates">{formatPtoSpan(pto)}</span>
                          {pto.note && <span className="team-view__pto-note">{pto.note}</span>}
                        </div>
                        <button
                          type="button"
                          className="team-view__pto-remove-btn"
                          onClick={() => onDeletePtoSpan(member.id, pto.id)}
                          title="Remove time off"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
