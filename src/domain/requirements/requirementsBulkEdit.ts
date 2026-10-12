import type {RequirementItem, RequirementsDocument} from './requirementsTypes';
import {isItemWorkable} from './requirementsRegistry';
import {withTagAdded, withTagRemoved} from './requirementTags';

/**
 * Bulk edits in the Requirements view, as the patches they make - see
 * RequirementsStore.updateItems, which applies a whole list as one undo
 * step.
 */
export type BulkItemUpdate = { id: string; patch: Partial<RequirementItem> };

/**
 * The patches a bulk change makes. Pure, so what each action does to a
 * mixed selection is easy to check: status, sprint and assignee only apply
 * to WORKABLE items (the same ones whose cards show those pickers); a
 * category and tags apply to everything. Items the change wouldn't alter
 * are left out, so the edit touches only what it changes.
 */
export const bulkPatches = {
    status(
        doc: RequirementsDocument,
        items: RequirementItem[],
        status: RequirementItem['status'],
    ): BulkItemUpdate[] {
        return items
            .filter((i) => isItemWorkable(doc, i) && (i.status ?? 'todo') !== status)
            .map((i) => ({id: i.id, patch: {status}}));
    },
    sprint(
        doc: RequirementsDocument,
        items: RequirementItem[],
        sprintId: string | undefined,
    ): BulkItemUpdate[] {
        return items
            .filter((i) => isItemWorkable(doc, i) && i.sprintId !== sprintId)
            .map((i) => ({id: i.id, patch: {sprintId}}));
    },
    assignee(
        doc: RequirementsDocument,
        items: RequirementItem[],
        assigneeId: string | undefined,
    ): BulkItemUpdate[] {
        return items
            .filter((i) => isItemWorkable(doc, i) && i.assigneeId !== assigneeId)
            .map((i) => ({id: i.id, patch: {assigneeId}}));
    },
    category(items: RequirementItem[], categoryId: string | undefined): BulkItemUpdate[] {
        return items
            .filter((i) => i.categoryId !== categoryId)
            .map((i) => ({id: i.id, patch: {categoryId}}));
    },
    addTag(items: RequirementItem[], tag: string): BulkItemUpdate[] {
        return items.flatMap((i) => {
            const tags = withTagAdded(i.tags, tag);
            return (tags?.length ?? 0) === (i.tags?.length ?? 0) ? [] : [{id: i.id, patch: {tags}}];
        });
    },
    removeTag(items: RequirementItem[], tag: string): BulkItemUpdate[] {
        return items.flatMap((i) => {
            const tags = withTagRemoved(i.tags, tag);
            return (tags?.length ?? 0) === (i.tags?.length ?? 0) ? [] : [{id: i.id, patch: {tags}}];
        });
    },
};
