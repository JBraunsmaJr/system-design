/**
 * Architecture decision records: the built-in Decision type and its
 * relationship types, the ADR sections, status, supersession, exports,
 * search, reference rewriting - and both stores carrying the new fields,
 * including the top-up that gives an already-persisted collaborative
 * document the new built-ins.
 */
import * as Y from 'yjs';
import {
    BUILT_IN_ITEM_TYPES,
    BUILT_IN_RELATIONSHIP_TYPES,
    builtInTypesToAdd,
    updateItemReferencesInItems,
    withMissingBuiltInRelationshipTypes,
    withMissingBuiltInTypes,
} from './requirementsRegistry.ts';
import {
    ADDRESSES_RELATIONSHIP_TYPE_ID,
    composeItemMarkdown,
    DECISION_ITEM_TYPE_ID,
    DECISION_SECTIONS,
    getDecisionStatusMeta,
    getSupersedingDecisionIds,
    isDecisionItem,
    itemTextMatches,
    SUPERSEDES_RELATIONSHIP_TYPE_ID,
} from './decisionRecords.ts';
import {toMarkdownDocument} from './requirementsExport.ts';
import {
    EMPTY_REQUIREMENTS_DOCUMENT,
    type RequirementItem,
    type RequirementItemType,
    type RequirementsDocument,
} from './requirementsTypes.ts';
import {createLocalRequirementsStore} from '../../collab/stores/requirementsStore.ts';
import {
    createYjsRequirementsStore,
    seedYjsRequirementsDoc,
    topUpBuiltInTypes,
} from '../../collab/stores/yjsRequirementsStore.ts';

let failures = 0;

function assert(condition: boolean, message: string) {
    if (condition) console.log(`  ✓ ${message}`);
    else {
        failures++;
        console.error(`  FAIL: ${message}`);
    }
}

const freshDoc = (): RequirementsDocument => ({
    ...EMPTY_REQUIREMENTS_DOCUMENT,
    itemTypes: BUILT_IN_ITEM_TYPES,
    relationshipTypes: BUILT_IN_RELATIONSHIP_TYPES,
});

console.log('Built-in types');
{
    const decision = BUILT_IN_ITEM_TYPES.find((t) => t.id === DECISION_ITEM_TYPE_ID);
    assert(decision?.prefix === 'ADR', 'Decision is built in, with the ADR prefix');
    assert(decision?.isWorkable === false, 'a decision is not work: it has no to-do status');
    const addresses = BUILT_IN_RELATIONSHIP_TYPES.find(
        (t) => t.id === ADDRESSES_RELATIONSHIP_TYPE_ID,
    );
    const supersedes = BUILT_IN_RELATIONSHIP_TYPES.find(
        (t) => t.id === SUPERSEDES_RELATIONSHIP_TYPE_ID,
    );
    assert(
        addresses?.label === 'Addresses' && addresses.inverseLabel === 'Is addressed by',
        '"Addresses" reads correctly from both ends',
    );
    assert(
        supersedes?.label === 'Supersedes' && supersedes.inverseLabel === 'Is superseded by',
        '"Supersedes" reads correctly from both ends',
    );
    assert(
        !addresses?.isBlocking && !supersedes?.isBlocking,
        'neither is blocking - they record reasoning and history, not an order of work',
    );
}

console.log('Older documents gain the new built-ins');
{
    const withoutDecision = BUILT_IN_ITEM_TYPES.filter((t) => t.id !== DECISION_ITEM_TYPE_ID);
    const merged = withMissingBuiltInTypes(withoutDecision);
    assert(
        merged.some((t) => t.id === DECISION_ITEM_TYPE_ID),
        'a file saved before Decision existed gains it on open',
    );
    const rels = withMissingBuiltInRelationshipTypes(
        BUILT_IN_RELATIONSHIP_TYPES.filter((t) => t.id !== SUPERSEDES_RELATIONSHIP_TYPE_ID),
    );
    assert(
        rels.some((t) => t.id === SUPERSEDES_RELATIONSHIP_TYPE_ID),
        'and likewise the new relationship types',
    );

    const customAdr: RequirementItemType = {
        id: 'custom-1',
        label: 'ADR',
        prefix: 'adr',
        color: '#000000',
        isBuiltIn: false,
        isWorkable: false,
    };
    const withCustom = withMissingBuiltInTypes([...withoutDecision, customAdr]);
    assert(
        !withCustom.some((t) => t.id === DECISION_ITEM_TYPE_ID),
        'but not where a custom type already owns the ADR prefix (case-insensitively) - ids stay unambiguous',
    );
    assert(withCustom.includes(customAdr), 'and that custom type is left exactly as it was');
    assert(builtInTypesToAdd(BUILT_IN_ITEM_TYPES).length === 0, 'a current document needs nothing');
}

console.log('Status and sections');
{
    assert(getDecisionStatusMeta(undefined).id === 'proposed', 'no status reads as Proposed');
    assert(getDecisionStatusMeta('superseded').label === 'Superseded', 'statuses have labels');
    assert(
        DECISION_SECTIONS.map((s) => s.label).join('|') ===
        'Context|Options considered|Decision|Consequences',
        'the four ADR sections, in reading order',
    );
    assert(DECISION_SECTIONS[0].field === 'body', "the context is the item's own body");
    assert(isDecisionItem({typeId: 'decision'}), 'a decision is recognized by its type');
    assert(!isDecisionItem({typeId: 'requirement'}), 'and nothing else is');
}

const adr: RequirementItem = {
    id: 'ADR-1',
    typeId: 'decision',
    title: 'Use OIDC for sign-in',
    body: 'We need SSO; see #CON-2.',
    decisionStatus: 'accepted',
    decisionOptions: '- SAML\n- OIDC',
    decisionOutcome: 'OIDC, because every IdP we support speaks it.',
    decisionConsequences: '',
};

console.log('Exports and previews');
{
    const md = composeItemMarkdown(adr);
    assert(md.startsWith('**Status:** Accepted'), 'a decision export leads with its status');
    assert(
        md.includes('**Context**\n\nWe need SSO') && md.includes('**Decision**\n\nOIDC'),
        'each written section appears under its label',
    );
    assert(!md.includes('Consequences'), 'an empty section is left out');
    assert(!/^#/m.test(md), "sections never become headings that would break the export's outline");

    const req: RequirementItem = {id: 'REQ-1', typeId: 'requirement', title: '', body: '  x  '};
    assert(composeItemMarkdown(req) === '  x  ', 'any other item exports its body byte for byte');

    const doc: RequirementsDocument = {...freshDoc(), items: [adr]};
    const exported = toMarkdownDocument('Doc', doc);
    assert(
        exported.includes('## Decisions') && exported.includes('**Options considered**'),
        'the requirements markdown export carries the decision sections',
    );
}

console.log('Search');
{
    assert(itemTextMatches(adr, 'every idp'), 'search finds text in the Decision section');
    assert(itemTextMatches(adr, 'saml'), 'and in Options considered');
    assert(
        !itemTextMatches({...adr, typeId: 'requirement'}, 'saml'),
        "a converted-away item's hidden sections don't produce phantom matches",
    );
}

console.log('Supersession');
{
    const doc: RequirementsDocument = {
        ...freshDoc(),
        items: [adr, {...adr, id: 'ADR-2'}],
        relationships: [
            {id: 'r1', typeId: 'supersedes', fromItemId: 'ADR-2', toItemId: 'ADR-1'},
            {id: 'r2', typeId: 'supersedes', fromItemId: 'ADR-9', toItemId: 'ADR-1'},
            {id: 'r3', typeId: 'relates-to', fromItemId: 'ADR-2', toItemId: 'ADR-1'},
        ],
    };
    const by = getSupersedingDecisionIds(doc, 'ADR-1');
    assert(
        by.length === 1 && by[0] === 'ADR-2',
        'ADR-1 is superseded by ADR-2 only - not by a deleted item, nor by an unrelated link',
    );
    assert(getSupersedingDecisionIds(doc, 'ADR-2').length === 0, 'and ADR-2 by nothing');
}

console.log('References in decision sections follow renames');
{
    const items = updateItemReferencesInItems(
        [{...adr, decisionOptions: 'Compare with #REQ-3', decisionOutcome: 'Meets #ref:REQ-3'}],
        'REQ-3',
        'TICKET-1',
    );
    assert(items[0].decisionOptions === 'Compare with #TICKET-1', 'in Options considered');
    assert(items[0].decisionOutcome === 'Meets #ref:TICKET-1', 'and in the Decision');
    const untouched = [{...adr}];
    assert(
        updateItemReferencesInItems(untouched, 'REQ-3', 'TICKET-1')[0] === untouched[0],
        'an item with nothing to rewrite keeps its identity (card memoization depends on it)',
    );
}

console.log('Local store');
{
    const store = createLocalRequirementsStore(freshDoc());
    const req = store.addItem('requirement');
    const id = store.addItem('decision');
    assert(id === 'ADR-1', 'a new decision is ADR-1');
    const created = store.getSnapshot().items.find((i) => i.id === id);
    assert(created?.status === undefined, 'with no to-do status');
    store.updateItem(id, {
        decisionStatus: 'accepted',
        decisionOptions: 'see #' + req,
    });
    assert(
        store.addRelationship('addresses', id, req) === null,
        'a decision can address a requirement',
    );
    const newReqId = store.convertItemType(req, 'ticket');
    const after = store.getSnapshot().items.find((i) => i.id === id);
    assert(
        after?.decisionOptions === `see #${newReqId}`,
        "converting the requirement rewrites the reference in the decision's options",
    );
}

console.log('Collaborative store');
{
    const doc = new Y.Doc();
    seedYjsRequirementsDoc(doc, {
        ...freshDoc(),
        items: [adr],
        nextSequence: {decision: 2},
    });
    const store = createYjsRequirementsStore(doc);
    const seeded = store.getSnapshot().items.find((i) => i.id === 'ADR-1');
    assert(
        seeded?.decisionStatus === 'accepted' &&
        seeded.decisionOutcome === adr.decisionOutcome &&
        seeded.decisionOptions === adr.decisionOptions,
        'seeding from a file keeps every decision field',
    );
    store.updateItem('ADR-1', {decisionConsequences: 'One more IdP config per tenant.'});
    assert(
        store.getSnapshot().items.find((i) => i.id === 'ADR-1')?.decisionConsequences ===
        'One more IdP config per tenant.',
        'and a section edit lands as its own field',
    );

    // Two peers editing different sections of the same decision both keep
    // their change - the reason the sections are flat fields.
    const peerA = new Y.Doc();
    const peerB = new Y.Doc();
    Y.applyUpdate(peerA, Y.encodeStateAsUpdate(doc));
    Y.applyUpdate(peerB, Y.encodeStateAsUpdate(doc));
    createYjsRequirementsStore(peerA).updateItem('ADR-1', {decisionOptions: 'A wrote this'});
    createYjsRequirementsStore(peerB).updateItem('ADR-1', {decisionOutcome: 'B wrote this'});
    Y.applyUpdate(peerA, Y.encodeStateAsUpdate(peerB));
    const merged = createYjsRequirementsStore(peerA)
        .getSnapshot()
        .items.find((i) => i.id === 'ADR-1');
    assert(
        merged?.decisionOptions === 'A wrote this' && merged.decisionOutcome === 'B wrote this',
        'concurrent edits to different sections both survive the merge',
    );

    const req = store.addItem('requirement');
    store.updateItem('ADR-1', {decisionOutcome: `Meets #${req}`});
    const newId = store.convertItemType(req, 'ticket');
    assert(
        store.getSnapshot().items.find((i) => i.id === 'ADR-1')?.decisionOutcome === `Meets #${newId}`,
        'converting a referenced item rewrites the reference inside a decision section',
    );
}

console.log('Topping up a persisted collaborative document');
{
    const oldTypes = BUILT_IN_ITEM_TYPES.filter((t) => t.id !== DECISION_ITEM_TYPE_ID);
    const oldRels = BUILT_IN_RELATIONSHIP_TYPES.filter(
        (t) => t.id !== ADDRESSES_RELATIONSHIP_TYPE_ID && t.id !== SUPERSEDES_RELATIONSHIP_TYPE_ID,
    );
    const doc = new Y.Doc();
    seedYjsRequirementsDoc(doc, {
        ...EMPTY_REQUIREMENTS_DOCUMENT,
        itemTypes: oldTypes,
        relationshipTypes: oldRels,
    });
    const store = createYjsRequirementsStore(doc);
    assert(topUpBuiltInTypes(doc) === true, 'a document from before Decision gets topped up');
    const snap = store.getSnapshot();
    assert(
        snap.itemTypes.some((t) => t.id === DECISION_ITEM_TYPE_ID) &&
        snap.relationshipTypes.some((t) => t.id === SUPERSEDES_RELATIONSHIP_TYPE_ID),
        'and offers Decision, Addresses and Supersedes afterwards',
    );
    assert(topUpBuiltInTypes(doc) === false, 'a second top-up is a no-op');

    const empty = new Y.Doc();
    assert(
        topUpBuiltInTypes(empty) === false && empty.getMap('itemTypes').size === 0,
        'an empty replica (a joiner still waiting for sync) is never written to',
    );

    // Two peers topping up the same document while disconnected.
    const a = new Y.Doc();
    const b = new Y.Doc();
    seedYjsRequirementsDoc(a, {
        ...EMPTY_REQUIREMENTS_DOCUMENT,
        itemTypes: oldTypes,
        relationshipTypes: oldRels,
    });
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    topUpBuiltInTypes(a);
    topUpBuiltInTypes(b);
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    const mergedTypes = createYjsRequirementsStore(a).getSnapshot().itemTypes;
    assert(
        mergedTypes.filter((t) => t.id === DECISION_ITEM_TYPE_ID).length === 1,
        'two peers topping up offline still end with one Decision type',
    );
}

if (failures > 0) {
    console.error(`\n${failures} assertion(s) failed`);
    (globalThis as unknown as { process: { exitCode: number } }).process.exitCode = 1;
} else {
    console.log('\nAll decision record checks passed.');
}
