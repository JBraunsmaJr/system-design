import { useMemo, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronUp } from "lucide-react";
import { computeSprintDateRanges, type ProgramIncrement } from "../../domain/programIncrements";
import { getItemType, isItemWorkable } from "../../domain/requirementsRegistry";
import { findScheduleConflicts } from "../../domain/scheduleConflicts";
import type { RequirementsDocument } from "../../domain/requirementsTypes";

interface GanttChartProps {
  programIncrements: ProgramIncrement[];
  requirements: RequirementsDocument;
  onSelectItem: (itemId: string) => void;
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
 * scale, sorted chronologically by start date - unlike the board view,
 * this needs sprints from DIFFERENT PIs laid out relative to each other
 * on a shared timeline, not grouped into separate PI sections.
 */
function useGanttLayout(programIncrements: ProgramIncrement[]) {
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

    if (bands.length === 0) {
      return { bands: [], rangesBySprintId: new Map<string, { startDate: string; endDate: string; left: number; width: number }>(), totalWidth: 0 };
    }

    const originDays = parseISODate(bands[0].startDate);
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

    return { bands, rangesBySprintId, totalWidth: maxRight };
  }, [programIncrements]);
}

/**
 * Visualizes every scheduled item as a horizontal bar positioned by its
 * sprint's date range, and cross-references the relationship graph
 * against those same dates to surface a specific, actionable class of
 * problem: an item scheduled to start before the thing it depends on is
 * actually finished. Deliberately doesn't attempt to draw connector lines
 * between blocker and blocked bars - accurately tracking two dynamically
 * laid-out bars' positions through scroll/resize is real complexity for
 * something a clear textual conflict list already communicates better
 * than an arrow would across a chart that can span many rows.
 */
export function GanttChart({ programIncrements, requirements, onSelectItem, onNavigateToRequirement }: GanttChartProps) {
  const [isConflictsCollapsed, setIsConflictsCollapsed] = useState(false);
  const { bands, rangesBySprintId, totalWidth } = useGanttLayout(programIncrements);

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
    () => findScheduleConflicts(requirements.items, requirements.relationships, requirements.relationshipTypes, sprintRangesByItemId),
    [requirements.items, requirements.relationships, requirements.relationshipTypes, sprintRangesByItemId]
  );
  const conflictedItemIds = new Set(conflicts.map((c) => c.item.id));

  const rows = [...scheduledItems].sort((a, b) => {
    const ra = sprintRangesByItemId.get(a.id);
    const rb = sprintRangesByItemId.get(b.id);
    if (!ra || !rb) return 0;
    return ra.startDate < rb.startDate ? -1 : ra.startDate > rb.startDate ? 1 : 0;
  });

  if (bands.length === 0) {
    return (
      <div className="gantt-chart__empty">
        <p>No sprints defined yet - add a Program Increment above to see scheduled work plotted here.</p>
      </div>
    );
  }

  return (
    <div className="gantt-chart">
      {conflicts.length > 0 && (
        <div className="gantt-conflicts">
          <button
            type="button"
            className="gantt-conflicts__header"
            onClick={() => setIsConflictsCollapsed(!isConflictsCollapsed)}
          >
            <AlertTriangle size={14} />
            <span>
              {conflicts.length} scheduling {conflicts.length === 1 ? "conflict" : "conflicts"} detected
            </span>
            {isConflictsCollapsed ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
          </button>
          {!isConflictsCollapsed && (
            <ul className="gantt-conflicts__list">
              {conflicts.map((c) => (
                <li key={c.id} className="gantt-conflicts__item">
                  <span className="gantt-conflicts__text">
                    <strong>{c.item.id}</strong>
                    {c.item.title ? `: ${c.item.title}` : ""} is scheduled starting {c.itemRange.startDate}, but
                    it's blocked by <strong>{c.blocker.id}</strong>
                    {c.blocker.title ? `: ${c.blocker.title}` : ""}
                    {c.blockerRange
                      ? `, which isn't finished until ${c.blockerRange.endDate}`
                      : ", which isn't scheduled yet"}
                    . Consider scheduling the blocker to finish before {c.itemRange.startDate}.
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
                    title={`${band.piName} \u2022 ${band.sprintName}`}
                  >
                    <span className="gantt-chart__band-sprint">{band.sprintName}</span>
                    <span className="gantt-chart__band-pi">{band.piName}</span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="gantt-chart__rows">
            {rows.length === 0 ? (
              <p className="gantt-chart__no-items">No items scheduled into a sprint yet.</p>
            ) : (
              rows.map((item) => {
                const pos = rangesBySprintId.get(item.sprintId!);
                if (!pos) return null;
                const type = getItemType(requirements, item.typeId);
                const isConflicted = conflictedItemIds.has(item.id);
                return (
                  <div key={item.id} className="gantt-chart__row">
                    <div className="gantt-chart__label" style={{ width: LABEL_COLUMN_WIDTH }}>
                      <span
                        className="gantt-chart__label-id"
                        style={{ color: type?.color ?? "var(--chrome-text-dim)" }}
                      >
                        {item.id}
                      </span>
                      <span className="gantt-chart__label-title">{item.title || "Untitled"}</span>
                      {isConflicted && <AlertTriangle size={11} className="gantt-chart__label-warning" />}
                    </div>
                    <div className="gantt-chart__track" style={{ width: totalWidth }}>
                      <button
                        type="button"
                        className={`gantt-chart__bar${isConflicted ? " is-conflicted" : ""}`}
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
