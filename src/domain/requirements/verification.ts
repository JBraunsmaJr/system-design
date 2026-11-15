/**
 * Verification and acceptance criteria.
 *
 * A requirement says what the system must do; these say how anyone would
 * know it does. Two things, kept deliberately small:
 *
 *  - Acceptance criteria are the task-list lines in an item's description
 *    ("- [ ] ..." and "- [x] ..."). They are read from the Markdown that is
 *    already there rather than stored as a second list, so there is nothing
 *    new to keep in step, and they render, export and merge exactly as the
 *    description does.
 *  - Verification is how the requirement is checked (a method) and where
 *    that stands (a status): two flat fields on the item, written
 *    independently like every other item field so two people changing one
 *    each both keep their change.
 *
 * Only some items are verified - see isVerifiable.
 *
 * Pure: no React, no store.
 */
import type {
  RequirementItem,
  RequirementsDocument,
  VerificationMethod,
  VerificationStatus,
} from './requirementsTypes';
import { BUILT_IN_ITEM_TYPES, isItemWorkable } from './requirementsRegistry';

export interface VerificationMethodMeta {
  id: VerificationMethod;
  label: string;
  description: string;
}

/** The four classic ways a requirement is verified. */
export const VERIFICATION_METHODS: VerificationMethodMeta[] = [
  {
    id: 'test',
    label: 'Test',
    description: 'Run it and compare the result with what is expected.',
  },
  {
    id: 'demonstration',
    label: 'Demonstration',
    description: 'Show it working, without measuring.',
  },
  {
    id: 'inspection',
    label: 'Inspection',
    description: 'Look at the design, code or configuration and confirm it is there.',
  },
  {
    id: 'analysis',
    label: 'Analysis',
    description: 'Reason or calculate from a model, where running it is impractical.',
  },
];

export interface VerificationStatusMeta {
  id: VerificationStatus;
  label: string;
  color: string;
  description: string;
}

export const VERIFICATION_STATUSES: VerificationStatusMeta[] = [
  {
    id: 'not-verified',
    label: 'Not verified',
    color: '#F2994A',
    description: 'Nothing has shown this holds yet.',
  },
  {
    id: 'passing',
    label: 'Verified',
    color: '#0FA36B',
    description: 'Checked by the chosen method, and it holds.',
  },
  {
    id: 'failing',
    label: 'Failing',
    color: '#F0578C',
    description: 'Checked, and it does not hold.',
  },
];

/** A missing status reads as "not verified": nothing is verified until
 * someone says so. */
export function getVerificationStatusMeta(
  status: VerificationStatus | undefined,
): VerificationStatusMeta {
  return VERIFICATION_STATUSES.find((s) => s.id === status) ?? VERIFICATION_STATUSES[0];
}

export function getVerificationMethodMeta(
  method: VerificationMethod | undefined,
): VerificationMethodMeta | undefined {
  return VERIFICATION_METHODS.find((m) => m.id === method);
}

/** The built-in types that state something checkable about the system. A
 * goal is met by requirements, a risk is mitigated, an assumption is
 * accepted, a decision is taken - none of those is verified. */
const VERIFIABLE_BUILT_IN_TYPE_IDS: ReadonlySet<string> = new Set(['requirement', 'constraint']);
const BUILT_IN_TYPE_IDS: ReadonlySet<string> = new Set(BUILT_IN_ITEM_TYPES.map((t) => t.id));

/**
 * Whether `item` is the kind of thing that gets verified: a requirement or
 * a constraint, or an item of a team's own type that isn't work. This is
 * the one place that decides it, so asking a type directly (a per-type
 * setting, like "workable") would only change this function.
 */
export function isVerifiable(doc: RequirementsDocument, item: RequirementItem): boolean {
  if (VERIFIABLE_BUILT_IN_TYPE_IDS.has(item.typeId)) return true;
  if (BUILT_IN_TYPE_IDS.has(item.typeId)) return false;
  return !isItemWorkable(doc, item);
}

export function isVerified(item: Pick<RequirementItem, 'verificationStatus'>): boolean {
  return item.verificationStatus === 'passing';
}

export interface AcceptanceCriteria {
  total: number;
  met: number;
}

/** A task-list line: a list marker, then [ ] or [x], then some text. */
const CRITERION = /^[ \t]*(?:[-*+]|\d+[.)])[ \t]+\[([ xX])\][ \t]+\S/;
const FENCE = /^[ \t]*(```|~~~)/;

/**
 * Counts the acceptance criteria in a description: its task-list lines,
 * and how many are ticked. Lines inside a fenced code block are text, not
 * criteria.
 */
export function parseAcceptanceCriteria(body: string): AcceptanceCriteria {
  const criteria: AcceptanceCriteria = { total: 0, met: 0 };
  let inFence = false;
  for (const line of body.split('\n')) {
    if (FENCE.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const match = CRITERION.exec(line);
    if (!match) continue;
    criteria.total += 1;
    if (match[1] !== ' ') criteria.met += 1;
  }
  return criteria;
}

/** "Test - Verified", "Not verified": what the export and tooltips say. */
export function describeVerification(
  item: Pick<RequirementItem, 'verificationMethod' | 'verificationStatus'>,
): string {
  const method = getVerificationMethodMeta(item.verificationMethod);
  const status = getVerificationStatusMeta(item.verificationStatus);
  return method ? `${method.label} - ${status.label}` : status.label;
}
