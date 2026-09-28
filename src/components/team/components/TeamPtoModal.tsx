import type { FormEvent } from 'react';
import { X } from 'lucide-react';
import type { HalfDayType, TeamMember } from '../../../domain/timeline/teamTypes';

export interface TeamPtoModalProps {
  member: TeamMember;
  startDate: string;
  setStartDate: (d: string) => void;
  endDate: string;
  setEndDate: (d: string) => void;
  startHalf: HalfDayType;
  setStartHalf: (h: HalfDayType) => void;
  endHalf: HalfDayType;
  setEndHalf: (h: HalfDayType) => void;
  note: string;
  setNote: (n: string) => void;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
  onClose: () => void;
}

export function TeamPtoModal({
  member,
  startDate,
  setStartDate,
  endDate,
  setEndDate,
  startHalf,
  setStartHalf,
  endHalf,
  setEndHalf,
  note,
  setNote,
  onSubmit,
  onClose,
}: TeamPtoModalProps) {
  return (
    <div className="team-view__modal-overlay" onClick={onClose}>
      <div className="team-view__modal" onClick={(e) => e.stopPropagation()}>
        <div className="team-view__modal-header">
          <h3>Record PTO for {member.name}</h3>
          <button type="button" className="team-view__icon-btn" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <form onSubmit={onSubmit} className="team-view__form">
          <div className="team-view__form-row">
            <div className="team-view__form-group">
              <label>Start Date</label>
              <input
                type="date"
                required
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div className="team-view__form-group">
              <label>Portion</label>
              <select
                value={startHalf}
                onChange={(e) => setStartHalf(e.target.value as HalfDayType)}
              >
                <option value="full">Full day</option>
                <option value="morning">Morning only (½)</option>
                <option value="afternoon">Afternoon only (½)</option>
              </select>
            </div>
          </div>

          <div className="team-view__form-row">
            <div className="team-view__form-group">
              <label>End Date</label>
              <input
                type="date"
                required
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
            <div className="team-view__form-group">
              <label>Portion</label>
              <select
                value={endHalf}
                disabled={startDate === endDate}
                onChange={(e) => setEndHalf(e.target.value as HalfDayType)}
              >
                <option value="full">Full day</option>
                <option value="morning">Morning only (½)</option>
                <option value="afternoon">Afternoon only (½)</option>
              </select>
            </div>
          </div>

          <div className="team-view__form-group">
            <label>Reason / Note (optional)</label>
            <input
              type="text"
              placeholder="e.g. Vacation, Conference"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>

          <div className="team-view__modal-actions">
            <button type="button" className="team-view__btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="team-view__btn-primary">
              Save PTO
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export interface ExtraDayOffModalProps {
  name: string;
  setName: (s: string) => void;
  date: string;
  setDate: (s: string) => void;
  isHalf: boolean;
  setIsHalf: (b: boolean) => void;
  note: string;
  setNote: (s: string) => void;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
  onClose: () => void;
}

export function ExtraDayOffModal({
  name,
  setName,
  date,
  setDate,
  isHalf,
  setIsHalf,
  note,
  setNote,
  onSubmit,
  onClose,
}: ExtraDayOffModalProps) {
  return (
    <div className="team-view__modal-overlay" onClick={onClose}>
      <div className="team-view__modal" onClick={(e) => e.stopPropagation()}>
        <div className="team-view__modal-header">
          <h3>Add Extra Day Off</h3>
          <button type="button" className="team-view__icon-btn" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <form onSubmit={onSubmit} className="team-view__form">
          <div className="team-view__form-group">
            <label>Name / Reason</label>
            <input
              type="text"
              required
              placeholder="e.g. Company Retreat, Extra Holiday"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="team-view__form-row">
            <div className="team-view__form-group">
              <label>Date</label>
              <input
                type="date"
                required
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
            <div className="team-view__form-group" style={{ justifyContent: 'center' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={isHalf}
                  onChange={(e) => setIsHalf(e.target.checked)}
                />
                Half Day
              </label>
            </div>
          </div>

          <div className="team-view__form-group">
            <label>Note (optional)</label>
            <input
              type="text"
              placeholder="Optional notes"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>

          <div className="team-view__modal-actions">
            <button type="button" className="team-view__btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="team-view__btn-primary">
              Add Day Off
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
