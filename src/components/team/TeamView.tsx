import { useState, useMemo, useSyncExternalStore } from "react";
import {
  Users,
  UserPlus,
  Plus,
  Trash2,
  X,
  Palmtree,
  Settings,
  ShieldCheck,
  ShieldAlert,
  ChevronDown,
  ChevronUp,
  CalendarRange,
} from "lucide-react";
import type {
  TeamMember,
  PtoSpan,
  ExtraDayOff,
  HalfDayType,
} from "../../domain/teamTypes";
import type { ProgramIncrement } from "../../domain/programIncrements";
import type { RequirementsDocument } from "../../domain/requirementsTypes";
import { isItemWorkable } from "../../domain/requirementsRegistry";
import type { TeamStore } from "../../collab/teamStore";
import { computeSprintDateRanges, getSprintActiveReservations } from "../../domain/programIncrements";
import {
  computeSprintCapacity,
  calculateTotalPtoDays,
  getUsFederalHolidays,
} from "../../domain/teamCapacity";
import { ManageReservationsModal } from "../timeline/ManageReservationsModal";

interface TeamViewProps {
  teamStore: TeamStore;
  programIncrements: ProgramIncrement[];
  onUpdateProgramIncrements?: (updater: (prev: ProgramIncrement[]) => ProgramIncrement[]) => void;
  requirements: RequirementsDocument;
}

const AVATAR_COLORS = [
  "#5b7cfa",
  "#9061f9",
  "#0fa36b",
  "#f0578c",
  "#f59e0b",
  "#06b6d4",
  "#ec4899",
  "#8b5cf6",
  "#10b981",
  "#6366f1",
];

function nextId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;
}

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function TeamView({ teamStore, programIncrements, onUpdateProgramIncrements, requirements }: TeamViewProps) {
  const team = useSyncExternalStore(teamStore.subscribe, teamStore.getSnapshot);
  const [activeTab, setActiveTab] = useState<"members" | "settings" | "sprints">("members");
  const [isAddingMember, setIsAddingMember] = useState(false);
  const [newMemberName, setNewMemberName] = useState("");
  const [newMemberRole, setNewMemberRole] = useState("");
  const [newMemberColor, setNewMemberColor] = useState(AVATAR_COLORS[0]);
  const [newMemberPointsPerDay, setNewMemberPointsPerDay] = useState<string>("");
  const [managingReservationsPI, setManagingReservationsPI] = useState<ProgramIncrement | null>(null);

  // PTO modal state
  const [ptoModalMemberId, setPtoModalMemberId] = useState<string | null>(null);
  const [ptoStartDate, setPtoStartDate] = useState(todayISO());
  const [ptoEndDate, setPtoEndDate] = useState(todayISO());
  const [ptoStartHalf, setPtoStartHalf] = useState<HalfDayType>("full");
  const [ptoEndHalf, setPtoEndHalf] = useState<HalfDayType>("full");
  const [ptoNote, setPtoNote] = useState("");

  // Extra day off modal state
  const [isAddingExtraDay, setIsAddingExtraDay] = useState(false);
  const [extraDayName, setExtraDayName] = useState("");
  const [extraDayDate, setExtraDayDate] = useState(todayISO());
  const [extraDayIsHalf, setExtraDayIsHalf] = useState(false);
  const [extraDayNote, setExtraDayNote] = useState("");

  const [showHolidaysList, setShowHolidaysList] = useState(false);

  // Computed federal holidays preview for current year
  const currentYear = new Date().getFullYear();
  const usHolidaysCurrentYear = useMemo(() => getUsFederalHolidays(currentYear), [currentYear]);

  // Team summary metrics
  const totalMembers = team.members.length;
  const totalDailyPoints = team.members.reduce(
    (acc, m) => acc + (m.defaultPointsPerDay ?? team.settings.defaultPointsPerDay),
    0
  );

  const handleAddMember = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMemberName.trim()) return;

    const pointsOverride =
      newMemberPointsPerDay.trim() !== "" ? parseFloat(newMemberPointsPerDay) : undefined;

    const newMember: TeamMember = {
      id: nextId("member"),
      name: newMemberName.trim(),
      role: newMemberRole.trim() || undefined,
      avatarColor: newMemberColor,
      defaultPointsPerDay:
        typeof pointsOverride === "number" && !isNaN(pointsOverride) ? pointsOverride : undefined,
      ptoSpans: [],
    };

    teamStore.addMember(newMember);

    setNewMemberName("");
    setNewMemberRole("");
    setNewMemberPointsPerDay("");
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
    setPtoStartHalf("full");
    setPtoEndHalf("full");
    setPtoNote("");
  };

  const handleAddPtoSpan = (e: React.FormEvent) => {
    e.preventDefault();
    if (!ptoModalMemberId) return;

    let start = ptoStartDate;
    let end = ptoEndDate;
    if (end < start) {
      // swap if inverted
      [start, end] = [end, start];
    }

    const newPto: PtoSpan = {
      id: nextId("pto"),
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

  const handleAddExtraDayOff = (e: React.FormEvent) => {
    e.preventDefault();
    if (!extraDayName.trim() || !extraDayDate) return;

    const newExtra: ExtraDayOff = {
      id: nextId("dayoff"),
      name: extraDayName.trim(),
      date: extraDayDate,
      isHalfDay: extraDayIsHalf,
      note: extraDayNote.trim() || undefined,
    };

    teamStore.addExtraDayOff(newExtra);

    setExtraDayName("");
    setExtraDayDate(todayISO());
    setExtraDayIsHalf(false);
    setExtraDayNote("");
    setIsAddingExtraDay(false);
  };

  const handleDeleteExtraDayOff = (extraId: string) => {
    teamStore.deleteExtraDayOff(extraId);
  };

  const getInitials = (name: string) => {
    return name
      .trim()
      .split(/\s+/)
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  // Compute all sprints summaries for the sprint capacity table
  const allSprintSummaries = useMemo(() => {
    const list: { pi: ProgramIncrement; summary: ReturnType<typeof computeSprintCapacity> }[] = [];
    for (const pi of programIncrements) {
      const ranges = computeSprintDateRanges(pi);
      const rangeMap = new Map(ranges.map((r) => [r.sprintId, r]));
      for (const sprint of pi.sprints) {
        const range = rangeMap.get(sprint.id);
        const sprintReservations = getSprintActiveReservations(pi.reservations, sprint.id);
        const summary = computeSprintCapacity(
          sprint,
          range,
          team,
          requirements.items.filter((i) => isItemWorkable(requirements, i)),
          sprintReservations
        );
        list.push({ pi, summary });
      }
    }
    return list;
  }, [programIncrements, team, requirements]);

  return (
    <div className="team-view">
      {/* Top Banner & Header */}
      <div className="team-view__header">
        <div className="team-view__title-group">
          <div className="team-view__icon-box">
            <Users size={20} />
          </div>
          <div>
            <h1 className="team-view__title">Team & Capacity Management</h1>
            <p className="team-view__subtitle">
              Configure team members, granular 1/2-day PTO spans, US holidays, and track sprint capacity.
            </p>
          </div>
        </div>

        <div className="team-view__header-actions">
          <button
            type="button"
            className="team-view__primary-btn"
            onClick={() => {
              setIsAddingMember(true);
              setActiveTab("members");
            }}
          >
            <UserPlus size={14} />
            <span>Add Member</span>
          </button>
        </div>
      </div>

      {/* Metrics Bar */}
      <div className="team-view__metrics-row">
        <div className="team-metric-card">
          <div className="team-metric-card__label">Team Size</div>
          <div className="team-metric-card__value">{totalMembers}</div>
          <div className="team-metric-card__hint">Active members</div>
        </div>
        <div className="team-metric-card">
          <div className="team-metric-card__label">Default Rate</div>
          <div className="team-metric-card__value">{team.settings.defaultPointsPerDay} pt/day</div>
          <div className="team-metric-card__hint">1 per business day</div>
        </div>
        <div className="team-metric-card">
          <div className="team-metric-card__label">Daily Team Capacity</div>
          <div className="team-metric-card__value">{totalDailyPoints} pts/day</div>
          <div className="team-metric-card__hint">Combined velocity baseline</div>
        </div>
        <div className="team-metric-card">
          <div className="team-metric-card__label">US Holidays & Days Off</div>
          <div className="team-metric-card__value">
            {team.settings.excludeUsHolidays ? "Excluded" : "Included"}
          </div>
          <div className="team-metric-card__hint">
            {team.settings.extraDaysOff.length} extra configured
          </div>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="team-view__tabs">
        <button
          type="button"
          className={`team-view__tab${activeTab === "members" ? " is-active" : ""}`}
          onClick={() => setActiveTab("members")}
        >
          <Users size={14} />
          <span>Team Members & PTO ({team.members.length})</span>
        </button>
        <button
          type="button"
          className={`team-view__tab${activeTab === "sprints" ? " is-active" : ""}`}
          onClick={() => setActiveTab("sprints")}
        >
          <CalendarRange size={14} />
          <span>Sprint Capacity Matrix ({allSprintSummaries.length} sprints)</span>
        </button>
        <button
          type="button"
          className={`team-view__tab${activeTab === "settings" ? " is-active" : ""}`}
          onClick={() => setActiveTab("settings")}
        >
          <Settings size={14} />
          <span>Holidays & Point Settings</span>
        </button>
      </div>

      {/* Tab Content */}
      <div className="team-view__content">
        {/* MEMBERS TAB */}
        {activeTab === "members" && (
          <div className="team-members-view">
            {isAddingMember && (
              <form className="member-form-card" onSubmit={handleAddMember}>
                <div className="member-form-card__header">
                  <h3>Add Team Member</h3>
                  <button
                    type="button"
                    className="member-form-card__close"
                    onClick={() => setIsAddingMember(false)}
                  >
                    <X size={15} />
                  </button>
                </div>

                <div className="member-form-card__grid">
                  <div className="member-form-field">
                    <label>Member Name *</label>
                    <input
                      type="text"
                      placeholder="e.g. Alex Smith"
                      value={newMemberName}
                      onChange={(e) => setNewMemberName(e.target.value)}
                      required
                      autoFocus
                    />
                  </div>

                  <div className="member-form-field">
                    <label>Role / Title</label>
                    <input
                      type="text"
                      placeholder="e.g. Senior Frontend Engineer"
                      value={newMemberRole}
                      onChange={(e) => setNewMemberRole(e.target.value)}
                    />
                  </div>

                  <div className="member-form-field">
                    <label>Points Per Business Day (leave empty for team default: {team.settings.defaultPointsPerDay})</label>
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      max="100"
                      placeholder={`${team.settings.defaultPointsPerDay} pt/day`}
                      value={newMemberPointsPerDay}
                      onChange={(e) => setNewMemberPointsPerDay(e.target.value)}
                    />
                  </div>

                  <div className="member-form-field">
                    <label>Avatar Color</label>
                    <div className="color-palette-picker">
                      {AVATAR_COLORS.map((c) => (
                        <button
                          key={c}
                          type="button"
                          className={`color-palette-picker__swatch${newMemberColor === c ? " is-selected" : ""}`}
                          style={{ backgroundColor: c }}
                          onClick={() => setNewMemberColor(c)}
                        />
                      ))}
                    </div>
                  </div>
                </div>

                <div className="member-form-card__actions">
                  <button type="button" onClick={() => setIsAddingMember(false)}>
                    Cancel
                  </button>
                  <button type="submit" className="team-view__primary-btn">
                    Save Member
                  </button>
                </div>
              </form>
            )}

            {team.members.length === 0 && !isAddingMember ? (
              <div className="team-view__empty-state">
                <Users size={36} className="team-view__empty-icon" />
                <h3>No Team Members Added</h3>
                <p>Add team members to calculate sprint capacity, assign items, and track PTO.</p>
                <button
                  type="button"
                  className="team-view__primary-btn"
                  onClick={() => setIsAddingMember(true)}
                >
                  <UserPlus size={14} /> Add First Member
                </button>
              </div>
            ) : (
              <div className="team-members-grid">
                {team.members.map((member) => {
                  const totalPto = calculateTotalPtoDays(member);

                  return (
                    <div key={member.id} className="team-member-card">
                      <div className="team-member-card__header">
                        <div className="team-member-card__identity">
                          <span
                            className="team-member-card__avatar"
                            style={{ backgroundColor: member.avatarColor ?? "#5b7cfa" }}
                          >
                            {getInitials(member.name)}
                          </span>
                          <div>
                            <input
                              className="team-member-card__name-input"
                              value={member.name}
                              onChange={(e) => handleUpdateMember(member.id, { name: e.target.value })}
                            />
                            <input
                              className="team-member-card__role-input"
                              placeholder="Add role..."
                              value={member.role ?? ""}
                              onChange={(e) =>
                                handleUpdateMember(member.id, { role: e.target.value || undefined })
                              }
                            />
                          </div>
                        </div>

                        <button
                          type="button"
                          className="team-member-card__delete-btn"
                          onClick={() => handleDeleteMember(member.id)}
                          title={`Remove ${member.name}`}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>

                      {/* Points / Rate Settings */}
                      <div className="team-member-card__rate-row">
                        <span className="team-member-card__rate-label">Capacity Rate:</span>
                        <div className="team-member-card__rate-control">
                          <input
                            type="number"
                            step="0.1"
                            min="0"
                            max="50"
                            className="team-member-card__rate-input"
                            value={member.defaultPointsPerDay ?? ""}
                            placeholder={`${team.settings.defaultPointsPerDay}`}
                            onChange={(e) => {
                              const val = e.target.value.trim();
                              handleUpdateMember(member.id, {
                                defaultPointsPerDay: val !== "" ? parseFloat(val) : undefined,
                              });
                            }}
                          />
                          <span className="team-member-card__rate-unit">pts/day</span>
                        </div>
                        <span className="team-member-card__pto-total-badge" title="Total PTO days across all spans">
                          <Palmtree size={12} /> {totalPto}d PTO
                        </span>
                      </div>

                      {/* PTO Spans List */}
                      <div className="team-member-card__pto-section">
                        <div className="team-member-card__pto-header">
                          <span className="team-member-card__pto-title">
                            <Palmtree size={13} />
                            <span>PTO Spans ({member.ptoSpans.length})</span>
                          </span>
                          <button
                            type="button"
                            className="team-member-card__add-pto-btn"
                            onClick={() => handleOpenPtoModal(member.id)}
                          >
                            <Plus size={12} /> Add PTO
                          </button>
                        </div>

                        {member.ptoSpans.length === 0 ? (
                          <div className="team-member-card__pto-empty">No PTO scheduled</div>
                        ) : (
                          <div className="team-member-card__pto-list">
                            {member.ptoSpans.map((span) => {
                              const isSingle = span.startDate === span.endDate;
                              const isHalf =
                                isSingle && (span.startHalfDay === "morning" || span.startHalfDay === "afternoon");

                              return (
                                <div key={span.id} className="pto-span-chip">
                                  <div className="pto-span-chip__info">
                                    <div className="pto-span-chip__dates">
                                      {isSingle ? (
                                        <span>{span.startDate}</span>
                                      ) : (
                                        <span>
                                          {span.startDate} → {span.endDate}
                                        </span>
                                      )}
                                      <span
                                        className={`pto-span-chip__badge${
                                          isHalf || span.startHalfDay !== "full" || span.endHalfDay !== "full"
                                            ? " is-half"
                                            : ""
                                        }`}
                                      >
                                        {isSingle
                                          ? span.startHalfDay === "morning"
                                            ? "AM (0.5d)"
                                            : span.startHalfDay === "afternoon"
                                            ? "PM (0.5d)"
                                            : "Full Day (1d)"
                                          : `${
                                              span.startHalfDay === "afternoon" ? "Start PM • " : ""
                                            }${span.endHalfDay === "morning" ? "End AM" : "Full"}`}
                                      </span>
                                    </div>
                                    {span.note && (
                                      <div className="pto-span-chip__note" title={span.note}>
                                        {span.note}
                                      </div>
                                    )}
                                  </div>
                                  <button
                                    type="button"
                                    className="pto-span-chip__remove"
                                    onClick={() => handleDeletePtoSpan(member.id, span.id)}
                                    title="Delete PTO span"
                                  >
                                    <Trash2 size={11} />
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* SPRINT CAPACITY MATRIX TAB */}
        {activeTab === "sprints" && (
          <div className="sprint-matrix-view">
            {allSprintSummaries.length === 0 ? (
              <div className="team-view__empty-state">
                <CalendarRange size={36} className="team-view__empty-icon" />
                <h3>No Sprints Defined Yet</h3>
                <p>Create Program Increments and Sprints in the Timeline view to see full capacity planning.</p>
              </div>
            ) : (
              <div className="sprint-matrix-table-wrap">
                <table className="sprint-matrix-table">
                  <thead>
                    <tr>
                      <th>Sprint & Timeline</th>
                      <th>Business Days</th>
                      <th>Gross Capacity</th>
                      <th>Reserved</th>
                      <th>Net Available</th>
                      <th>Assigned Points</th>
                      <th>Remaining</th>
                      <th>Utilization</th>
                      {team.members.map((m) => (
                        <th key={m.id} className="sprint-matrix-table__member-col">
                          <div className="sprint-matrix-table__member-header">
                            <span
                              className="sprint-matrix-table__avatar"
                              style={{ backgroundColor: m.avatarColor ?? "#5b7cfa" }}
                            >
                              {getInitials(m.name)}
                            </span>
                            <span>{m.name}</span>
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {allSprintSummaries.map(({ pi, summary }) => {
                      const percent =
                        summary.totalCapacityPoints > 0
                          ? Math.round((summary.totalAssignedPoints / summary.totalCapacityPoints) * 100)
                          : 0;
                      const isOver = summary.totalAssignedPoints > summary.totalCapacityPoints && summary.totalCapacityPoints > 0;

                      return (
                        <tr key={summary.sprintId}>
                          <td>
                            <div className="sprint-matrix-cell__sprint-info">
                              <div className="sprint-matrix-cell__pi-row">
                                <span className="sprint-matrix-cell__pi-badge">{pi.name}</span>
                                {onUpdateProgramIncrements && (
                                  <button
                                    type="button"
                                    className="sprint-matrix-cell__manage-res-btn"
                                    onClick={() => setManagingReservationsPI(pi)}
                                    title={`Manage Capacity Reservations for ${pi.name}`}
                                  >
                                    <ShieldAlert size={10} />
                                    <span>{pi.reservations?.length ? `${pi.reservations.length} res` : "Reserve"}</span>
                                  </button>
                                )}
                              </div>
                              <strong className="sprint-matrix-cell__sprint-name">{summary.sprintName}</strong>
                              <span className="sprint-matrix-cell__dates">
                                {summary.startDate} → {summary.endDate}
                              </span>
                            </div>
                          </td>
                          <td>
                            <strong>{summary.sprintBusinessDays}</strong> b-days
                          </td>
                          <td>
                            <strong>{summary.grossCapacityPoints}</strong> pts
                          </td>
                          <td>
                            {summary.totalReservedPoints > 0 ? (
                              <div
                                className="sprint-matrix-cell__reserved-box"
                                title={summary.appliedReservations
                                  .map((r) => `${r.name}: ${r.value}${r.unit === "percentage" ? "%" : " pts"}`)
                                  .join(", ")}
                              >
                                <span className="sprint-matrix-cell__reserved-pill">
                                  <ShieldAlert size={10} /> -{summary.totalReservedPoints} pts
                                </span>
                                <span className="sprint-matrix-cell__reserved-count">
                                  {summary.appliedReservations.length} active
                                </span>
                              </div>
                            ) : (
                              <span className="sprint-matrix-cell__dim-dash">—</span>
                            )}
                          </td>
                          <td>
                            <strong>{summary.totalCapacityPoints}</strong> pts
                          </td>
                          <td>
                            <strong>{summary.totalAssignedPoints}</strong> pts
                            {summary.unassignedPoints > 0 && (
                              <span className="sprint-matrix-cell__unassigned">
                                ({summary.unassignedPoints} unassigned)
                              </span>
                            )}
                          </td>
                          <td>
                            <span
                              className={`sprint-matrix-cell__available-badge${
                                isOver
                                  ? " is-over"
                                  : summary.remainingCapacityPoints === 0
                                  ? " is-zero"
                                  : " is-available"
                              }`}
                            >
                              {isOver
                                ? `${Math.abs(summary.remainingCapacityPoints)} pts over`
                                : `${summary.remainingCapacityPoints} pts`}
                            </span>
                          </td>
                          <td>
                            <div className="sprint-matrix-cell__progress-wrap">
                              <div className="sprint-matrix-cell__progress-bar">
                                <div
                                  className={`sprint-matrix-cell__progress-fill${
                                    isOver ? " is-danger" : percent >= 90 ? " is-warning" : " is-normal"
                                  }`}
                                  style={{ width: `${Math.min(100, percent)}%` }}
                                />
                              </div>
                              <span className="sprint-matrix-cell__percent">{percent}%</span>
                            </div>
                          </td>

                          {/* Member specific cells */}
                          {team.members.map((m) => {
                            const mb = summary.memberBreakdown.find((x) => x.memberId === m.id);
                            if (!mb) {
                              return <td key={m.id}>—</td>;
                            }
                            const mbOver = mb.assignedPoints > mb.capacityPoints && mb.capacityPoints > 0;
                            return (
                              <td key={m.id} className="sprint-matrix-table__member-cell">
                                <div className="member-capacity-cell">
                                  <div className="member-capacity-cell__top">
                                    <span>
                                      <strong>{mb.assignedPoints}</strong> / {mb.capacityPoints} pts
                                    </span>
                                    <span
                                      className={`member-capacity-cell__status${
                                        mbOver ? " is-over" : " is-available"
                                      }`}
                                    >
                                      {mbOver
                                        ? `-${Math.abs(mb.remainingPoints)}`
                                        : `+${mb.remainingPoints}`}
                                    </span>
                                  </div>
                                  <div className="member-capacity-cell__meta">
                                    <span>{mb.workingDays}d work</span>
                                    {mb.ptoDays > 0 && (
                                      <span className="member-capacity-cell__pto">
                                        <Palmtree size={10} /> {mb.ptoDays}d PTO
                                      </span>
                                    )}
                                    {mb.reservedPoints > 0 && (
                                      <span
                                        className="member-capacity-cell__res"
                                        title={`Gross: ${mb.grossCapacityPoints} pts, Reserved: ${mb.reservedPoints} pts`}
                                      >
                                        -{mb.reservedPoints} res
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* SETTINGS TAB */}
        {activeTab === "settings" && (
          <div className="team-settings-view">
            {/* Team Baseline Points Settings */}
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

            {/* US Holidays Configuration */}
            <div className="settings-section-card">
              <div className="settings-section-card__header">
                <div>
                  <h3>US Federal Holidays</h3>
                  <p>
                    Automatically exclude recognized US federal holidays (e.g. Memorial Day, Labor Day, Thanksgiving) from business days.
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
                    {showHolidaysList ? "Hide" : "View"} {usHolidaysCurrentYear.length} Recognized US Federal Holidays ({currentYear})
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

            {/* Extra Days Off (Not recognized as federal holidays) */}
            <div className="settings-section-card">
              <div className="settings-section-card__header">
                <div>
                  <h3>Extra Days Off & Company Holidays</h3>
                  <p>
                    Configure company-specific days off, winter shutdowns, floating holidays, or half-days not recognized as standard federal holidays.
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
                {isAddingExtraDay && (
                  <form className="extra-day-form" onSubmit={handleAddExtraDayOff}>
                    <div className="extra-day-form__header">
                      <h4>Add Extra Day Off</h4>
                      <button
                        type="button"
                        className="extra-day-form__close"
                        onClick={() => setIsAddingExtraDay(false)}
                      >
                        <X size={14} />
                      </button>
                    </div>
                    <div className="extra-day-form__grid">
                      <div className="member-form-field">
                        <label>Occasion / Name *</label>
                        <input
                          type="text"
                          placeholder="e.g. Day after Thanksgiving / Company Retreat"
                          value={extraDayName}
                          onChange={(e) => setExtraDayName(e.target.value)}
                          required
                          autoFocus
                        />
                      </div>
                      <div className="member-form-field">
                        <label>Date *</label>
                        <input
                          type="date"
                          value={extraDayDate}
                          onChange={(e) => setExtraDayDate(e.target.value)}
                          required
                        />
                      </div>
                      <div className="member-form-field">
                        <label>Duration</label>
                        <select
                          value={extraDayIsHalf ? "half" : "full"}
                          onChange={(e) => setExtraDayIsHalf(e.target.value === "half")}
                        >
                          <option value="full">Full Day (1.0 day off)</option>
                          <option value="half">Half Day (0.5 day off)</option>
                        </select>
                      </div>
                      <div className="member-form-field">
                        <label>Note (optional)</label>
                        <input
                          type="text"
                          placeholder="Optional details"
                          value={extraDayNote}
                          onChange={(e) => setExtraDayNote(e.target.value)}
                        />
                      </div>
                    </div>
                    <div className="extra-day-form__actions">
                      <button type="button" onClick={() => setIsAddingExtraDay(false)}>
                        Cancel
                      </button>
                      <button type="submit" className="team-view__primary-btn">
                        Save Day Off
                      </button>
                    </div>
                  </form>
                )}

                {team.settings.extraDaysOff.length === 0 ? (
                  <div className="extra-days__empty">
                    No extra days off configured. Click "Add Extra Day Off" to add one.
                  </div>
                ) : (
                  <div className="extra-days__list">
                    {team.settings.extraDaysOff.map((extra) => (
                      <div key={extra.id} className="extra-day-chip">
                        <div className="extra-day-chip__content">
                          <div className="extra-day-chip__top">
                            <span className="extra-day-chip__date">{extra.date}</span>
                            <strong className="extra-day-chip__name">{extra.name}</strong>
                            <span
                              className={`extra-day-chip__badge${extra.isHalfDay ? " is-half" : ""}`}
                            >
                              {extra.isHalfDay ? "Half Day (0.5d)" : "Full Day"}
                            </span>
                          </div>
                          {extra.note && <div className="extra-day-chip__note">{extra.note}</div>}
                        </div>
                        <button
                          type="button"
                          className="extra-day-chip__remove"
                          onClick={() => handleDeleteExtraDayOff(extra.id)}
                          title="Remove extra day off"
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

      {/* PTO MODAL DIALOG */}
      {ptoModalMemberId && (
        <div className="modal-overlay" onMouseDown={() => setPtoModalMemberId(null)}>
          <div
            className="team-pto-modal"
            role="dialog"
            aria-modal="true"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="team-pto-modal__header">
              <div className="team-pto-modal__title-row">
                <Palmtree size={18} className="team-pto-modal__icon" />
                <h3>
                  Add PTO Span for{" "}
                  {team.members.find((m) => m.id === ptoModalMemberId)?.name ?? "Member"}
                </h3>
              </div>
              <button
                type="button"
                className="team-pto-modal__close"
                onClick={() => setPtoModalMemberId(null)}
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleAddPtoSpan}>
              <div className="team-pto-modal__body">
                <div className="team-pto-modal__grid">
                  <div className="member-form-field">
                    <label>Start Date *</label>
                    <input
                      type="date"
                      value={ptoStartDate}
                      onChange={(e) => {
                        setPtoStartDate(e.target.value);
                        if (ptoEndDate < e.target.value) {
                          setPtoEndDate(e.target.value);
                        }
                      }}
                      required
                    />
                  </div>

                  <div className="member-form-field">
                    <label>Start Day Granularity</label>
                    <select
                      value={ptoStartHalf}
                      onChange={(e) => setPtoStartHalf(e.target.value as HalfDayType)}
                    >
                      <option value="full">Full Day (1.0 day)</option>
                      <option value="morning">Morning / 1st Half (0.5 day)</option>
                      <option value="afternoon">Afternoon / 2nd Half (0.5 day)</option>
                    </select>
                  </div>

                  <div className="member-form-field">
                    <label>End Date *</label>
                    <input
                      type="date"
                      value={ptoEndDate}
                      min={ptoStartDate}
                      onChange={(e) => setPtoEndDate(e.target.value)}
                      required
                    />
                  </div>

                  <div className="member-form-field">
                    <label>End Day Granularity</label>
                    <select
                      value={ptoEndHalf}
                      disabled={ptoStartDate === ptoEndDate}
                      onChange={(e) => setPtoEndHalf(e.target.value as HalfDayType)}
                    >
                      <option value="full">Full Day (1.0 day)</option>
                      <option value="morning">Morning / 1st Half (0.5 day)</option>
                      <option value="afternoon">Afternoon / 2nd Half (0.5 day)</option>
                    </select>
                  </div>
                </div>

                <div className="member-form-field">
                  <label>Note / Reason (optional)</label>
                  <input
                    type="text"
                    placeholder="e.g. Summer Vacation, Doctor Appointment"
                    value={ptoNote}
                    onChange={(e) => setPtoNote(e.target.value)}
                  />
                </div>
              </div>

              <div className="team-pto-modal__footer">
                <button
                  type="button"
                  className="team-view__secondary-btn"
                  onClick={() => setPtoModalMemberId(null)}
                >
                  Cancel
                </button>
                <button type="submit" className="team-view__primary-btn">
                  Save PTO Span
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* CAPACITY RESERVATIONS MODAL */}
      {managingReservationsPI && onUpdateProgramIncrements && (
        <ManageReservationsModal
          pi={managingReservationsPI}
          team={team}
          requirements={requirements}
          onUpdatePI={(updatedPI) => {
            onUpdateProgramIncrements((pis) =>
              pis.map((p) => (p.id === updatedPI.id ? updatedPI : p))
            );
            setManagingReservationsPI(updatedPI);
          }}
          onClose={() => setManagingReservationsPI(null)}
        />
      )}
    </div>
  );
}
