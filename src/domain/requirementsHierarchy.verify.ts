/**
 * Standalone verification for the requirements hierarchy helpers and the
 * "Parent of" loop check. Run with:
 *
 *   npx tsx src/domain/requirementsHierarchy.verify.ts
 */
import {
  buildEpicTree,
  buildHierarchyIndex,
  countDescendants,
  filterEpicTree,
  flattenEpicTreeMatches,
  isEpicItem,
  type EpicTreeNode,
} from './requirementsHierarchy.ts';
import {
  addRelationship,
  buildChildItemParts,
  BUILT_IN_ITEM_TYPES,
  BUILT_IN_RELATIONSHIP_TYPES,
  PARENT_OF_RELATIONSHIP_TYPE_ID,
  wouldCreateParentCycle,
} from './requirementsRegistry.ts';
import type {
  RequirementItem,
  RequirementRelationship,
  RequirementsDocument,
} from './requirementsTypes.ts';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    (globalThis as unknown as { process: { exitCode: number } }).process.exitCode = 1;
    console.error('FAIL:', msg);
    failures++;
  } else {
    console.log('ok:', msg);
  }
}

function item(id: string, typeId: string, title = id): RequirementItem {
  return { id, typeId, title, body: '' };
}

let relSeq = 0;
function parent(from: string, to: string): RequirementRelationship {
  relSeq++;
  return {
    id: `r${relSeq}`,
    typeId: PARENT_OF_RELATIONSHIP_TYPE_ID,
    fromItemId: from,
    toItemId: to,
  };
}

function makeDoc(
  items: RequirementItem[],
  relationships: RequirementRelationship[],
): RequirementsDocument {
  return {
    itemTypes: BUILT_IN_ITEM_TYPES,
    categories: [],
    relationshipTypes: BUILT_IN_RELATIONSHIP_TYPES,
    items,
    relationships,
    nextSequence: {},
  };
}

function shape(node: EpicTreeNode): string {
  if (node.children.length === 0) return node.item.id;
  return `${node.item.id}(${node.children.map(shape).join(',')})`;
}

// A realistic document: two top-level epics, one nested epic, a ticket
// shared by two epics, a requirement with no epic, and a ticket whose only
// parent is a non-epic item.
const doc = makeDoc(
  [
    item('EPIC-1', 'epic', 'Checkout'),
    item('EPIC-2', 'epic', 'Payments'),
    item('EPIC-3', 'epic', 'Refunds'),
    item('TICKET-1', 'ticket', 'Cart page'),
    item('TICKET-2', 'ticket', 'Card form'),
    item('TICKET-3', 'ticket', 'Shared validation'),
    item('TICKET-4', 'ticket', 'Refund API'),
    item('REQ-1', 'requirement', 'PCI compliance'),
    item('TICKET-5', 'ticket', 'Audit log'),
  ],
  [
    parent('EPIC-1', 'TICKET-1'),
    parent('EPIC-1', 'TICKET-3'),
    parent('EPIC-2', 'TICKET-2'),
    parent('EPIC-2', 'TICKET-3'),
    parent('EPIC-2', 'EPIC-3'),
    parent('EPIC-3', 'TICKET-4'),
    parent('REQ-1', 'TICKET-5'),
    // A dangling relationship to a deleted item must be ignored.
    parent('EPIC-1', 'TICKET-99'),
  ],
);

console.log('=== buildHierarchyIndex ===');
{
  const index = buildHierarchyIndex(doc);
  assert(
    JSON.stringify(index.childrenByParentId.get('EPIC-1')) === '["TICKET-1","TICKET-3"]',
    'children are listed in relationship (creation) order, and a link to a deleted item is dropped',
  );
  assert(
    JSON.stringify(index.parentsByChildId.get('TICKET-3')) === '["EPIC-1","EPIC-2"]',
    'an item with two parents lists both',
  );
}

console.log('=== isEpicItem ===');
{
  const custom = {
    ...doc,
    itemTypes: [
      ...doc.itemTypes,
      {
        id: 'custom-1',
        label: 'Sub-Epic',
        prefix: 'SUB',
        color: '#000',
        isBuiltIn: false,
        isWorkable: false,
      },
    ],
  };
  assert(isEpicItem(custom, item('EPIC-9', 'epic')), 'the built-in Epic type is an epic');
  assert(
    isEpicItem(custom, item('SUB-1', 'custom-1')),
    'a custom type labelled "Sub-Epic" counts as an epic',
  );
  assert(!isEpicItem(custom, item('TICKET-9', 'ticket')), 'a ticket is not an epic');
}

console.log('=== buildEpicTree ===');
{
  const tree = buildEpicTree(doc);
  assert(
    tree.roots.map((r) => r.item.id).join(',') === 'EPIC-1,EPIC-2',
    'only epics with no epic above them are top-level (EPIC-3 is nested under EPIC-2)',
  );
  assert(shape(tree.roots[0]) === 'EPIC-1(TICKET-1,TICKET-3)', 'EPIC-1 holds its two tickets');
  assert(
    shape(tree.roots[1]) === 'EPIC-2(TICKET-2,TICKET-3,EPIC-3(TICKET-4))',
    'EPIC-2 holds its tickets and the nested EPIC-3 with its own ticket',
  );
  const sharedCopies = [tree.roots[0].children[1], tree.roots[1].children[1]];
  assert(
    sharedCopies.every((n) => n.item.id === 'TICKET-3') &&
      sharedCopies[0].key !== sharedCopies[1].key,
    'a ticket under two epics appears under each, with a distinct key per copy',
  );
  assert(
    sharedCopies[0].rootId === 'EPIC-1' && sharedCopies[1].rootId === 'EPIC-2',
    "each copy records the top-level epic it's shown under",
  );
  assert(tree.roots[1].children[2].children[0].depth === 2, 'depth counts from the top-level epic');
  assert(
    tree.unparented.map((i) => i.id).join(',') === 'REQ-1,TICKET-5',
    'items not beneath any epic (including a ticket whose only parent is a requirement) are unparented',
  );
  assert(countDescendants(tree.roots[1]) === 4, 'countDescendants counts every nested occurrence');
}

console.log('=== legacy loops ===');
{
  const loopDoc = makeDoc(
    [item('EPIC-1', 'epic'), item('EPIC-2', 'epic'), item('TICKET-1', 'ticket')],
    [parent('EPIC-1', 'EPIC-2'), parent('EPIC-2', 'EPIC-1'), parent('EPIC-2', 'TICKET-1')],
  );
  const tree = buildEpicTree(loopDoc);
  assert(tree.roots.length === 1, 'epics that sit only inside a loop are promoted to a root');
  assert(
    shape(tree.roots[0]) === 'EPIC-1(EPIC-2(TICKET-1))',
    'expansion stops where an item would appear inside itself',
  );
  assert(tree.unparented.length === 0, 'nothing in a loop goes missing');
}

console.log('=== filterEpicTree / flattenEpicTreeMatches ===');
{
  const tree = buildEpicTree(doc);
  const filtered = filterEpicTree(tree, new Set(['TICKET-4', 'TICKET-3', 'REQ-1']));
  assert(
    filtered.roots.map(shape).join(' | ') ===
      'EPIC-1(TICKET-3) | EPIC-2(TICKET-3,EPIC-3(TICKET-4))',
    'a search keeps matches plus the path of ancestors above them',
  );
  assert(
    filtered.roots[1].isContext === true && filtered.roots[1].children[1].isContext === true,
    'ancestors kept only for context are flagged isContext',
  );
  assert(filtered.roots[0].children[0].isContext === false, 'matched nodes are not context');
  assert(
    filtered.unparented.map((i) => i.id).join(',') === 'REQ-1',
    'unparented items are narrowed to matches',
  );
  assert(
    flattenEpicTreeMatches(filtered)
      .map((i) => i.id)
      .join(',') === 'TICKET-3,TICKET-4,REQ-1',
    'matches are listed in on-screen order, each item once even when shown twice',
  );
  assert(
    flattenEpicTreeMatches(tree).length === doc.items.length,
    'with no search, every item is listed exactly once',
  );
}

console.log('=== wouldCreateParentCycle / addRelationship ===');
{
  assert(wouldCreateParentCycle(doc, 'EPIC-1', 'EPIC-1'), 'an item cannot be its own parent');
  assert(
    wouldCreateParentCycle(doc, 'TICKET-4', 'EPIC-2'),
    'making a grandchild the parent of its grandparent is a loop',
  );
  assert(
    !wouldCreateParentCycle(doc, 'EPIC-1', 'EPIC-3'),
    'giving a nested epic a second parent is fine',
  );

  const rejected = addRelationship(doc, PARENT_OF_RELATIONSHIP_TYPE_ID, 'EPIC-3', 'EPIC-2');
  assert(
    rejected.error !== null && rejected.relationships === doc.relationships,
    'addRelationship refuses a "Parent of" that would make an item its own ancestor',
  );
  const allowed = addRelationship(doc, PARENT_OF_RELATIONSHIP_TYPE_ID, 'EPIC-1', 'EPIC-3');
  assert(
    allowed.error === null && allowed.relationships.length === doc.relationships.length + 1,
    'addRelationship still accepts a valid second parent',
  );
  const relatesLoop = addRelationship(doc, 'relates-to', 'TICKET-4', 'EPIC-2');
  assert(relatesLoop.error === null, 'other non-blocking types are unaffected by the parent check');
}

console.log('=== buildChildItemParts ===');
{
  const parts = buildChildItemParts(doc, 'EPIC-1', 'ticket', 'New work');
  assert(parts !== null, 'builds parts for an existing parent and type');
  if (parts) {
    assert(
      parts.item.id === 'TICKET-6' &&
        parts.item.title === 'New work' &&
        parts.item.status === 'todo',
      'the child gets the next ticket id, its title and the workable default status',
    );
    assert(
      parts.relationship.typeId === PARENT_OF_RELATIONSHIP_TYPE_ID &&
        parts.relationship.fromItemId === 'EPIC-1' &&
        parts.relationship.toItemId === 'TICKET-6',
      'the link runs from the parent to the new child',
    );
  }
  assert(
    buildChildItemParts(doc, 'EPIC-404', 'ticket') === null,
    'a missing parent creates nothing',
  );
  assert(
    buildChildItemParts(doc, 'EPIC-1', 'no-such-type') === null,
    'an unknown type creates nothing',
  );
}

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILURE(S)`);
