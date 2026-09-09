import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Package,
  Flag,
  ClipboardCheck,
  Rocket,
  Snowflake,
  Diamond,
  Layers,
} from "lucide-react";
import { computeSprintDateRanges, type ProgramIncrement } from "../../domain/programIncrements";
import { getItemType, isItemWorkable } from "../../domain/requirementsRegistry";
import { findScheduleConflicts } from "../../domain/scheduleConflicts";
import type { RequirementsDocument, RequirementItem } from "../../domain/requirementsTypes";
import type { Milestone } from "../../domain/milestones";
import { getMilestoneColor, getMilestoneTypeLabel } from "../../domain/milestones";
import { getAllEpicsWithInferredSchedule } from "../../domain/epicScheduling";

interface GanttChartProps {
  programIncrements: ProgramIncrement[];
  requirements: RequirementsDocument;
  milestones?: Milestone[];
  onSelectItem: (itemId: string) => void;
  onSelectMilestone?: (milestoneId: string) => void;
  onAddMilestoneOnDate?: (date: string) => void;
  onNavigateToRequirement?: (itemId: string) => void;
}

export type GanttGroupingMode = "none" | "epic" | "parent" | "sprint" | "type";

interface GanttGroup {
  id: string;
  title: string;
  badge?: string;
  color?: string;
  items: RequirementItem[];
}

const DAY_WIDTH = 14;
const DEFAULT_LABEL_COLUMN_WIDTH = 220;

function parseISODate(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86400000;
}

/**
 * Positions every sprint across every PI on one continuous day-based
 * scale, sorted chronologically by start date - along with milestones and inferred epics.
 */
function useGanttLayout(
  programIncrements: ProgramIncrement[],
  milestones: Milestone[] = [],
  requirements?: RequirementsDocument
) {
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

    // Inferred epics schedule
    const epicsWithSchedule = requirements
      ? getAllEpicsWithInferredSchedule(requirements, programIncrements, milestones)
      : [];

    if (bands.length === 0 && milestones.length === 0 && epicsWithSchedule.length === 0) {
      return {
        bands: [],
        rangesBySprintId: new Map<string, { startDate: string; endDate: string; left: number; width: number }>(),
        milestoneLayouts: [],
        epicLayouts: [],
        depLayouts: [],
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
    for (const { schedule } of epicsWithSchedule) {
      if (schedule.startDate) {
        startCandidates.push(parseISODate(schedule.startDate));
        endCandidates.push(parseISODate(schedule.endDate ?? schedule.startDate));
      }
    }

    const originDays = startCandidates.length > 0 ? Math.min(...startCandidates) : 0;
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

      let stackIndex = 0;
      while (stackIndex < laneOccupancy.length && laneOccupancy[stackIndex] > left - 4) {
        stackIndex += 1;
      }
      laneOccupancy[stackIndex] = left + 130;
      maxStack = Math.max(maxStack, stackIndex + 1);

      milestoneLayouts.push({ milestone: m, left, stackIndex });
    }

    // Epic spans layout (FR-009, AC-008)
    const epicLayouts = epicsWithSchedule
      .filter(({ schedule }) => !!schedule.startDate)
      .map(({ epic, schedule }) => {
        const startDays = parseISODate(schedule.startDate!);
        const left = (startDays - originDays) * DAY_WIDTH;
        let width = 0;
        if (schedule.endDate) {
          const endDays = parseISODate(schedule.endDate);
          width = Math.max(DAY_WIDTH, (endDays - startDays + 1) * DAY_WIDTH);
        } else {
          width = Math.max(DAY_WIDTH * 4, 80);
        }
        maxRight = Math.max(maxRight, left + width);
        return {
          epic,
          schedule,
          left,
          width,
        };
      });

    // External dependencies layout
    const depLayouts = requirements
      ? requirements.items
          .filter((i) => (i.typeId === "dependency" || i.typeId.toLowerCase().includes("dep")) && !isItemWorkable(requirements, i))
          .map((dep) => {
            const linkedMs = milestones.filter((m) => {
              const ids = m.relatedItemIds ?? m.relatedWorkableItemIds ?? [];
              return ids.includes(dep.id) && m.scheduledAt && /^\d{4}-\d{2}-\d{2}$/.test(m.scheduledAt);
            });
            if (linkedMs.length > 0) {
              const day = parseISODate(linkedMs[0].scheduledAt);
              const left = (day - originDays) * DAY_WIDTH;
              maxRight = Math.max(maxRight, left + 110);
              return { dep, left, date: linkedMs[0].scheduledAt, milestone: linkedMs[0] };
            }
            return null;
          })
          .filter((d): d is NonNullable<typeof d> => d !== null)
      : [];

    return {
      bands,
      rangesBySprintId,
      milestoneLayouts,
      epicLayouts,
      depLayouts,
      totalWidth: Math.max(maxRight + 40, 600),
      originDays,
      maxStack,
    };
  }, [programIncrements, milestones, requirements]);
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
  const [isEpicsCollapsed, setIsEpicsCollapsed] = useState(false);
  const [groupingMode, setGroupingMode] = useState<GanttGroupingMode>("none");
  const [collapsedGroupIds, setCollapsedGroupIds] = useState<Set<string>>(new Set());
  const [labelColumnWidth, setLabelColumnWidth] = useState(DEFAULT_LABEL_COLUMN_WIDTH);
  const [isDraggingResizer, setIsDraggingResizer] = useState(false);

  const handleResizerMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingResizer(true);
    const startX = e.clientX;
    const startWidth = labelColumnWidth;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const delta = moveEvent.clientX - startX;
      const newWidth = Math.max(120, startWidth + delta);
      setLabelColumnWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsDraggingResizer(false);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  };

  const toggleGroupCollapse = (groupId: string) => {
    setCollapsedGroupIds((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  };

  const { bands, rangesBySprintId, milestoneLayouts, epicLayouts, depLayouts, totalWidth, maxStack } = useGanttLayout(
    programIncrements,
    milestones,
    requirements
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

  const rows = useMemo(() => {
    return [...scheduledItems].sort((a, b) => {
      const ra = sprintRangesByItemId.get(a.id);
      const rb = sprintRangesByItemId.get(b.id);
      if (!ra || !rb) return 0;
      return ra.startDate < rb.startDate ? -1 : ra.startDate > rb.startDate ? 1 : 0;
    });
  }, [scheduledItems, sprintRangesByItemId]);

  const parentEpicByItemId = useMemo(() => {
    const map = new Map<string, RequirementItem>();
    const epics = requirements.items.filter((i) => i.typeId === "epic" || i.typeId.toLowerCase().includes("epic"));
    const epicIds = new Set(epics.map((e) => e.id));
    for (const rel of requirements.relationships) {
      if (epicIds.has(rel.fromItemId) && (rel.typeId === "parent-of" || rel.typeId === "relates-to")) {
        const epic = epics.find((e) => e.id === rel.fromItemId);
        if (epic) map.set(rel.toItemId, epic);
      } else if (epicIds.has(rel.toItemId) && rel.typeId === "child-of") {
        const epic = epics.find((e) => e.id === rel.toItemId);
        if (epic) map.set(rel.fromItemId, epic);
      }
    }
    return map;
  }, [requirements]);

  const parentItemByItemId = useMemo(() => {
    const map = new Map<string, RequirementItem>();
    const itemById = new Map(requirements.items.map((i) => [i.id, i]));
    for (const rel of requirements.relationships) {
      if (rel.typeId === "parent-of" || rel.typeId === "relates-to") {
        const parent = itemById.get(rel.fromItemId);
        if (parent) map.set(rel.toItemId, parent);
      } else if (rel.typeId === "child-of") {
        const parent = itemById.get(rel.toItemId);
        if (parent) map.set(rel.fromItemId, parent);
      }
    }
    return map;
  }, [requirements]);

  const groups = useMemo((): GanttGroup[] => {
    if (groupingMode === "none") {
      return [{ id: "default", title: "", items: rows }];
    }

    if (groupingMode === "epic") {
      const epics = requirements.items.filter((i) => i.typeId === "epic" || i.typeId.toLowerCase().includes("epic"));
      const map = new Map<string, RequirementItem[]>();
      const standalone: RequirementItem[] = [];

      for (const item of rows) {
        const epic = parentEpicByItemId.get(item.id);
        if (epic) {
          const list = map.get(epic.id) ?? [];
          list.push(item);
          map.set(epic.id, list);
        } else {
          standalone.push(item);
        }
      }

      const result: GanttGroup[] = [];
      for (const epic of epics) {
        const items = map.get(epic.id);
        if (items && items.length > 0) {
          result.push({
            id: `epic-${epic.id}`,
            title: `Epic: ${epic.id} - ${epic.title || "Untitled"}`,
            color: "#8b5cf6",
            badge: `${items.length} item${items.length === 1 ? "" : "s"}`,
            items,
          });
        }
      }
      if (standalone.length > 0) {
        result.push({
          id: "epic-standalone",
          title: "Standalone Workable Items",
          color: "var(--chrome-text-dim)",
          badge: `${standalone.length} item${standalone.length === 1 ? "" : "s"}`,
          items: standalone,
        });
      }
      return result;
    }

    if (groupingMode === "parent") {
      const map = new Map<string, RequirementItem[]>();
      const standalone: RequirementItem[] = [];

      for (const item of rows) {
        const parent = parentItemByItemId.get(item.id);
        if (parent) {
          const list = map.get(parent.id) ?? [];
          list.push(item);
          map.set(parent.id, list);
        } else {
          standalone.push(item);
        }
      }

      const itemById = new Map(requirements.items.map((i) => [i.id, i]));
      const result: GanttGroup[] = [];
      for (const [parentId, items] of map.entries()) {
        const parent = itemById.get(parentId);
        const pType = parent ? getItemType(requirements, parent.typeId) : undefined;
        result.push({
          id: `parent-${parentId}`,
          title: `Parent: ${parentId} - ${parent?.title || "Untitled"}`,
          color: pType?.color ?? "var(--accent)",
          badge: `${items.length} item${items.length === 1 ? "" : "s"}`,
          items,
        });
      }
      if (standalone.length > 0) {
        result.push({
          id: "parent-independent",
          title: "Independent Workable Items",
          color: "var(--chrome-text-dim)",
          badge: `${standalone.length} item${standalone.length === 1 ? "" : "s"}`,
          items: standalone,
        });
      }
      return result;
    }

    if (groupingMode === "sprint") {
      const result: GanttGroup[] = [];
      for (const pi of programIncrements) {
        const ranges = computeSprintDateRanges(pi);
        for (const sprint of pi.sprints) {
          const range = ranges.find((r) => r.sprintId === sprint.id);
          const items = rows.filter((item) => item.sprintId === sprint.id);
          if (items.length > 0) {
            result.push({
              id: `sprint-${sprint.id}`,
              title: `${pi.name} • ${sprint.name}${range ? ` (${range.startDate} → ${range.endDate})` : ""}`,
              color: "var(--accent)",
              badge: `${items.length} item${items.length === 1 ? "" : "s"}`,
              items,
            });
          }
        }
      }
      return result;
    }

    if (groupingMode === "type") {
      const result: GanttGroup[] = [];
      for (const t of requirements.itemTypes) {
        const items = rows.filter((item) => item.typeId === t.id);
        if (items.length > 0) {
          result.push({
            id: `type-${t.id}`,
            title: `${t.label}s`,
            color: t.color,
            badge: `${items.length} item${items.length === 1 ? "" : "s"}`,
            items,
          });
        }
      }
      return result;
    }

    return [{ id: "default", title: "", items: rows }];
  }, [groupingMode, rows, requirements, programIncrements, parentEpicByItemId, parentItemByItemId]);

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
      {/* Controls & Grouping Bar */}
      <div className="gantt-chart__controls-bar">
        <div className="gantt-chart__grouping-controls">
          <span className="gantt-chart__control-label">
            <Layers size={13} />
            <span>Group by:</span>
          </span>
          <div className="gantt-chart__group-btn-group">
            <button
              type="button"
              className={`gantt-chart__group-btn${groupingMode === "none" ? " is-active" : ""}`}
              onClick={() => setGroupingMode("none")}
            >
              None
            </button>
            <button
              type="button"
              className={`gantt-chart__group-btn${groupingMode === "epic" ? " is-active" : ""}`}
              onClick={() => setGroupingMode("epic")}
            >
              Epic
            </button>
            <button
              type="button"
              className={`gantt-chart__group-btn${groupingMode === "parent" ? " is-active" : ""}`}
              onClick={() => setGroupingMode("parent")}
            >
              Parent
            </button>
            <button
              type="button"
              className={`gantt-chart__group-btn${groupingMode === "sprint" ? " is-active" : ""}`}
              onClick={() => setGroupingMode("sprint")}
            >
              Sprint
            </button>
            <button
              type="button"
              className={`gantt-chart__group-btn${groupingMode === "type" ? " is-active" : ""}`}
              onClick={() => setGroupingMode("type")}
            >
              Type
            </button>
          </div>
        </div>
      </div>

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
        <div className="gantt-chart__inner" style={{ width: labelColumnWidth + totalWidth }}>
          {/* Vertical milestone lines running down the chart behind work items */}
          <div className="gantt-chart__milestone-lines-layer" style={{ left: labelColumnWidth, width: totalWidth }}>
            {milestoneLayouts.map(({ milestone, left }) => {
              const color = getMilestoneColor(milestone);
              return (
                <div
                  key={milestone.id}
                  className="gantt-chart__milestone-line"
                  style={{
                    left,
                    borderColor: color,
                  }}
                />
              );
            })}
          </div>

          {/* Sticky top container for Sprints header & Milestones track */}
          <div className="gantt-chart__top-sticky">
            {/* Sprints header row */}
            <div className="gantt-chart__header-row">
              <div className="gantt-chart__label-header" style={{ width: labelColumnWidth }}>
                <span>Item</span>
                <div
                  className={`gantt-chart__resizer${isDraggingResizer ? " is-dragging" : ""}`}
                  onMouseDown={handleResizerMouseDown}
                  title="Drag to resize Item column"
                />
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
              <div className="gantt-chart__milestones-label" style={{ width: labelColumnWidth }}>
                <Diamond size={13} className="gantt-chart__milestone-header-icon" />
                <span>Milestones & Releases</span>
              </div>

              <div className="gantt-chart__milestones-track" style={{ width: totalWidth, minHeight: milestoneTrackHeight }}>
                {milestoneLayouts.map(({ milestone, left }) => {
                  const color = getMilestoneColor(milestone);
                  return (
                    <div
                      key={`track-line-${milestone.id}`}
                      className="gantt-chart__milestone-line"
                      style={{
                        left,
                        borderColor: color,
                      }}
                    />
                  );
                })}
                {milestoneLayouts.map(({ milestone, left, stackIndex }) => {
                  const color = getMilestoneColor(milestone);
                  const typeLabel = getMilestoneTypeLabel(milestone.type);
                  const relatedCount = (milestone.relatedItemIds ?? milestone.relatedWorkableItemIds)?.length ?? 0;
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
                        title={`${typeLabel}: ${milestone.name}${milestone.version ? ` (v${milestone.version})` : ""} \u2022 Scheduled: ${milestone.scheduledAt}${relatedCount > 0 ? ` \u2022 ${relatedCount} related item${relatedCount === 1 ? "" : "s"}` : ""}`}
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
                          <span className="gantt-chart__milestone-badge" title={`${relatedCount} linked items`}>
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

          {/* Epics & Non-Workable Items track (FR-009, AC-008, AC-009) */}
          {(epicLayouts.length > 0 || depLayouts.length > 0) && (
            <div className="gantt-chart__epics-section">
              <div className="gantt-chart__epics-header-row">
                <button
                  type="button"
                  className="gantt-chart__epics-toggle-label"
                  style={{ width: labelColumnWidth }}
                  onClick={() => setIsEpicsCollapsed(!isEpicsCollapsed)}
                  title="Toggle Epics & Non-Workable items section"
                >
                  {isEpicsCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                  <span>Epics & Dependencies</span>
                </button>
                <div className="gantt-chart__track" style={{ width: totalWidth }} />
              </div>

              {!isEpicsCollapsed && (
                <>
                  {epicLayouts.map(({ epic, schedule, left, width }) => {
                    const isSolid = schedule.isFullyScheduled && !!schedule.endDate;
                    return (
                      <div key={epic.id} className="gantt-chart__epic-row">
                        <div
                          className="gantt-chart__epic-label"
                          style={{ width: labelColumnWidth }}
                          title={`${epic.id}: ${epic.title || "Untitled"}`}
                        >
                          <span
                            className="gantt-chart__label-id"
                            style={{ color: "#8b5cf6" }}
                          >
                            {epic.id}
                          </span>
                          <span className="gantt-chart__label-title" title={epic.title || "Untitled"}>
                            {epic.title || "Untitled"}
                          </span>
                        </div>
                        <div className="gantt-chart__track" style={{ width: totalWidth, position: "relative" }}>
                          <button
                            type="button"
                            className={`gantt-chart__epic-bar ${isSolid ? "gantt-chart__epic-bar--solid" : "gantt-chart__epic-bar--open-ended"}`}
                            style={{ left, width }}
                            onClick={() => onSelectItem(epic.id)}
                            title={`${epic.id}: ${epic.title || "Untitled"} (${schedule.startDate ?? "—"} \u2192 ${schedule.endDate ?? "Open-ended"}) \u2022 ${schedule.scheduledChildrenCount}/${schedule.totalChildrenCount} scheduled \u2022 ${schedule.totalPoints} pts`}
                          >
                            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {epic.title || epic.id}
                            </span>
                            <span className="gantt-chart__epic-status-badge">
                              {isSolid ? `${schedule.totalPoints} pts` : `${schedule.unscheduledChildrenCount} unscheduled`}
                            </span>
                          </button>
                        </div>
                      </div>
                    );
                  })}

                  {depLayouts.map(({ dep, left, date, milestone }) => (
                    <div key={dep.id} className="gantt-chart__epic-row">
                      <div
                        className="gantt-chart__epic-label"
                        style={{ width: labelColumnWidth }}
                        title={`${dep.id}: ${dep.title || "Untitled"}`}
                      >
                        <span
                          className="gantt-chart__label-id"
                          style={{ color: "#f59e0b" }}
                        >
                          {dep.id}
                        </span>
                        <span className="gantt-chart__label-title" title={dep.title || "Untitled"}>
                          {dep.title || "Untitled"}
                        </span>
                      </div>
                      <div className="gantt-chart__track" style={{ width: totalWidth, position: "relative" }}>
                        <button
                          type="button"
                          className="pi-board-column__dep-pill"
                          style={{ position: "absolute", left, top: "6px", zIndex: 3 }}
                          onClick={() => onSelectItem(dep.id)}
                          title={`External Dependency: ${dep.id} ${dep.title || ""} (Linked to ${milestone.name} on ${date})`}
                        >
                          <span className="pi-board-column__dep-icon">⚡</span>
                          <span>{dep.id} ({date})</span>
                        </button>
                      </div>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}

          {/* Workable items rows */}
          <div className="gantt-chart__rows">
            {groups.length === 0 || rows.length === 0 ? (
              <p className="gantt-chart__no-items">No workable items scheduled into a sprint yet.</p>
            ) : (
              groups.map((group) => {
                const isGroupCollapsed = collapsedGroupIds.has(group.id);
                return (
                  <div key={group.id} className="gantt-chart__group-section">
                    {groupingMode !== "none" && group.title && (
                      <div className="gantt-chart__group-header-row">
                        <button
                          type="button"
                          className="gantt-chart__group-toggle-label"
                          style={{ width: labelColumnWidth }}
                          onClick={() => toggleGroupCollapse(group.id)}
                          title={`Toggle group ${group.title}`}
                        >
                          {isGroupCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                          <span
                            className="gantt-chart__group-color-dot"
                            style={{ backgroundColor: group.color ?? "var(--accent)" }}
                          />
                          <span className="gantt-chart__group-title">{group.title}</span>
                          {group.badge && <span className="gantt-chart__group-badge">{group.badge}</span>}
                        </button>
                        <div
                          className="gantt-chart__track gantt-chart__group-track"
                          style={{ width: totalWidth, borderColor: group.color ? `${group.color}33` : undefined }}
                        />
                      </div>
                    )}

                    {!isGroupCollapsed &&
                      group.items.map((item) => {
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
                              style={{ width: labelColumnWidth }}
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
                      })}
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
