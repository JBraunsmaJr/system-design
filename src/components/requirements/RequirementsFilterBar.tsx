import {FilterX} from 'lucide-react';
import {FilterMenu} from './FilterMenu';
import {memberOptions, sprintOptions, statusOptions,} from '../../domain/requirements/requirementsFilterOptions';
import {
    BACKLOG_FILTER_VALUE,
    clearFilterKey,
    isFilterActive,
    type RequirementsFilter,
    type RequirementsFilterKey,
    toggleFilterValue,
    UNASSIGNED_FILTER_VALUE,
    UNTAGGED_FILTER_VALUE,
} from '../../domain/requirements/requirementsFilter';
import type {ProgramIncrement} from '../../domain/timeline/programIncrements';
import type {TeamDocument} from '../../domain/timeline/teamTypes';

interface RequirementsFilterBarProps {
    filter: RequirementsFilter;
    onChange: (filter: RequirementsFilter) => void;
    team?: TeamDocument;
    programIncrements: ProgramIncrement[];
    /** Every tag in the document. */
    allTags: string[];
    /** How many items the filter (and search) leave, out of all of them. */
    shownCount: number;
    totalCount: number;
}

/**
 * The Requirements view's filter row: status, assignee, sprint and tag,
 * each a checklist - see requirementsFilter.ts for how they combine.
 */
export function RequirementsFilterBar({
                                          filter,
                                          onChange,
                                          team,
                                          programIncrements,
                                          allTags,
                                          shownCount,
                                          totalCount,
                                      }: RequirementsFilterBarProps) {
    const toggle = (key: RequirementsFilterKey) => (value: string) =>
        onChange(toggleFilterValue(filter, key, value));
    const clear = (key: RequirementsFilterKey) => () => onChange(clearFilterKey(filter, key));

    return (
        <div className="requirements-filter-bar" role="toolbar" aria-label="Filters">
            <FilterMenu
                label="Status"
                options={statusOptions()}
                selected={filter.statuses ?? []}
                onToggle={toggle('statuses')}
                onClear={clear('statuses')}
            />
            <FilterMenu
                label="Assignee"
                options={[{value: UNASSIGNED_FILTER_VALUE, label: 'Unassigned'}, ...memberOptions(team)]}
                selected={filter.assigneeIds ?? []}
                onToggle={toggle('assigneeIds')}
                onClear={clear('assigneeIds')}
            />
            <FilterMenu
                label="Sprint"
                options={[
                    {value: BACKLOG_FILTER_VALUE, label: 'Backlog', detail: 'Not in any sprint'},
                    ...sprintOptions(programIncrements),
                ]}
                selected={filter.sprintIds ?? []}
                onToggle={toggle('sprintIds')}
                onClear={clear('sprintIds')}
            />
            <FilterMenu
                label="Tag"
                options={[
                    {value: UNTAGGED_FILTER_VALUE, label: 'Untagged'},
                    ...allTags.map((t) => ({value: t, label: t})),
                ]}
                selected={filter.tags ?? []}
                onToggle={toggle('tags')}
                onClear={clear('tags')}
            />
            {isFilterActive(filter) && (
                <>
          <span className="requirements-filter-bar__count" aria-live="polite">
            {shownCount} of {totalCount}
          </span>
                    <button
                        type="button"
                        className="requirements-filter-bar__clear"
                        onClick={() => onChange({})}
                        title="Show every item again"
                    >
                        <FilterX size={12}/> Clear filters
                    </button>
                </>
            )}
            {Boolean(
                filter.statuses?.length || filter.assigneeIds?.length || filter.sprintIds?.length,
            ) && (
                <span className="requirements-filter-bar__note">
          Status, assignee and sprint filters show work items only.
        </span>
            )}
        </div>
    );
}
