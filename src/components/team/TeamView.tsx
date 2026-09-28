import { useState, useMemo, useSyncExternalStore, type FormEvent } from 'react';
import {
  Users,
  Plus,
  Trash2,
  Settings,
  ShieldCheck,
  ChevronDown,
  ChevronUp,
  CalendarRange,
} from 'lucide-react';
import type {
  TeamMember,
  PtoSpan,
  ExtraDayOff,
  HalfDayType,
} from '../../domain/timeline/teamTypes';
import type { ProgramIncrementsStore } from '../../collab/stores/programIncrementsStore';
import type { RequirementsDocument } from '../../domain/requirements/requirementsTypes';
import { isItemWorkable } from '../../domain/requirements/requirementsRegistry';
import type { TeamStore } from '../../collab/stores/teamStore';
import {
  computeSprintDateRanges,
  getSprintActiveReservations,
} from '../../domain/timeline/programIncrements';
import {
  computeSprintCapacity,
  getUsFederalHolidays,
} from '../../domain/timeline/teamCapacity';
import { ManageReservationsModal } from '../timeline/ManageReservationsModal';
import { TeamMemberList } from './components/TeamMemberList';
import { AVATAR_COLORS } from './teamUiUtils';
import { TeamPtoModal, ExtraDayOffModal } from './components/TeamPtoModal';
import { TeamCapacityOverview } from './components/TeamCapacityOverview';

interface TeamViewProps {
  teamStore: TeamStore;
  programIncrementsStore: ProgramIncrementsStore;
  requirements: RequirementsDocument;
}

function nextId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;
}

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function TeamView({ teamStore, programIncrementsStore, requirements }: TeamViewProps) {
  const team = useSyncExternalStore(teamStore.subscribe, teamStore.getSnapshot);
  const programIncrements = useSyncExternalStore(
    programIncrementsStore.subscribe,
    programIncrementsStore.getSnapshot,
  );
  const [activeTab, setActiveTab] = useState<'members' | 'settings' | 'sprints'>('members');
  const [isAddingMember, setIsAddingMember] = useState(false);
  const [newMemberName, setNewMemberName] = useState('');
  const [newMemberRole, setNewMemberRole] = useState('');
  const [newMemberColor, setNewMemberColor] = useState(AVATAR_COLORS[0]);
  const [newMemberPointsPerDay, setNewMemberPointsPerDay] = useState<string>('');
  const [managingReservationsPIId, setManagingReservationsPIId] = useState<string | null>(null);
  const managingReservationsPI =
    programIncrements.find((pi) => pi.id === managingReservationsPIId) ?? null;

  // PTO modal state
  const [ptoModalMemberId, setPtoModalMemberId] = useState<string | null>(null);
  const [ptoStartDate, setPtoStartDate] = useState(todayISO());
  const [ptoEndDate, setPtoEndDate] = useState(todayISO());
  const [ptoStartHalf, setPtoStartHalf] = useState<HalfDayType>('full');
  const [ptoEndHalf, setPtoEndHalf] = useState<HalfDayType>('full');
  const [ptoNote, setPtoNote] = useState('');

  // Extra day off modal state
  const [isAddingExtraDay, setIsAddingExtraDay] = useState(false);
  const [extraDayName, setExtraDayName] = useState('');
  const [extraDayDate, setExtraDayDate] = useState(todayISO());
  const [extraDayIsHalf, setExtraDayIsHalf] = useState(false);
  const [extraDayNote, setExtraDayNote] = useState('');

  const [showHolidaysList, setShowHolidaysList] = useState(false);

  const currentYear = new Date().getFullYear();
  const usHolidaysCurrentYear = useMemo(() => getUsFederalHolidays(currentYear), [currentYear]);

  const totalMembers = team.members.length;
  const totalDailyPoints = team.members.reduce(
    (acc, m) => acc + (m.defaultPointsPerDay ?? team.settings.defaultPointsPerDay),
    0,
  );

  const handleAddMember = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!newMemberName.trim()) return;

    const pointsOverride =
      newMemberPointsPerDay.trim() !== '' ? parseFloat(newMemberPointsPerDay) : undefined;

    const newMember: TeamMember = {
      id: nextId('member'),
      name: newMemberName.trim(),
      role: newMemberRole.trim() || undefined,
      avatarColor: newMemberColor,
      defaultPointsPerDay:
        typeof pointsOverride === 'number' && !isNaN(pointsOverride) ? pointsOverride : undefined,
      ptoSpans: [],
    };

    teamStore.addMember(newMember);

    setNewMemberName('');
    setNewMemberRole('');
    setNewMemberPointsPerDay('');
    setIsAddingMember(false);
  };

  const handleUpdateMember = (memberId: string, patch: Partial<TeamMember>) => {
    teamStore.updateMember(memberId, patch);
  };

  const handleDeleteMember = (memberId: string) => {
    teamStore.deleteMember(memberId);
  };

  const handleOpenPtoModal = (memberId: string) => {
    setPtoModalMemberId(memberId);
    setPtoStartDate(todayISO());
    setPtoEndDate(todayISO());
    setPtoStartHalf('full');
    setPtoEndHalf('full');
    setPtoNote('');
  };

  const handleAddPtoSpan = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!ptoModalMemberId) return;

    let start = ptoStartDate;
    let end = ptoEndDate;
    if (end < start) {
      [start, end] = [end, start];
    }

    const newPto: PtoSpan = {
      id: nextId('pto'),
      startDate: start,
      endDate: end,
      startHalfDay: ptoStartHalf,
      endHalfDay: start === end ? ptoStartHalf : ptoEndHalf,
      note: ptoNote.trim() || undefined,
    };

    teamStore.addPtoSpan(ptoModalMemberId, newPto);
    setPtoModalMemberId(null);
  };

  const handleDeletePtoSpan = (memberId: string, ptoId: string) => {
    teamStore.deletePtoSpan(memberId, ptoId);
  };

  const handleAddExtraDayOff = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!extraDayName.trim() || !extraDayDate) return;

    const newExtra: ExtraDayOff = {
      id: nextId('dayoff'),
      name: extraDayName.trim(),
      date: extraDayDate,
      isHalfDay: extraDayIsHalf,
      note: extraDayNote.trim() || undefined,
    };

    teamStore.addExtraDayOff(newExtra);

    setExtraDayName('');
    setExtraDayDate(todayISO());
    setExtraDayIsHalf(false);
    setExtraDayNote('');
    setIsAddingExtraDay(false);
  };

  const handleDeleteExtraDayOff = (extraId: string) => {
    teamStore.deleteExtraDayOff(extraId);
  };

  const allSprintSummaries = useMemo(() => {
    const results: Array<{
      pi: (typeof programIncrements)[0];
      summary: ReturnType<typeof computeSprintCapacity>;
    }> = [];

    for (const pi of programIncrements) {
      const ranges = computeSprintDateRanges(pi);
      const rangeMap = new Map(ranges.map((r) => [r.sprintId, r]));

      for (const sprint of pi.sprints) {
        const range = rangeMap.get(sprint.id);
        const workableItems = requirements.items.filter(
          (item) => item.sprintId === sprint.id && isItemWorkable(requirements, item),
        );
        const activeReservations = getSprintActiveReservations(pi.reservations, sprint.id);
        const summary = computeSprintCapacity(
          sprint,
          range,
          team,
          workableItems,
          activeReservations,
        );
        results.push({ pi, summary });
      }
    }
    return results;
  }, [programIncrements, requirements, team]);

  const ptoModalMember = ptoModalMemberId
    ? team.members.find((m) => m.id === ptoModalMemberId)
    : null;

  return (
    <div className="team-view">
      <div className="team-view__header">
        <div className="team-view__title-area">
          <div className="team-view__title-row">
            <Users size={22} className="team-view__title-icon" />
            <h1>Team & Capacity Planning</h1>
          </div>
          <div className="team-view__metrics-row">
            <span className="team-view__metric-chip">
              <strong>{totalMembers}</strong> Members
            </span>
            <span className="team-view__metric-chip">
              <strong>{totalDailyPoints.toFixed(1)}</strong> Daily Target Pts
            </span>
            <span className="team-view__metric-chip">
              <strong>{allSprintSummaries.length}</strong> Sprints Active
            </span>
          </div>
        </div>

        <div className="team-view__tabs">
          <button
            type="button"
            className={`team-view__tab ${activeTab === 'members' ? 'active' : ''}`}
            onClick={() => setActiveTab('members')}
          >
            <Users size={14} />
            Members ({team.members.length})
          </button>
          <button
            type="button"
            className={`team-view__tab ${activeTab === 'sprints' ? 'active' : ''}`}
            onClick={() => setActiveTab('sprints')}
          >
            <CalendarRange size={14} />
            Sprint Capacity Matrix
          </button>
          <button
            type="button"
            className={`team-view__tab ${activeTab === 'settings' ? 'active' : ''}`}
            onClick={() => setActiveTab('settings')}
          >
            <Settings size={14} />
            Schedule & Defaults
          </button>
        </div>
      </div>

      <div className="team-view__body">
        {activeTab === 'members' && (
          <TeamMemberList
            team={team}
            onUpdateMember={handleUpdateMember}
            onDeleteMember={handleDeleteMember}
            onOpenPtoModal={handleOpenPtoModal}
            onDeletePtoSpan={handleDeletePtoSpan}
            isAddingMember={isAddingMember}
            setIsAddingMember={setIsAddingMember}
            newMemberName={newMemberName}
            setNewMemberName={setNewMemberName}
            newMemberRole={newMemberRole}
            setNewMemberRole={setNewMemberRole}
            newMemberColor={newMemberColor}
            setNewMemberColor={setNewMemberColor}
            newMemberPointsPerDay={newMemberPointsPerDay}
            setNewMemberPointsPerDay={setNewMemberPointsPerDay}
            onAddMember={handleAddMember}
          />
        )}

        {activeTab === 'sprints' && (
          <TeamCapacityOverview
            team={team}
            allSprintSummaries={allSprintSummaries}
            onManageReservations={(piId) => setManagingReservationsPIId(piId)}
          />
        )}

        {activeTab === 'settings' && (
          <div className="team-settings-view">
            <div className="settings-section-card">
              <div className="settings-section-card__header">
                <div>
                  <h3>Default Team Points</h3>
                  <p>Configured points per business day for team members without a custom rate.</p>
                </div>
              </div>
              <div className="settings-section-card__body">
                <div className="settings-row">
                  <label>Default Points Per Business Day</label>
                  <div className="settings-row__input-wrap">
                    <input
                      type="number"
                      step="0.1"
                      min="0.1"
                      max="50"
                      value={team.settings.defaultPointsPerDay}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value);
                        if (!isNaN(val) && val > 0) {
                          teamStore.updateSettings({ defaultPointsPerDay: val });
                        }
                      }}
                    />
                    <span>points / day (standard: 1 per business day)</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="settings-section-card">
              <div className="settings-section-card__header">
                <div>
                  <h3>US Federal Holidays</h3>
                  <p>
                    Automatically exclude recognized US federal holidays from business days.
                  </p>
                </div>
                <label className="toggle-switch">
                  <input
                    type="checkbox"
                    checked={team.settings.excludeUsHolidays}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      teamStore.updateSettings({ excludeUsHolidays: checked });
                    }}
                  />
                  <span className="toggle-slider" />
                </label>
              </div>

              <div className="settings-section-card__body">
                <button
                  type="button"
                  className="holiday-preview-toggle"
                  onClick={() => setShowHolidaysList((prev) => !prev)}
                >
                  <ShieldCheck size={14} />
                  <span>
                    {showHolidaysList ? 'Hide' : 'View'} {usHolidaysCurrentYear.length} Recognized
                    US Federal Holidays ({currentYear})
                  </span>
                  {showHolidaysList ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                </button>

                {showHolidaysList && (
                  <div className="holidays-grid">
                    {usHolidaysCurrentYear.map((h) => (
                      <div key={h.date} className="holiday-chip">
                        <span className="holiday-chip__date">{h.date}</span>
                        <span className="holiday-chip__name">{h.name}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="settings-section-card">
              <div className="settings-section-card__header">
                <div>
                  <h3>Extra Days Off & Company Holidays</h3>
                  <p>
                    Configure company-specific days off, winter shutdowns, or floating holidays.
                  </p>
                </div>
                <button
                  type="button"
                  className="team-view__secondary-btn"
                  onClick={() => setIsAddingExtraDay(true)}
                >
                  <Plus size={13} /> Add Extra Day Off
                </button>
              </div>

              <div className="settings-section-card__body">
                {team.settings.extraDaysOff.length === 0 ? (
                  <p className="team-view__text-muted">No custom company days off defined.</p>
                ) : (
                  <div className="extra-days-list">
                    {team.settings.extraDaysOff.map((day: ExtraDayOff) => (
                      <div key={day.id} className="extra-day-item">
                        <div className="extra-day-item__info">
                          <span className="extra-day-item__name">{day.name}</span>
                          <span className="extra-day-item__date">
                            {day.date} {day.isHalfDay ? '(½ day)' : ''}
                          </span>
                          {day.note && (
                            <span className="extra-day-item__note">({day.note})</span>
                          )}
                        </div>
                        <button
                          type="button"
                          className="team-view__icon-btn team-view__icon-btn--danger"
                          onClick={() => handleDeleteExtraDayOff(day.id)}
                          title="Remove custom day off"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {ptoModalMember && (
        <TeamPtoModal
          member={ptoModalMember}
          startDate={ptoStartDate}
          setStartDate={setPtoStartDate}
          endDate={ptoEndDate}
          setEndDate={setPtoEndDate}
          startHalf={ptoStartHalf}
          setStartHalf={setPtoStartHalf}
          endHalf={ptoEndHalf}
          setEndHalf={setPtoEndHalf}
          note={ptoNote}
          setNote={setPtoNote}
          onSubmit={handleAddPtoSpan}
          onClose={() => setPtoModalMemberId(null)}
        />
      )}

      {isAddingExtraDay && (
        <ExtraDayOffModal
          name={extraDayName}
          setName={setExtraDayName}
          date={extraDayDate}
          setDate={setExtraDayDate}
          isHalf={extraDayIsHalf}
          setIsHalf={setExtraDayIsHalf}
          note={extraDayNote}
          setNote={setExtraDayNote}
          onSubmit={handleAddExtraDayOff}
          onClose={() => setIsAddingExtraDay(false)}
        />
      )}

      {managingReservationsPI && (
        <ManageReservationsModal
          pi={managingReservationsPI}
          team={team}
          requirements={requirements}
          programIncrementsStore={programIncrementsStore}
          onClose={() => setManagingReservationsPIId(null)}
        />
      )}
    </div>
  );
}
