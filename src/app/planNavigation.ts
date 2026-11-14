/**
 * The Plan tab and its sections (pure).
 *
 * Planning used to be three top-level tabs - Timeline, Team and the
 * dependency view - with Board/Gantt as a toggle inside Timeline. They are
 * one activity, so the toolbar now shows a single Plan tab and this module
 * maps its four sections onto the view modes the rest of the app already
 * uses. `ViewMode` itself is unchanged apart from that grouping: presence
 * still broadcasts 'timeline', 'team' or 'dependencies', so peers on an older
 * build keep seeing who is on the same page.
 */
import type { ViewMode } from './hooks/useViewNavigation';

export type PlanChartMode = 'board' | 'gantt';
export type PlanSection = 'board' | 'gantt' | 'dependencies' | 'team';

export interface PlanSectionInfo {
  id: PlanSection;
  label: string;
  /** Tooltip: what the section is for, in a few words. */
  hint: string;
}

/** In the order the sub-navigation shows them. */
export const PLAN_SECTIONS: readonly PlanSectionInfo[] = [
  { id: 'board', label: 'Board', hint: 'Sprints and the backlog' },
  { id: 'gantt', label: 'Gantt', hint: 'Work laid out across sprints' },
  {
    id: 'dependencies',
    label: 'Dependencies',
    hint: 'What is ready to work on, and what blocks what',
  },
  { id: 'team', label: 'Team', hint: 'People, time off and capacity' },
];

export function isPlanView(viewMode: ViewMode): boolean {
  return viewMode === 'timeline' || viewMode === 'team' || viewMode === 'dependencies';
}

/** Which section is showing, or null outside the Plan tab. */
export function planSectionFor(viewMode: ViewMode, chartMode: PlanChartMode): PlanSection | null {
  if (viewMode === 'timeline') return chartMode;
  if (viewMode === 'team') return 'team';
  if (viewMode === 'dependencies') return 'dependencies';
  return null;
}

/**
 * What to show for a section. `chartMode` is present only where the section
 * decides it; Team and Dependencies leave the timeline's last mode alone, so
 * returning to the Plan tab's timeline shows what was there before.
 */
export function planTargetFor(section: PlanSection): {
  viewMode: ViewMode;
  chartMode?: PlanChartMode;
} {
  switch (section) {
    case 'board':
      return { viewMode: 'timeline', chartMode: 'board' };
    case 'gantt':
      return { viewMode: 'timeline', chartMode: 'gantt' };
    case 'dependencies':
      return { viewMode: 'dependencies' };
    case 'team':
      return { viewMode: 'team' };
  }
}
