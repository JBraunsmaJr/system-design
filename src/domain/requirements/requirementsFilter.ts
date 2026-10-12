import type {RequirementItem, RequirementsDocument, RequirementStatus} from './requirementsTypes';
import {isItemWorkable} from './requirementsRegistry';
import {hasTag} from './requirementTags';

/**
 * Narrowing the Requirements view by status, assignee, sprint and tag.
 *
 * Within one dimension the chosen values are alternatives (status is To do
 * OR In progress); across dimensions they all have to hold (that status
 * AND assigned to Ana). An empty or missing list means "don't filter on
 * this". Each dimension has a "none" value - unassigned, backlog, untagged
 * - because "what hasn't been planned yet" is usually the question.
 *
 * Status, assignee and sprint are only things a WORKABLE item has (see
 * RequirementItemType.isWorkable), so filtering on any of them leaves
 * descriptive items (requirements, goals) out - a goal isn't "unassigned
 * work", it just isn't work.
 */
export const UNASSIGNED_FILTER_VALUE = '__unassigned__';
export const BACKLOG_FILTER_VALUE = '__backlog__';
export const UNTAGGED_FILTER_VALUE = '__untagged__';

export interface RequirementsFilter {
    statuses?: RequirementStatus[];
    /** TeamMember ids, or UNASSIGNED_FILTER_VALUE. */
    assigneeIds?: string[];
    /** Sprint ids, or BACKLOG_FILTER_VALUE for items in no (existing) sprint. */
    sprintIds?: string[];
    /** Tags (matched ignoring case), or UNTAGGED_FILTER_VALUE. */
    tags?: string[];
}

export const EMPTY_REQUIREMENTS_FILTER: RequirementsFilter = {};

export type RequirementsFilterKey = keyof RequirementsFilter;

const STATUS_VALUES: readonly RequirementStatus[] = ['todo', 'in-progress', 'done'];

export function isFilterActive(filter: RequirementsFilter): boolean {
    return (
        (filter.statuses?.length ?? 0) > 0 ||
        (filter.assigneeIds?.length ?? 0) > 0 ||
        (filter.sprintIds?.length ?? 0) > 0 ||
        (filter.tags?.length ?? 0) > 0
    );
}

export function activeFilterCount(filter: RequirementsFilter): number {
    return (
        (filter.statuses?.length ?? 0) +
        (filter.assigneeIds?.length ?? 0) +
        (filter.sprintIds?.length ?? 0) +
        (filter.tags?.length ?? 0)
    );
}

/** What the view needs to know beyond the item itself, worked out once
 * per filtering pass rather than per item. */
export interface FilterContext {
    doc: RequirementsDocument;
    /** Every sprint id that currently exists - an item pointing at a
     * deleted sprint counts as backlog, matching how SprintPicker shows it. */
    existingSprintIds: ReadonlySet<string>;
    /** Every team member id that currently exists - same reasoning. */
    existingMemberIds?: ReadonlySet<string>;
}

export function itemMatchesFilter(
    item: RequirementItem,
    filter: RequirementsFilter,
    context: FilterContext,
): boolean {
    const statuses = filter.statuses ?? [];
    const assignees = filter.assigneeIds ?? [];
    const sprints = filter.sprintIds ?? [];
    const tags = filter.tags ?? [];

    if (statuses.length > 0 || assignees.length > 0 || sprints.length > 0) {
        if (!isItemWorkable(context.doc, item)) return false;
    }

    if (statuses.length > 0) {
        // A workable item with no stored status reads as "todo" everywhere.
        const status = item.status ?? 'todo';
        if (!statuses.includes(status)) return false;
    }

    if (assignees.length > 0) {
        const assigned =
            item.assigneeId &&
            (!context.existingMemberIds || context.existingMemberIds.has(item.assigneeId))
                ? item.assigneeId
                : undefined;
        const ok = assigned
            ? assignees.includes(assigned)
            : assignees.includes(UNASSIGNED_FILTER_VALUE);
        if (!ok) return false;
    }

    if (sprints.length > 0) {
        const sprint =
            item.sprintId && context.existingSprintIds.has(item.sprintId) ? item.sprintId : undefined;
        const ok = sprint ? sprints.includes(sprint) : sprints.includes(BACKLOG_FILTER_VALUE);
        if (!ok) return false;
    }

    if (tags.length > 0) {
        const untagged = (item.tags ?? []).length === 0;
        const ok = tags.some((t) => (t === UNTAGGED_FILTER_VALUE ? untagged : hasTag(item, t)));
        if (!ok) return false;
    }

    return true;
}

/** `filter` with `value` toggled in or out of dimension `key`. Returns a
 * new object; a dimension left empty is removed. */
export function toggleFilterValue(
    filter: RequirementsFilter,
    key: RequirementsFilterKey,
    value: string,
): RequirementsFilter {
    const current = (filter[key] ?? []) as string[];
    const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
    const result: RequirementsFilter = {...filter};
    if (next.length > 0) (result as Record<string, string[]>)[key] = next;
    else delete result[key];
    return result;
}

export function clearFilterKey(
    filter: RequirementsFilter,
    key: RequirementsFilterKey,
): RequirementsFilter {
    const result = {...filter};
    delete result[key];
    return result;
}

function stringArray(value: unknown): string[] | undefined {
    if (!Array.isArray(value)) return undefined;
    const strings = value.filter((v): v is string => typeof v === 'string');
    return strings.length > 0 ? strings : undefined;
}

/** A filter read back from storage: unknown fields and values dropped. */
export function normalizeFilter(value: unknown): RequirementsFilter {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const raw = value as Record<string, unknown>;
    const filter: RequirementsFilter = {};
    const statuses = stringArray(raw.statuses)?.filter((s): s is RequirementStatus =>
        STATUS_VALUES.includes(s as RequirementStatus),
    );
    if (statuses && statuses.length > 0) filter.statuses = statuses;
    const assigneeIds = stringArray(raw.assigneeIds);
    if (assigneeIds) filter.assigneeIds = assigneeIds;
    const sprintIds = stringArray(raw.sprintIds);
    if (sprintIds) filter.sprintIds = sprintIds;
    const tags = stringArray(raw.tags);
    if (tags) filter.tags = tags;
    return filter;
}
