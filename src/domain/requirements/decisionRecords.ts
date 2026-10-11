/**
 * Architecture decision records (ADRs).
 *
 * The requirements document already captures goals, constraints, risks and
 * requirements - what the system must do and what limits it - but not the
 * decisions taken in answer to them, which is the part teams most often
 * lose. A Decision is an ordinary requirements item of the built-in
 * "decision" type (prefix ADR), so it gets everything items already have
 * for free: #ADR-1 references, categories, relationships, search, hover
 * previews, and linking from diagram nodes through the same "Linked
 * requirements" field any other item uses. What this module adds is the
 * ADR shape on top of that:
 *
 *  - four sections (context, options considered, decision, consequences),
 *    where the context is the item's own `body` - see RequirementItem;
 *  - a status (proposed, accepted, rejected, deprecated, superseded);
 *  - two relationship types, "Addresses" (a decision answering a
 *    requirement, constraint or risk) and "Supersedes" (a newer decision
 *    replacing an older one), registered with the other built-ins.
 *
 * Pure: no React, no store.
 */
import type {DecisionStatus, RequirementItem, RequirementsDocument} from './requirementsTypes';
import type {ItemMarkdownField} from './requirementsRegistry';

export const DECISION_ITEM_TYPE_ID = 'decision';
export const ADDRESSES_RELATIONSHIP_TYPE_ID = 'addresses';
export const SUPERSEDES_RELATIONSHIP_TYPE_ID = 'supersedes';

export interface DecisionStatusMeta {
    id: DecisionStatus;
    label: string;
    color: string;
    /** One line for the picker's tooltip, so the states read the same way to
     * everyone on the team. */
    description: string;
}

/** Display metadata for the fixed status set - see DecisionStatus. */
export const DECISION_STATUSES: DecisionStatusMeta[] = [
    {
        id: 'proposed',
        label: 'Proposed',
        color: '#8b90a0',
        description: 'Written up for discussion; not yet agreed.',
    },
    {
        id: 'accepted',
        label: 'Accepted',
        color: '#0FA36B',
        description: 'Agreed, and what the system is built to.',
    },
    {
        id: 'rejected',
        label: 'Rejected',
        color: '#F0578C',
        description: 'Considered and turned down. Kept so it is not proposed again unknowingly.',
    },
    {
        id: 'deprecated',
        label: 'Deprecated',
        color: '#F2994A',
        description: 'No longer applies, and nothing replaced it.',
    },
    {
        id: 'superseded',
        label: 'Superseded',
        color: '#64748B',
        description: 'Replaced by a later decision.',
    },
];

/** A missing status reads as "proposed": a decision is a proposal until
 * someone says otherwise, and this keeps an item converted into a decision
 * from needing a write just to have a status. */
export function getDecisionStatusMeta(status: DecisionStatus | undefined): DecisionStatusMeta {
    return DECISION_STATUSES.find((s) => s.id === status) ?? DECISION_STATUSES[0];
}

export function isDecisionItem(item: Pick<RequirementItem, 'typeId'>): boolean {
    return item.typeId === DECISION_ITEM_TYPE_ID;
}

export interface DecisionSection {
    field: ItemMarkdownField;
    label: string;
    /** Shown in the empty editor - a prompt for what belongs here. */
    placeholder: string;
}

/** The sections of a decision, in the order an ADR is read. */
export const DECISION_SECTIONS: readonly DecisionSection[] = [
    {
        field: 'body',
        label: 'Context',
        placeholder:
            'What forces are at play? The problem, the constraints, what made a decision necessary. Type # to reference a requirement, constraint or risk.',
    },
    {
        field: 'decisionOptions',
        label: 'Options considered',
        placeholder: 'The alternatives that were weighed, with their trade-offs.',
    },
    {
        field: 'decisionOutcome',
        label: 'Decision',
        placeholder: 'What was decided, and why this option over the others.',
    },
    {
        field: 'decisionConsequences',
        label: 'Consequences',
        placeholder: 'What becomes easier or harder because of this - good, bad and neutral.',
    },
];

/**
 * The decisions that replaced `itemId`: the "from" side of every
 * Supersedes relationship pointing at it. Used to say "superseded by
 * ADR-7" on the old decision without anyone having to keep that in sync
 * by hand - the relationship is the record, the label is derived.
 */
export function getSupersedingDecisionIds(doc: RequirementsDocument, itemId: string): string[] {
    const existing = new Set(doc.items.map((i) => i.id));
    return doc.relationships
        .filter(
            (r) =>
                r.typeId === SUPERSEDES_RELATIONSHIP_TYPE_ID &&
                r.toItemId === itemId &&
                existing.has(r.fromItemId),
        )
        .map((r) => r.fromItemId);
}

/**
 * An item's written content as one markdown string, for exports and
 * previews that show a single body.
 *
 * For anything but a decision this is just the body, exactly as stored
 * (callers trim where they always have). A decision's
 * sections become bold-labelled paragraphs rather than headings, because
 * every export already puts the item under a heading of its own, and
 * headings here would break that outline (and the PDF's table of
 * contents) apart. Empty sections are left out.
 */
export function composeItemMarkdown(item: RequirementItem): string {
    if (!isDecisionItem(item)) return item.body ?? '';
    const blocks: string[] = [`**Status:** ${getDecisionStatusMeta(item.decisionStatus).label}`];
    for (const section of DECISION_SECTIONS) {
        const text = (item[section.field] ?? '').trim();
        if (text) blocks.push(`**${section.label}**`, text);
    }
    return blocks.join('\n\n');
}

/** Whether any of the item's written content contains `query` (already
 * lower-cased) - the body for every item, plus a decision's sections. */
export function itemTextMatches(item: RequirementItem, lowerQuery: string): boolean {
    if (item.body.toLowerCase().includes(lowerQuery)) return true;
    if (!isDecisionItem(item)) return false;
    return DECISION_SECTIONS.some((s) => (item[s.field] ?? '').toLowerCase().includes(lowerQuery));
}
