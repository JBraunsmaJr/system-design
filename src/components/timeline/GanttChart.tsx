import { useMemo, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronUp, Package, Flag, ClipboardCheck, Rocket, Snowflake, Diamond } from "lucide-react";
import { computeSprintDateRanges, type ProgramIncrement } from "../../domain/programIncrements";
import { getItemType, isItemWorkable } from "../../domain/requirementsRegistry";
import { findScheduleConflicts } from "../../domain/scheduleConflicts";
import type { RequirementsDocument } from "../../domain/requirementsTypes";
import type { Milestone } from "../../domain/milestones";
import { getMilestoneColor, getMilestoneTypeLabel } from "../../domain/milestones";

interface GanttChartProps {
  programIncrements: ProgramIncrement[];
  requirements: RequirementsDocument;
  milestones?: Milestone[];
  onSelectItem: (itemId: string) => void;
  onSelectMilestone?: (milestoneId: string) => void;
  onAddMilestoneOnDate?: (date: string) => void;
  onNavigateToRequirement?: (itemId: string) => void;
}

const DAY_WIDTH = 14;
const LABEL_COLUMN_WIDTH = 180;

function parseISODate(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86400000;
}

/**
 * Positions every sprint across every PI on one continuous day-based
 * scale, sorted chronologically by start date - along with milestones.
 */
function useGanttLayout(programIncrements: ProgramIncrement[], milestones: Milestone[] = []) {
  return useMemo(() => {
    const bands: {
      sprintId: string;
      sprintName: string;
      piName: string;
      startDate: string;
      endDate: string;
    }[] = [];
    for (const pi of programIncrements) {
      const ranges = computeSprintDateRanges(pi);
      for (const sprint of pi.sprints) {
        const range = ranges.find((r) => r.sprintId === sprint.id);
        if (!range) continue;
        bands.push({ sprintName: sprint.name, piName: pi.name, ...range });
      }
    }
    bands.sort((a, b) => (a.startDate < b.startDate ? -1 : a.startDate > b.startDate ? 1 : 0));

    if (bands.length === 0 && milestones.length === 0) {
      return {
        bands: [],
        rangesBySprintId: new Map<string, { startDate: string; endDate: string; left: number; width: number }>(),
        milestoneLayouts: [],
        totalWidth: 0,
        originDays: 0,
        maxStack: 0,
      };
    }

    const startCandidates: number[] = [];
    const endCandidates: number[] = [];

    for (const b of bands) {
      startCandidates.push(parseISODate(b.startDate));
      endCandidates.push(parseISODate(b.endDate));
    }
    for (const m of milestones) {
      if (m.scheduledAt && /^\d{4}-\d{2}-\d{2}$/.test(m.scheduledAt)) {
        const day = parseISODate(m.scheduledAt);
        startCandidates.push(day);
        endCandidates.push(day);
      }
    }

    const originDays = Math.min(...startCandidates);
    const rangesBySprintId = new Map<string, { startDate: string; endDate: string; left: number; width: number }>();
    let maxRight = 0;

    for (const band of bands) {
      const startDays = parseISODate(band.startDate);
      const endDays = parseISODate(band.endDate);
      const left = (startDays - originDays) * DAY_WIDTH;
      const width = Math.max(DAY_WIDTH, (endDays - startDays + 1) * DAY_WIDTH);
      rangesBySprintId.set(band.sprintId, { startDate: band.startDate, endDate: band.endDate, left, width });
      maxRight = Math.max(maxRight, left + width);
    }

    // Layout milestones: group by date to stack overlapping releases (AC-009, 9.3)
    const validMilestones = milestones
      .filter((m) => m.scheduledAt && /^\d{4}-\d{2}-\d{2}$/.test(m.scheduledAt))
      .sort((a, b) => (a.scheduledAt < b.scheduledAt ? -1 : a.scheduledAt > b.scheduledAt ? 1 : 0));

    // Stacking algorithm: assign vertical lane stack index to avoid label collisions
    const milestoneLayouts: {
      milestone: Milestone;
      left: number;
      stackIndex: number;
    }[] = [];

    const laneOccupancy: number[] = []; // stores rightmost occupied pixel per stack level
    let maxStack = 0;

    for (const m of validMilestones) {
      const day = parseISODate(m.scheduledAt);
      const left = (day - originDays) * DAY_WIDTH + Math.floor(DAY_WIDTH / 2);
      maxRight = Math.max(maxRight, left + 140);

      // Find first stack level where this milestone's badge (est width 120px) doesn't overlap
      let stackIndex = 0;
      while (stackIndex < laneOccupancy.length && laneOccupancy[stackIndex] > left - 4) {
        stackIndex += 1;
      }
      laneOccupancy[stackIndex] = left + 130;
      maxStack = Math.max(maxStack, stackIndex + 1);

      milestoneLayouts.push({ milestone: m, left, stackIndex });
    }

    return {
      bands,
      rangesBySprintId,
      milestoneLayouts,
      totalWidth: Math.max(maxRight + 40, 600),
      originDays,
      maxStack,
    };
  }, [programIncrements, milestones]);
}

/**
 * Visualizes every scheduled item as a horizontal bar positioned by its
 * sprint's date range, cross-references conflicts, and renders releases / milestones
 * as zero-capacity point-in-time diamond markers anchored to exact dates.
 */
export function GanttChart({
  programIncrements,
  requirements,
  milestones = [],
  onSelectItem,
  onSelectMilestone,
  onNavigateToRequirement,
}: GanttChartProps) {
  const [isConflictsCollapsed, setIsConflictsCollapsed] = useState(false);
  const { bands, rangesBySprintId, milestoneLayouts, totalWidth, maxStack } = useGanttLayout(
    programIncrements,
    milestones
  );

  const scheduledItems = requirements.items.filter(
    (item) => item.sprintId && rangesBySprintId.has(item.sprintId) && isItemWorkable(requirements, item)
  );

  const sprintRangesByItemId = useMemo(() => {
    const map = new Map<string, { startDate: string; endDate: string }>();
    for (const item of scheduledItems) {
      const range = rangesBySprintId.get(item.sprintId!);
      if (range) map.set(item.id, { startDate: range.startDate, endDate: range.endDate });
    }
    return map;
  }, [scheduledItems, rangesBySprintId]);

  const conflicts = useMemo(
    () => findScheduleConflicts(requirements.items, requirements.relationships, requirements.relationshipTypes, requirements.itemTypes, sprintRangesByItemId),
    [requirements.items, requirements.relationships, requirements.relationshipTypes, requirements.itemTypes, sprintRangesByItemId]
  );

  const conflictByItemId = new Map<string, (typeof conflicts)[number]>();
  for (const c of conflicts) {
    const existing = conflictByItemId.get(c.item.id);
    if (!existing || existing.severity !== "blocked") {
      conflictByItemId.set(c.item.id, c);
    }
  }
  const blockedCount = conflicts.filter((c) => c.severity === "blocked").length;
  const riskCount = conflicts.length - blockedCount;

  const rows = [...scheduledItems].sort((a, b) => {
    const ra = sprintRangesByItemId.get(a.id);
    const rb = sprintRangesByItemId.get(b.id);
    if (!ra || !rb) return 0;
    return ra.startDate < rb.startDate ? -1 : ra.startDate > rb.startDate ? 1 : 0;
  });

  const renderMilestoneIcon = (t: string) => {
    switch (t) {
      case "release":
        return <Package size={12} />;
      case "deadline":
        return <Flag size={12} />;
      case "review":
        return <ClipboardCheck size={12} />;
      case "launch":
        return <Rocket size={12} />;
      case "code-freeze":
        return <Snowflake size={12} />;
      default:
        return <Diamond size={12} />;
    }
  };

  if (bands.length === 0 && milestoneLayouts.length === 0) {
    return (
      <div className="gantt-chart__empty">
        <p>No sprints or milestones defined yet - add a Program Increment or Release to plot your timeline.</p>
      </div>
    );
  }

  const milestoneTrackHeight = Math.max(34, maxStack * 28 + 10);

  return (
    <div className="gantt-chart">
      {conflicts.length > 0 && (
        <div className={`gantt-conflicts${blockedCount === 0 ? " is-risk-only" : ""}`}>
          <button
            type="button"
            className="gantt-conflicts__header"
            onClick={() => setIsConflictsCollapsed(!isConflictsCollapsed)}
          >
            <AlertTriangle size={14} />
            <span>
              {blockedCount > 0 && `${blockedCount} blocked`}
              {blockedCount > 0 && riskCount > 0 && ", "}
              {riskCount > 0 && `${riskCount} at risk`}
            </span>
            {isConflictsCollapsed ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
          </button>
          {!isConflictsCollapsed && (
            <ul className="gantt-conflicts__list">
              {conflicts.map((c) => (
                <li key={c.id} className={`gantt-conflicts__item${c.severity === "risk" ? " is-risk" : ""}`}>
                  <span className="gantt-conflicts__text">
                    {c.severity === "risk" ? (
                      <>
                        <strong>{c.item.id}</strong>
                        {c.item.title ? `: ${c.item.title}` : ""} is scheduled in the same sprint as its blocker{" "}
                        <strong>{c.blocker.id}</strong>
                        {c.blocker.title ? `: ${c.blocker.title}` : ""}. Both can likely be completed in the sprint,
                        but make sure {c.blocker.id} is done first.
                      </>
                    ) : (
                      <>
                        <strong>{c.item.id}</strong>
                        {c.item.title ? `: ${c.item.title}` : ""} is scheduled starting {c.itemRange.startDate}, but
                        it's blocked by <strong>{c.blocker.id}</strong>
                        {c.blocker.title ? `: ${c.blocker.title}` : ""}
                        {c.blockerRange
                          ? `, which isn't finished until ${c.blockerRange.endDate}`
                          : ", which isn't scheduled yet"}
                        . Consider scheduling the blocker to finish before {c.itemRange.startDate}.
                      </>
                    )}
                  </span>
                  {onNavigateToRequirement && (
                    <button
                      type="button"
                      className="gantt-conflicts__action"
                      onClick={() => onNavigateToRequirement(c.blocker.id)}
                    >
                      Go to {c.blocker.id}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="gantt-chart__scroll">
        <div className="gantt-chart__inner" style={{ width: LABEL_COLUMN_WIDTH + totalWidth }}>
          {/* Vertical milestone lines running down the chart behind work items */}
          <div className="gantt-chart__milestone-lines-layer" style={{ left: LABEL_COLUMN_WIDTH, width: totalWidth }}>
            {milestoneLayouts.map(({ milestone, left }) => {
              const color = getMilestoneColor(milestone);
              return (
                <div
                  key={milestone.id}
                  className="gantt-chart__milestone-line"
                  style={{
                    left,
                    borderColor: color,
                    backgroundColor: color,
                  }}
                />
              );
            })}
          </div>

          {/* Sticky top container for Sprints header & Milestones track */}
          <div className="gantt-chart__top-sticky">
            {/* Sprints header row */}
            <div className="gantt-chart__header-row">
              <div className="gantt-chart__label-header" style={{ width: LABEL_COLUMN_WIDTH }}>
                Item
              </div>
              <div className="gantt-chart__bands" style={{ width: totalWidth }}>
                {bands.map((band) => {
                  const pos = rangesBySprintId.get(band.sprintId);
                  if (!pos) return null;
                  return (
                    <div
                      key={band.sprintId}
                      className="gantt-chart__band"
                      style={{ left: pos.left, width: pos.width }}
                      title={`${band.piName} \u2022 ${band.sprintName} (${band.startDate} \u2192 ${band.endDate})`}
                    >
                      <span className="gantt-chart__band-sprint">{band.sprintName}</span>
                      <span className="gantt-chart__band-pi">{band.piName}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Dedicated Milestones & Releases track (FR-003, AC-002, AC-009) */}
            <div className="gantt-chart__milestones-row" style={{ minHeight: milestoneTrackHeight }}>
              <div className="gantt-chart__milestones-label" style={{ width: LABEL_COLUMN_WIDTH }}>
                <Diamond size={13} className="gantt-chart__milestone-header-icon" />
                <span>Milestones & Releases</span>
              </div>

              <div className="gantt-chart__milestones-track" style={{ width: totalWidth, minHeight: milestoneTrackHeight }}>
                {milestoneLayouts.map(({ milestone, left, stackIndex }) => {
                  const color = getMilestoneColor(milestone);
                  const typeLabel = getMilestoneTypeLabel(milestone.type);
                  const relatedCount = milestone.relatedWorkableItemIds?.length ?? 0;
                  const topOffset = stackIndex * 26 + 4;

                  return (
                    <div
                      key={milestone.id}
                      className="gantt-chart__milestone-anchor"
                      style={{ left, top: topOffset }}
                    >
                      <button
                        type="button"
                        className="gantt-chart__milestone-marker"
                        style={{ borderColor: color, color }}
                        onClick={() => onSelectMilestone?.(milestone.id)}
                        title={`${typeLabel}: ${milestone.name}${milestone.version ? ` (v${milestone.version})` : ""} \u2022 Scheduled: ${milestone.scheduledAt}${relatedCount > 0 ? ` \u2022 ${relatedCount} related work item${relatedCount === 1 ? "" : "s"}` : ""}`}
                        aria-label={`${typeLabel} ${milestone.name}, scheduled ${milestone.scheduledAt}`}
                      >
                        <span className="gantt-chart__milestone-shape" style={{ backgroundColor: color }}>
                          ◆
                        </span>
                        <span className="gantt-chart__milestone-icon">{renderMilestoneIcon(milestone.type)}</span>
                        <span className="gantt-chart__milestone-name">{milestone.name}</span>
                        {milestone.version && (
                          <span className="gantt-chart__milestone-version">v{milestone.version}</span>
                        )}
                        {relatedCount > 0 && (
                          <span className="gantt-chart__milestone-badge" title={`${relatedCount} linked workable items`}>
                            {relatedCount}
                          </span>
                        )}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Workable items rows */}
          <div className="gantt-chart__rows">
            {rows.length === 0 ? (
              <p className="gantt-chart__no-items">No workable items scheduled into a sprint yet.</p>
            ) : (
              rows.map((item) => {
                const pos = rangesBySprintId.get(item.sprintId!);
                if (!pos) return null;
                const type = getItemType(requirements, item.typeId);
                const rowConflict = conflictByItemId.get(item.id);
                const isConflicted = rowConflict?.severity === "blocked";
                const isAtRisk = rowConflict?.severity === "risk";
                const itemFullTitle = item.title ? `${item.id}: ${item.title}` : item.id;
                return (
                  <div key={item.id} className="gantt-chart__row">
                    <div
                      className="gantt-chart__label"
                      style={{ width: LABEL_COLUMN_WIDTH }}
                      title={itemFullTitle}
                    >
                      <span
                        className="gantt-chart__label-id"
                        style={{ color: type?.color ?? "var(--chrome-text-dim)" }}
                      >
                        {item.id}
                      </span>
                      <span className="gantt-chart__label-title" title={item.title || "Untitled"}>
                        {item.title || "Untitled"}
                      </span>
                      {isConflicted && <AlertTriangle size={11} className="gantt-chart__label-warning" />}
                      {isAtRisk && <AlertTriangle size={11} className="gantt-chart__label-risk" />}
                    </div>
                    <div className="gantt-chart__track" style={{ width: totalWidth }}>
                      <button
                        type="button"
                        className={`gantt-chart__bar${isConflicted ? " is-conflicted" : ""}${isAtRisk ? " is-at-risk" : ""}`}
                        style={{ left: pos.left, width: pos.width, borderColor: type?.color }}
                        onClick={() => onSelectItem(item.id)}
                        title={`${item.id}: ${item.title || "Untitled"} (${pos.startDate} \u2192 ${pos.endDate})`}
                      >
                        {item.title || item.id}
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
