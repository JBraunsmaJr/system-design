/**
 * Tags, filters (status / assignee / sprint / tag) and bulk edits in the
 * Requirements view. Run with:
 *
 *   npx tsx --tsconfig tsconfig.app.json src/components/requirements/RequirementsViewFilters.verify.tsx
 */
import {renderToStaticMarkup} from 'react-dom/server';
import React from 'react';
import * as Y from 'yjs';
import {RequirementsView} from './RequirementsView';
import {RequirementCard} from './RequirementCard';
import {RequirementsFilterBar} from './RequirementsFilterBar';
import {BulkEditBar} from './BulkEditBar';
import {BUILT_IN_ITEM_TYPES, BUILT_IN_RELATIONSHIP_TYPES,} from '../../domain/requirements/requirementsRegistry';
import type {RequirementsDocument} from '../../domain/requirements/requirementsTypes';
import {createAdapterRequirementsStore, createLocalRequirementsStore,} from '../../collab/stores/requirementsStore';
import {createYjsRequirementsStore, seedYjsRequirementsDoc,} from '../../collab/stores/yjsRequirementsStore';
import {
    collectTags,
    normalizeTag,
    normalizeTags,
    withTagAdded,
    withTagRemoved,
} from '../../domain/requirements/requirementTags';
import {
    activeFilterCount,
    BACKLOG_FILTER_VALUE,
    isFilterActive,
    itemMatchesFilter,
    normalizeFilter,
    type RequirementsFilter,
    toggleFilterValue,
    UNASSIGNED_FILTER_VALUE,
    UNTAGGED_FILTER_VALUE,
} from '../../domain/requirements/requirementsFilter';
import {bulkPatches} from '../../domain/requirements/requirementsBulkEdit';
import {toMarkdownDocument} from '../../domain/requirements/requirementsExport';
import {loadRequirementsViewPrefs, saveRequirementsViewPrefs,} from '../../domain/requirements/requirementsViewPrefs';
import type {ProgramIncrement} from '../../domain/timeline/programIncrements';
import type {TeamDocument} from '../../domain/timeline/teamTypes';

let failures = 0;

function assert(condition: boolean, message: string) {
    if (condition) {
        console.log(`ok: ${message}`);
    } else {
        failures++;
        console.error(`FAIL: ${message}`);
    }
}

const storage = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => void storage.set(k, v),
    removeItem: (k: string) => void storage.delete(k),
    clear: () => storage.clear(),
    key: () => null,
    length: 0,
} as Storage;

const programIncrements: ProgramIncrement[] = [
    {
        id: 'pi-1',
        name: 'PI 1',
        startDate: '2026-01-05',
        sprints: [
            {id: 'sp-1', name: 'Sprint 1', durationDays: 14},
            {id: 'sp-2', name: 'Sprint 2', durationDays: 14},
        ],
    } as unknown as ProgramIncrement,
];
const team: TeamDocument = {
    members: [
        {id: 'm-ana', name: 'Ana', ptoSpans: []},
        {id: 'm-bo', name: 'Bo', ptoSpans: []},
    ],
    settings: {defaultPointsPerDay: 1, excludeUsHolidays: false, extraDaysOff: []},
};

const doc: RequirementsDocument = {
    itemTypes: BUILT_IN_ITEM_TYPES,
    categories: [{id: 'cat-pay', label: 'Payments', color: '#f00'}],
    relationshipTypes: BUILT_IN_RELATIONSHIP_TYPES,
    items: [
        {
            id: 'REQ-1',
            typeId: 'requirement',
            title: 'Must be PCI compliant',
            body: '',
            tags: ['security'],
        },
        {
            id: 'TICKET-1',
            typeId: 'ticket',
            title: 'Card form',
            body: '',
            status: 'todo',
            sprintId: 'sp-1',
            assigneeId: 'm-ana',
            tags: ['Security', 'frontend'],
        },
        {
            id: 'TICKET-2',
            typeId: 'ticket',
            title: 'Refund job',
            body: '',
            status: 'in-progress',
            sprintId: 'sp-deleted',
        },
        {
            id: 'TICKET-3',
            typeId: 'ticket',
            title: 'Receipt email',
            body: '',
            status: 'done',
            sprintId: 'sp-2',
            assigneeId: 'm-gone',
        },
        // A workable item created before status existed - reads as To Do.
        {id: 'TICKET-4', typeId: 'ticket', title: 'Legacy', body: ''},
    ],
    relationships: [],
    nextSequence: {},
};

const ids = (filter: RequirementsFilter) =>
    doc.items
        .filter((i) =>
            itemMatchesFilter(i, filter, {
                doc,
                existingSprintIds: new Set(['sp-1', 'sp-2']),
                existingMemberIds: new Set(['m-ana', 'm-bo']),
            }),
        )
        .map((i) => i.id)
        .join(',');

console.log('=== Tags ===');
{
    assert(
        normalizeTag('  #Tech   debt ') === 'Tech debt',
        'a tag is trimmed, collapsed, and loses a leading #',
    );
    assert(normalizeTag('   ') === null, 'a blank tag is nothing');
    assert(
        normalizeTags(['a', 'A', ' b ', 3, '', 'c'])?.join('|') === 'a|b|c',
        'normalizing drops non-strings, blanks and case-insensitive duplicates',
    );
    assert(
        normalizeTags('nope') === undefined && normalizeTags([]) === undefined,
        'no tags is undefined',
    );
    const duplicate = withTagAdded(['Security', 'x'], 'SECURITY');
    assert(
        duplicate !== undefined && JSON.stringify(duplicate) === JSON.stringify(['Security', 'x']),
        'adding an existing tag (any case) keeps the tags exactly as they were, first spelling and all',
    );
    assert(withTagAdded(undefined, 'x')?.join() === 'x', 'adds to an untagged item');
    assert(withTagRemoved(['Security', 'x'], 'security')?.join() === 'x', 'removes ignoring case');
    assert(withTagRemoved(['x'], 'x') === undefined, 'removing the last tag leaves no tags');
    assert(
        collectTags(doc.items).join('|') === 'frontend|security',
        'collects each tag once, first spelling, sorted',
    );
    const markdown = toMarkdownDocument('Spec', doc);
    assert(
        markdown.includes('*Tags: Security, frontend*') && !/TICKET-2[^#]*\*Tags:/.test(markdown),
        'the Markdown export lists an item’s tags, and only when it has some',
    );
}

console.log('=== Filter matching ===');
{
    assert(
        ids({}) === 'REQ-1,TICKET-1,TICKET-2,TICKET-3,TICKET-4',
        'an empty filter keeps everything',
    );
    assert(!isFilterActive({}) && !isFilterActive({tags: []}), 'empty filters are inactive');
    assert(
        ids({statuses: ['todo']}) === 'TICKET-1,TICKET-4',
        'status: a missing status reads as To Do; non-work items drop out',
    );
    assert(
        ids({statuses: ['todo', 'done']}) === 'TICKET-1,TICKET-3,TICKET-4',
        'values in one dimension are alternatives',
    );
    assert(ids({assigneeIds: ['m-ana']}) === 'TICKET-1', 'assignee');
    assert(
        ids({assigneeIds: [UNASSIGNED_FILTER_VALUE]}) === 'TICKET-2,TICKET-3,TICKET-4',
        'unassigned includes items assigned to a member who no longer exists',
    );
    assert(ids({sprintIds: ['sp-2']}) === 'TICKET-3', 'sprint');
    assert(
        ids({sprintIds: [BACKLOG_FILTER_VALUE]}) === 'TICKET-2,TICKET-4',
        'backlog includes items pointing at a deleted sprint',
    );
    assert(ids({tags: ['SECURITY']}) === 'REQ-1,TICKET-1', 'tag, ignoring case, any item type');
    assert(ids({tags: [UNTAGGED_FILTER_VALUE]}) === 'TICKET-2,TICKET-3,TICKET-4', 'untagged');
    assert(
        ids({tags: ['security'], statuses: ['todo']}) === 'TICKET-1',
        'dimensions combine with AND',
    );

    let f: RequirementsFilter = {};
    f = toggleFilterValue(f, 'statuses', 'done');
    f = toggleFilterValue(f, 'tags', 'x');
    assert(activeFilterCount(f) === 2, 'toggling adds values');
    f = toggleFilterValue(f, 'tags', 'x');
    assert(
        !('tags' in f) && activeFilterCount(f) === 1,
        'toggling a value off removes an emptied dimension',
    );

    const restored = normalizeFilter({
        statuses: ['done', 'bogus', 7],
        tags: 'x',
        sprintIds: ['sp-1'],
        extra: 1,
    });
    assert(
        JSON.stringify(restored) === JSON.stringify({statuses: ['done'], sprintIds: ['sp-1']}),
        'a stored filter is validated field by field',
    );
    assert(JSON.stringify(normalizeFilter(null)) === '{}', 'garbage reads as no filter');

    saveRequirementsViewPrefs('doc-prefs', {filter: {tags: ['security']}});
    assert(
        loadRequirementsViewPrefs('doc-prefs').filter?.tags?.[0] === 'security',
        'the filter is remembered per document',
    );
}

console.log('=== Bulk patches ===');
{
    const items = doc.items;
    const status = bulkPatches.status(doc, items, 'done');
    assert(
        status.map((u) => u.id).join() === 'TICKET-1,TICKET-2,TICKET-4',
        'status skips non-work items and items already at that status',
    );
    const sprint = bulkPatches.sprint(doc, items, 'sp-2');
    assert(
        sprint.map((u) => u.id).join() === 'TICKET-1,TICKET-2,TICKET-4' &&
        sprint.every((u) => u.patch.sprintId === 'sp-2'),
        'sprint applies to work items not already in it',
    );
    const backlog = bulkPatches.sprint(doc, items, undefined);
    assert(
        backlog.every((u) => 'sprintId' in u.patch && u.patch.sprintId === undefined) &&
        !backlog.some((u) => u.id === 'TICKET-4'),
        'moving to the backlog clears the sprint',
    );
    const category = bulkPatches.category(items, 'cat-pay');
    assert(category.length === items.length, 'category applies to every item type');
    const assignee = bulkPatches.assignee(doc, items, 'm-bo');
    assert(
        assignee.length === 4 && !assignee.some((u) => u.id === 'REQ-1'),
        'assignee only on work items',
    );
    const addTag = bulkPatches.addTag(items, 'security');
    assert(
        addTag.map((u) => u.id).join() === 'TICKET-2,TICKET-3,TICKET-4',
        'adding a tag skips items that already have it (any case)',
    );
    const removeTag = bulkPatches.removeTag(items, 'security');
    assert(
        removeTag.map((u) => u.id).join() === 'REQ-1,TICKET-1' &&
        removeTag[0].patch.tags === undefined &&
        removeTag[1].patch.tags?.join() === 'frontend',
        'removing a tag touches only items that have it',
    );
}

console.log('=== Store: updateItems ===');
{
    const local = createLocalRequirementsStore(doc);
    let notifications = 0;
    local.subscribe(() => notifications++);
    const before = local.getSnapshot();
    local.updateItems([
        {id: 'TICKET-1', patch: {status: 'done'}},
        {id: 'TICKET-2', patch: {status: 'done', tags: ['x']}},
        {id: 'TICKET-1', patch: {sprintId: 'sp-2'}},
        {id: 'MISSING', patch: {status: 'done'}},
    ]);
    const after = local.getSnapshot();
    const t1 = after.items.find((i) => i.id === 'TICKET-1')!;
    assert(notifications === 1, 'a bulk update notifies once');
    assert(t1.status === 'done' && t1.sprintId === 'sp-2', 'patches for one id merge');
    assert(
        after.items.find((i) => i.id === 'REQ-1') === before.items.find((i) => i.id === 'REQ-1'),
        'untouched items keep their identity (cards skip re-rendering)',
    );
    local.updateItems([]);
    assert(notifications === 1, 'an empty bulk update does nothing');

    let snapshot = doc;
    let setCalls = 0;
    const adapter = createAdapterRequirementsStore(
        () => snapshot,
        (updater) => {
            setCalls++;
            snapshot = updater(snapshot);
        },
    );
    adapter.updateItems([
        {id: 'TICKET-1', patch: {status: 'done'}},
        {id: 'TICKET-3', patch: {status: 'todo'}},
    ]);
    assert(setCalls === 1, 'the adapter store makes a bulk update one setSnapshot (one undo step)');

    const ydoc = new Y.Doc();
    seedYjsRequirementsDoc(ydoc, doc);
    const yjs = createYjsRequirementsStore(ydoc);
    assert(
        yjs
            .getSnapshot()
            .items.find((i) => i.id === 'TICKET-1')
            ?.tags?.join() === 'Security,frontend',
        'tags survive seeding a shared document',
    );
    assert(
        !('tags' in yjs.getSnapshot().items.find((i) => i.id === 'TICKET-2')!),
        'an untagged item has no tags key in the snapshot',
    );
    let transactions = 0;
    ydoc.on('afterTransaction', () => transactions++);
    yjs.updateItems([
        {id: 'TICKET-1', patch: {status: 'done'}},
        {id: 'TICKET-2', patch: {status: 'done', tags: ['ops']}},
        {id: 'TICKET-3', patch: {categoryId: 'cat-pay'}},
    ]);
    assert(transactions === 1, 'the shared store applies a bulk update in one transaction');
    const ySnap = yjs.getSnapshot();
    assert(
        ySnap.items.find((i) => i.id === 'TICKET-2')?.status === 'done' &&
        ySnap.items.find((i) => i.id === 'TICKET-2')?.tags?.join() === 'ops' &&
        ySnap.items.find((i) => i.id === 'TICKET-3')?.categoryId === 'cat-pay',
        'every patch lands',
    );
    yjs.updateItem('TICKET-2', {tags: undefined});
    assert(!yjs.getSnapshot().items.find((i) => i.id === 'TICKET-2')?.tags, 'clearing tags works');
    yjs.destroy();
}

console.log('=== View ===');
{
    storage.clear();
    saveRequirementsViewPrefs('doc-filtered', {filter: {tags: ['frontend']}});
    const html = renderToStaticMarkup(
        React.createElement(RequirementsView, {
            requirementsStore: createLocalRequirementsStore(doc),
            programIncrements,
            team,
            documentId: 'doc-filtered',
        }),
    );
    assert(html.includes('requirements-filter-bar'), 'a remembered filter shows the filter bar');
    assert(
        html.includes('data-requirement-id="TICKET-1"') &&
        !html.includes('data-requirement-id="REQ-1"'),
        'only matching items are listed',
    );
    assert(html.includes('1 of 5'), 'the bar says how many items are shown');
    assert(html.includes('Clear filters'), 'the filter can be cleared');
    assert(html.includes('Tag:') && html.includes('frontend'), 'the tag menu names the chosen tag');

    const plain = renderToStaticMarkup(
        React.createElement(RequirementsView, {
            requirementsStore: createLocalRequirementsStore(doc),
            programIncrements,
            team,
            documentId: 'doc-plain',
        }),
    );
    assert(!plain.includes('requirements-filter-bar'), 'no filter bar until asked for');
    assert(
        plain.includes('aria-pressed="false"') && plain.includes('>Select<'),
        'the toolbar offers Filter and Select toggles',
    );
    assert(
        !plain.includes('requirement-card__bulk-check'),
        'cards have no selection checkboxes outside select mode',
    );

    const none = renderToStaticMarkup(
        React.createElement(RequirementsView, {
            requirementsStore: createLocalRequirementsStore(doc),
            programIncrements,
            documentId: 'doc-none',
        }),
    );
    saveRequirementsViewPrefs('doc-none', {filter: {tags: ['nothing-has-this']}});
    const noMatch = renderToStaticMarkup(
        React.createElement(RequirementsView, {
            requirementsStore: createLocalRequirementsStore(doc),
            programIncrements,
            documentId: 'doc-none',
        }),
    );
    assert(!none.includes('match your search and filters'), 'no empty message without a filter');
    assert(
        noMatch.includes('No requirements match your search and filters.'),
        'says when the filter matches nothing',
    );
}

console.log('=== Card ===');
{
    const props = {
        doc,
        programIncrements,
        onUpdateItem: () => {
        },
        onDeleteItem: () => {
        },
        onNavigateToItem: () => {
        },
        onCreateAndAssignCategory: () => {
        },
        onDeleteCategory: () => {
        },
        onAddRelationship: () => null,
        onDeleteRelationship: () => {
        },
    };
    const tagged = renderToStaticMarkup(
        React.createElement(RequirementCard, {...props, item: doc.items[1]}),
    );
    assert(
        tagged.includes('requirement-tags__chip') &&
        tagged.includes('Remove tag Security from TICKET-1') &&
        tagged.includes('Add a tag to TICKET-1'),
        'a card shows its tags with remove buttons, and an add control',
    );
    const selectable = renderToStaticMarkup(
        React.createElement(RequirementCard, {
            ...props,
            item: doc.items[1],
            isBulkSelected: true,
            onToggleBulkSelected: () => {
            },
        }),
    );
    assert(
        selectable.includes('requirement-card__bulk-check') &&
        selectable.includes('checked=""') &&
        selectable.includes('is-bulk-selected'),
        'in select mode a card has a checkbox and shows it is selected',
    );
}

console.log('=== Bars ===');
{
    const bar = renderToStaticMarkup(
        React.createElement(RequirementsFilterBar, {
            filter: {statuses: ['todo']},
            onChange: () => {
            },
            team,
            programIncrements,
            allTags: ['security'],
            shownCount: 2,
            totalCount: 5,
        }),
    );
    assert(
        bar.includes('Status:') &&
        bar.includes('To Do') &&
        bar.includes('Assignee:') &&
        bar.includes('Sprint:'),
        'the filter bar has a menu per dimension, naming what is chosen',
    );
    assert(bar.includes('show work items only'), 'it explains why non-work items vanish');
    const emptyBar = renderToStaticMarkup(
        React.createElement(RequirementsFilterBar, {
            filter: {},
            onChange: () => {
            },
            programIncrements,
            allTags: [],
            shownCount: 5,
            totalCount: 5,
        }),
    );
    assert(
        !/>0</.test(emptyBar) && !emptyBar.includes('Clear filters'),
        'an empty filter shows no count or clear',
    );

    const bulk = renderToStaticMarkup(
        React.createElement(BulkEditBar, {
            doc,
            selectedItems: [doc.items[0]],
            visibleCount: 5,
            team,
            programIncrements,
            allTags: ['security'],
            onSelectAll: () => {
            },
            onClearSelection: () => {
            },
            onApply: () => {
            },
            onExit: () => {
            },
        }),
    );
    assert(
        bulk.includes('1 selected') && bulk.includes('Select all 5'),
        'the bulk bar counts the selection',
    );
    const statusSelect =
        bulk.match(/<select[^>]*aria-label="Set status of selected items"[^>]*>/)?.[0] ?? '';
    assert(
        / disabled=""/.test(statusSelect) && /only work items/i.test(statusSelect),
        'with only non-work items selected, status is disabled and says why',
    );
    const categorySelect =
        bulk.match(/<select[^>]*aria-label="Set category of selected items"[^>]*>/)?.[0] ?? '';
    assert(!/ disabled=""/.test(categorySelect), 'category still applies to them');
    assert(bulk.includes('Remove tag'), 'tags on the selection can be removed');
}

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILURE(S)`);
if (failures > 0) {
    (globalThis as unknown as { process: { exitCode: number } }).process.exitCode = 1;
}
