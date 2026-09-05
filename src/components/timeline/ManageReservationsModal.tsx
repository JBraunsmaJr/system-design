import { useState, useMemo } from "react";
import {
  ShieldAlert,
  Plus,
  Trash2,
  Edit2,
  X,
  Layers,
  Calendar,
  Percent,
  Hash,
  Sparkles,
  Info,
} from "lucide-react";
import type { ProgramIncrement, CapacityReservation, CapacityReservationUnit } from "../../domain/programIncrements";
import type { TeamDocument } from "../../domain/teamTypes";
import type { RequirementsDocument } from "../../domain/requirementsTypes";
import { isItemWorkable } from "../../domain/requirementsRegistry";
import { computeSprintDateRanges } from "../../domain/programIncrements";
import { computeSprintCapacity } from "../../domain/teamCapacity";

interface ManageReservationsModalProps {
  pi: ProgramIncrement;
  team: TeamDocument;
  requirements: RequirementsDocument;
  onUpdatePI: (updatedPI: ProgramIncrement) => void;
  onClose: () => void;
}

const CATEGORY_OPTIONS: { id: string; label: string; icon: string; color: string }[] = [
  { id: "risk", label: "Risk Buffer", icon: "🛡️", color: "#f59e0b" },
  { id: "bugs", label: "Bugs & Maintenance", icon: "🐛", color: "#f0578c" },
  { id: "techdebt", label: "Technical Debt", icon: "🔧", color: "#8b5cf6" },
  { id: "meetings", label: "Scrum & Meetings", icon: "📅", color: "#38bdf8" },
  { id: "operations", label: "On-Call & Ops", icon: "⚙️", color: "#10b981" },
  { id: "other", label: "Other / Custom", icon: "📌", color: "#94a3b8" },
];

const PRESET_RESERVATIONS = [
  { name: "Scrum & Meetings (10%)", category: "meetings", unit: "percentage" as CapacityReservationUnit, value: 10 },
  { name: "Tech Debt (10%)", category: "techdebt", unit: "percentage" as CapacityReservationUnit, value: 10 },
  { name: "Risk Buffer (15%)", category: "risk", unit: "percentage" as CapacityReservationUnit, value: 15 },
  { name: "General Reserve (20%)", category: "risk", unit: "percentage" as CapacityReservationUnit, value: 20 },
  { name: "Bug Buffer (5 pts)", category: "bugs", unit: "points" as CapacityReservationUnit, value: 5 },
];

function nextId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;
}

export function ManageReservationsModal({
  pi,
  team,
  requirements,
  onUpdatePI,
  onClose,
}: ManageReservationsModalProps) {
  const [isAdding, setIsAdding] = useState(false);
  const [editingReservationId, setEditingReservationId] = useState<string | null>(null);

  const [formName, setFormName] = useState("");
  const [formCategory, setFormCategory] = useState("risk");
  const [formUnit, setFormUnit] = useState<CapacityReservationUnit>("percentage");
  const [formValue, setFormValue] = useState<string>("20");
  const [formSprintId, setFormSprintId] = useState<string>(""); // "" = All Sprints
  const [formNote, setFormNote] = useState("");

  const reservations = useMemo(() => pi.reservations ?? [], [pi.reservations]);

  const sprintDateRanges = useMemo(() => computeSprintDateRanges(pi), [pi]);
  const rangeMap = useMemo(() => new Map(sprintDateRanges.map((r) => [r.sprintId, r])), [sprintDateRanges]);

  // Compute live sprint capacities for preview
  const sprintImpacts = useMemo(() => {
    const workableItems = requirements.items.filter((i) => isItemWorkable(requirements, i));
    return pi.sprints.map((sprint) => {
      const range = rangeMap.get(sprint.id);
      const activeForSprint = reservations.filter((r) => !r.sprintId || r.sprintId === sprint.id);
      const summary = computeSprintCapacity(sprint, range, team, workableItems, activeForSprint);
      return {
        sprint,
        range,
        summary,
        activeReservations: activeForSprint,
      };
    });
  }, [pi, team, requirements, rangeMap, reservations]);

  const totalReservationsCount = reservations.length;
  const piLevelCount = reservations.filter((r) => !r.sprintId).length;
  const sprintLevelCount = totalReservationsCount - piLevelCount;

  const resetForm = () => {
    setFormName("");
    setFormCategory("risk");
    setFormUnit("percentage");
    setFormValue("20");
    setFormSprintId("");
    setFormNote("");
    setEditingReservationId(null);
    setIsAdding(false);
  };

  const handleStartAdd = () => {
    resetForm();
    setIsAdding(true);
  };

  const handleApplyPreset = (preset: (typeof PRESET_RESERVATIONS)[number]) => {
    setFormName(preset.name.replace(/\s*\([^)]*\)$/, ""));
    setFormCategory(preset.category);
    setFormUnit(preset.unit);
    setFormValue(preset.value.toString());
    setIsAdding(true);
    setEditingReservationId(null);
  };

  const handleStartEdit = (reservation: CapacityReservation) => {
    setFormName(reservation.name);
    setFormCategory(reservation.category ?? "other");
    setFormUnit(reservation.unit);
    setFormValue(reservation.value.toString());
    setFormSprintId(reservation.sprintId ?? "");
    setFormNote(reservation.note ?? "");
    setEditingReservationId(reservation.id);
    setIsAdding(true);
  };

  const handleSaveReservation = (e: React.FormEvent) => {
    e.preventDefault();
    const val = parseFloat(formValue);
    if (isNaN(val) || val <= 0 || !formName.trim()) return;

    if (editingReservationId) {
      const updatedList = reservations.map((r) =>
        r.id === editingReservationId
          ? {
              ...r,
              name: formName.trim(),
              category: formCategory,
              unit: formUnit,
              value: val,
              sprintId: formSprintId.trim() !== "" ? formSprintId : undefined,
              note: formNote.trim() || undefined,
            }
          : r
      );
      onUpdatePI({ ...pi, reservations: updatedList });
    } else {
      const newReservation: CapacityReservation = {
        id: nextId("cres"),
        name: formName.trim(),
        category: formCategory,
        unit: formUnit,
        value: val,
        sprintId: formSprintId.trim() !== "" ? formSprintId : undefined,
        note: formNote.trim() || undefined,
      };
      onUpdatePI({ ...pi, reservations: [...reservations, newReservation] });
    }

    resetForm();
  };

  const handleDeleteReservation = (id: string) => {
    const updatedList = reservations.filter((r) => r.id !== id);
    onUpdatePI({ ...pi, reservations: updatedList });
    if (editingReservationId === id) {
      resetForm();
    }
  };

  const getCategoryMeta = (catId?: string) => {
    return CATEGORY_OPTIONS.find((c) => c.id === catId) ?? CATEGORY_OPTIONS[CATEGORY_OPTIONS.length - 1];
  };

  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div
        className="manage-reservations-modal"
        role="dialog"
        aria-modal="true"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="manage-reservations-modal__header">
          <div className="manage-reservations-modal__title-row">
            <div className="manage-reservations-modal__icon-wrap">
              <ShieldAlert size={20} />
            </div>
            <div>
              <h3 className="manage-reservations-modal__title">Capacity Reservations</h3>
              <p className="manage-reservations-modal__subtitle">
                Allocate reserved capacity for {pi.name} across all sprints or granular per-sprint.
              </p>
            </div>
          </div>
          <button
            type="button"
            className="manage-reservations-modal__close-btn"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        {/* Content Body */}
        <div className="manage-reservations-modal__body">
          {/* Top Quick Presets */}
          <div className="manage-reservations-modal__presets-row">
            <span className="manage-reservations-modal__presets-label">
              <Sparkles size={12} /> Quick Presets:
            </span>
            <div className="manage-reservations-modal__presets-list">
              {PRESET_RESERVATIONS.map((preset) => (
                <button
                  key={preset.name}
                  type="button"
                  className="manage-reservations-modal__preset-chip"
                  onClick={() => handleApplyPreset(preset)}
                >
                  {preset.name}
                </button>
              ))}
            </div>
          </div>

          {/* Add / Edit Form */}
          {isAdding && (
            <form className="reservation-form" onSubmit={handleSaveReservation}>
              <div className="reservation-form__header">
                <h4>{editingReservationId ? "Edit Capacity Reservation" : "Add Capacity Reservation"}</h4>
                <button
                  type="button"
                  className="reservation-form__cancel-btn"
                  onClick={resetForm}
                  aria-label="Cancel editing"
                >
                  <X size={14} />
                </button>
              </div>

              <div className="reservation-form__grid">
                <div className="reservation-form__field">
                  <label>Reservation Name / Purpose *</label>
                  <input
                    type="text"
                    placeholder="e.g. Risk Buffer, Tech Debt, Bug Backlog, Ceremonies"
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    required
                    autoFocus
                  />
                </div>

                <div className="reservation-form__field">
                  <label>Category</label>
                  <select value={formCategory} onChange={(e) => setFormCategory(e.target.value)}>
                    {CATEGORY_OPTIONS.map((cat) => (
                      <option key={cat.id} value={cat.id}>
                        {cat.icon} {cat.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="reservation-form__field">
                  <label>Allocation Unit</label>
                  <div className="reservation-form__unit-selector">
                    <button
                      type="button"
                      className={`reservation-form__unit-btn${formUnit === "percentage" ? " is-active" : ""}`}
                      onClick={() => setFormUnit("percentage")}
                    >
                      <Percent size={13} /> Percentage (%)
                    </button>
                    <button
                      type="button"
                      className={`reservation-form__unit-btn${formUnit === "points" ? " is-active" : ""}`}
                      onClick={() => setFormUnit("points")}
                    >
                      <Hash size={13} /> Points (pts)
                    </button>
                  </div>
                </div>

                <div className="reservation-form__field">
                  <label>
                    {formUnit === "percentage" ? "Percentage Value (%) *" : "Whole Points Value (pts) *"}
                  </label>
                  <div className="reservation-form__value-input-wrap">
                    <input
                      type="number"
                      step="any"
                      min="0"
                      max={formUnit === "percentage" ? "100" : "500"}
                      value={formValue}
                      onChange={(e) => setFormValue(e.target.value)}
                      required
                    />
                    <span className="reservation-form__value-suffix">
                      {formUnit === "percentage" ? "%" : "pts"}
                    </span>
                  </div>
                </div>

                <div className="reservation-form__field">
                  <label>Scope (Application Level)</label>
                  <select value={formSprintId} onChange={(e) => setFormSprintId(e.target.value)}>
                    <option value="">PI Level (Applies to ALL Sprints in {pi.name})</option>
                    {pi.sprints.map((s) => (
                      <option key={s.id} value={s.id}>
                        Sprint Level: {s.name} ({s.durationDays}d)
                      </option>
                    ))}
                  </select>
                </div>

                <div className="reservation-form__field reservation-form__field--full">
                  <label>Note / Description (optional)</label>
                  <input
                    type="text"
                    placeholder="e.g. Reserved for high-priority production escalations and tech debt backlog"
                    value={formNote}
                    onChange={(e) => setFormNote(e.target.value)}
                  />
                </div>
              </div>

              <div className="reservation-form__footer">
                <span className="reservation-form__hint">
                  {formUnit === "percentage"
                    ? `Deducts ${formValue || 0}% from each team member's gross capacity in target sprints.`
                    : `Deducts ${formValue || 0} pts total from sprint capacity (distributed proportionally across team members).`}
                </span>
                <div className="reservation-form__actions">
                  <button type="button" className="reservation-form__cancel-btn-text" onClick={resetForm}>
                    Cancel
                  </button>
                  <button type="submit" className="manage-reservations-modal__primary-btn">
                    {editingReservationId ? "Update Reservation" : "Save Reservation"}
                  </button>
                </div>
              </div>
            </form>
          )}

          {/* Active Reservations Section */}
          <div className="manage-reservations-section">
            <div className="manage-reservations-section__header">
              <div className="manage-reservations-section__title-group">
                <Layers size={15} />
                <span className="manage-reservations-section__title">Configured Allocations</span>
                <span className="manage-reservations-section__count-badge">{totalReservationsCount}</span>
              </div>
              {!isAdding && (
                <button
                  type="button"
                  className="manage-reservations-modal__add-btn"
                  onClick={handleStartAdd}
                >
                  <Plus size={13} /> Add Reservation
                </button>
              )}
            </div>

            {reservations.length === 0 ? (
              <div className="manage-reservations-empty">
                <ShieldAlert size={28} className="manage-reservations-empty__icon" />
                <p className="manage-reservations-empty__title">No Capacity Reservations Configured</p>
                <p className="manage-reservations-empty__desc">
                  Reserve buffer capacity for risks, bug fixes, tech debt, or meetings. You can apply reservations at the
                  PI level (impacting all sprints) or granularly per sprint.
                </p>
                {!isAdding && (
                  <button
                    type="button"
                    className="manage-reservations-modal__primary-btn"
                    onClick={handleStartAdd}
                  >
                    <Plus size={14} /> Add First Reservation
                  </button>
                )}
              </div>
            ) : (
              <div className="reservations-list">
                {reservations.map((r) => {
                  const cat = getCategoryMeta(r.category);
                  const isPiLevel = !r.sprintId;
                  const targetSprint = pi.sprints.find((s) => s.id === r.sprintId);

                  return (
                    <div key={r.id} className="reservation-card">
                      <div className="reservation-card__left">
                        <div
                          className="reservation-card__icon"
                          style={{ backgroundColor: `${cat.color}20`, color: cat.color }}
                        >
                          <span>{cat.icon}</span>
                        </div>
                        <div className="reservation-card__info">
                          <div className="reservation-card__top">
                            <strong className="reservation-card__name">{r.name}</strong>
                            <span
                              className="reservation-card__category-badge"
                              style={{ borderColor: `${cat.color}40`, color: cat.color }}
                            >
                              {cat.label}
                            </span>
                            <span className={`reservation-card__scope-badge${isPiLevel ? " is-pi" : " is-sprint"}`}>
                              {isPiLevel ? (
                                <>
                                  <Layers size={10} /> All Sprints
                                </>
                              ) : (
                                <>
                                  <Calendar size={10} /> {targetSprint?.name ?? "Sprint"}
                                </>
                              )}
                            </span>
                          </div>
                          {r.note && <div className="reservation-card__note">{r.note}</div>}
                        </div>
                      </div>

                      <div className="reservation-card__right">
                        <div className="reservation-card__value-badge">
                          <strong>
                            {r.value}
                            {r.unit === "percentage" ? "%" : " pts"}
                          </strong>
                          <span className="reservation-card__value-label">
                            {r.unit === "percentage" ? "Reserve Rate" : "Fixed Reserve"}
                          </span>
                        </div>

                        <div className="reservation-card__actions">
                          <button
                            type="button"
                            className="reservation-card__action-btn"
                            onClick={() => handleStartEdit(r)}
                            title="Edit reservation"
                          >
                            <Edit2 size={13} />
                          </button>
                          <button
                            type="button"
                            className="reservation-card__action-btn is-delete"
                            onClick={() => handleDeleteReservation(r.id)}
                            title="Delete reservation"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Sprint Impact Preview Table */}
          <div className="manage-reservations-section">
            <div className="manage-reservations-section__header">
              <div className="manage-reservations-section__title-group">
                <Calendar size={15} />
                <span className="manage-reservations-section__title">Sprint Capacity Impact Preview</span>
              </div>
              <div className="manage-reservations-section__hint">
                <Info size={12} /> Net available capacity after reserve deductions
              </div>
            </div>

            <div className="reservations-preview-table-wrap">
              <table className="reservations-preview-table">
                <thead>
                  <tr>
                    <th>Sprint</th>
                    <th>Business Days</th>
                    <th>Gross Capacity</th>
                    <th>Reserved Points</th>
                    <th>Net Available</th>
                    <th>Applied Reservations</th>
                  </tr>
                </thead>
                <tbody>
                  {sprintImpacts.map(({ sprint, range, summary, activeReservations }) => {
                    return (
                      <tr key={sprint.id}>
                        <td>
                          <strong>{sprint.name}</strong>
                          {range && (
                            <span className="reservations-preview-table__dates">
                              {range.startDate} → {range.endDate}
                            </span>
                          )}
                        </td>
                        <td>{summary.sprintBusinessDays}d</td>
                        <td>
                          <strong>{summary.grossCapacityPoints}</strong> pts
                        </td>
                        <td>
                          {summary.totalReservedPoints > 0 ? (
                            <span className="reservations-preview-table__reserved-badge">
                              -{summary.totalReservedPoints} pts
                            </span>
                          ) : (
                            <span className="reservations-preview-table__zero">—</span>
                          )}
                        </td>
                        <td>
                          <span className="reservations-preview-table__available-badge">
                            <strong>{summary.totalCapacityPoints}</strong> pts
                          </span>
                        </td>
                        <td>
                          {activeReservations.length === 0 ? (
                            <span className="reservations-preview-table__none">None</span>
                          ) : (
                            <div className="reservations-preview-table__chips">
                              {activeReservations.map((ar) => (
                                <span key={ar.id} className="reservations-preview-table__chip">
                                  {ar.name}: {ar.value}
                                  {ar.unit === "percentage" ? "%" : " pts"}
                                </span>
                              ))}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="manage-reservations-modal__footer">
          <div className="manage-reservations-modal__footer-meta">
            <span>
              {piLevelCount} PI-level • {sprintLevelCount} sprint-level reservations
            </span>
          </div>
          <button type="button" className="manage-reservations-modal__done-btn" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
