/**
 * What is set on a requirement rather than written in it: how much it
 * matters, where it stands, who answers for it, and what it is due for.
 *
 *  - Priority: must, should or could.
 *  - Status: draft, in review, approved, implemented. This is the
 *    requirement's own lifecycle and is separate from a work item's status
 *    (to do, in progress, done): a requirement is agreed and then built, a
 *    ticket is worked.
 *  - Owner: the stakeholder accountable for the requirement - the person
 *    who says whether it is right and whether it has been met. Not who
 *    does the work; that is the assignee on a ticket. Either a team member
 *    or, for someone outside the team, a name.
 *  - Target: the milestone it is due for.
 *
 * They apply to the same items verification does (see isVerifiable) and
 * are flat optional fields for the same reason: each is written on its
 * own, so two people changing different ones both keep their change.
 *
 * Pure: no React, no store.
 */
import type {
  RequirementItem,
  RequirementLifecycle,
  RequirementPriority,
} from './requirementsTypes';

export interface PriorityMeta {
  id: RequirementPriority;
  label: string;
  color: string;
  description: string;
}

export const PRIORITIES: PriorityMeta[] = [
  { id: 'must', label: 'Must', color: '#F0578C', description: 'The system fails without it.' },
  {
    id: 'should',
    label: 'Should',
    color: '#F2994A',
    description: 'Important, but there is a way to live without it for now.',
  },
  { id: 'could', label: 'Could', color: '#8b90a0', description: 'Wanted if there is room.' },
];

export function getPriorityMeta(
  priority: RequirementPriority | undefined,
): PriorityMeta | undefined {
  return PRIORITIES.find((p) => p.id === priority);
}

export interface LifecycleMeta {
  id: RequirementLifecycle;
  label: string;
  color: string;
  description: string;
}

export const LIFECYCLES: LifecycleMeta[] = [
  { id: 'draft', label: 'Draft', color: '#8b90a0', description: 'Being written; not yet agreed.' },
  {
    id: 'in-review',
    label: 'In review',
    color: '#F2994A',
    description: 'Written, and waiting for its owner to agree to it.',
  },
  {
    id: 'approved',
    label: 'Approved',
    color: '#0FA36B',
    description: 'Agreed. This is what gets built.',
  },
  {
    id: 'implemented',
    label: 'Implemented',
    color: '#38BDF8',
    description: 'Built. Whether it holds is what verification says.',
  },
];

/** A missing status reads as "draft": nothing is agreed until someone
 * says so. */
export function getLifecycleMeta(lifecycle: RequirementLifecycle | undefined): LifecycleMeta {
  return LIFECYCLES.find((l) => l.id === lifecycle) ?? LIFECYCLES[0];
}

/**
 * The owner's name: the team member `ownerId` points at, or else the name
 * typed for someone outside the team. Undefined when there is no owner, or
 * the member has since been removed and no name was typed.
 */
export function resolveOwnerName(
  item: Pick<RequirementItem, 'ownerId' | 'ownerName'>,
  memberNameById: ReadonlyMap<string, string>,
): string | undefined {
  const member = item.ownerId ? memberNameById.get(item.ownerId) : undefined;
  return member ?? (item.ownerName?.trim() || undefined);
}

/** The patch that makes a team member the owner, clearing a typed name so
 * the two can't disagree. */
export function ownerMemberPatch(memberId: string | undefined): Partial<RequirementItem> {
  return { ownerId: memberId, ownerName: undefined };
}

/** The patch that makes someone outside the team the owner. A blank name
 * clears the owner. */
export function ownerNamePatch(name: string): Partial<RequirementItem> {
  return { ownerId: undefined, ownerName: name.trim() || undefined };
}

/** "Must · Approved · Ana Ruiz · Release 2.4" - the set values in one line,
 * for the export. Parts that aren't set are left out. */
export function describeAttributes(
  item: RequirementItem,
  lookups: {
    memberNameById: ReadonlyMap<string, string>;
    milestoneNameById: ReadonlyMap<string, string>;
  },
): string {
  const owner = resolveOwnerName(item, lookups.memberNameById);
  const target = item.targetMilestoneId
    ? lookups.milestoneNameById.get(item.targetMilestoneId)
    : undefined;
  return [
    getPriorityMeta(item.priority)?.label,
    getLifecycleMeta(item.lifecycle).label,
    owner && `Owner: ${owner}`,
    target && `Target: ${target}`,
  ]
    .filter(Boolean)
    .join(' · ');
}
