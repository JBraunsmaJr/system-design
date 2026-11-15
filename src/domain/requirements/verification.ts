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
const CRITERIA_HEADING =
  /^[ \t]*(?:#{1,6}[ \t]*)?[*_]{0,2}acceptance criteria:?[*_]{0,2}:?[ \t]*$/i;

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

export interface AcceptanceCriterion {
  text: string;
  met: boolean;
}

/**
 * A description split into what it states and what must hold: the prose
 * with the task-list lines taken out, and those lines as criteria. The
 * Requirements view shows the two apart - the statement as text, the
 * criteria as boxes to tick - while the description stays one piece of
 * Markdown underneath.
 */
export function splitAcceptanceCriteria(body: string): {
  statement: string;
  criteria: AcceptanceCriterion[];
} {
  const statement: string[] = [];
  const criteria: AcceptanceCriterion[] = [];
  let inFence = false;
  for (const line of body.split('\n')) {
    if (FENCE.test(line)) inFence = !inFence;
    const match = inFence || FENCE.test(line) ? null : CRITERION.exec(line);
    if (!match) {
      // A heading that only announces the list ("## Acceptance criteria",
      // "**Acceptance criteria:**") would be shown twice: the view gives
      // the criteria their own heading.
      if (!inFence && CRITERIA_HEADING.test(line)) continue;
      statement.push(line);
      continue;
    }
    criteria.push({
      text: line.replace(/^[ \t]*(?:[-*+]|\d+[.)])[ \t]+\[[ xX]\][ \t]+/, '').trimEnd(),
      met: match[1] !== ' ',
    });
  }
  return {
    statement: statement
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim(),
    criteria,
  };
}

/** `body` with its `index`-th criterion ticked or unticked. Only the box
 * changes - the rest of the line and of the description is untouched, so
 * the edit merges cleanly with someone else's change to the prose. */
export function toggleAcceptanceCriterion(body: string, index: number): string {
  let seen = -1;
  let inFence = false;
  return body
    .split('\n')
    .map((line) => {
      if (FENCE.test(line)) {
        inFence = !inFence;
        return line;
      }
      if (inFence || !CRITERION.test(line)) return line;
      seen += 1;
      if (seen !== index) return line;
      return line.replace(/\[([ xX])\]/, (_, mark: string) => (mark === ' ' ? '[x]' : '[ ]'));
    })
    .join('\n');
}

/**
 * `body` with one more unticked criterion: after the last one there is, or
 * at the end of the description when there are none yet. A blank `text`
 * adds nothing.
 */
export function addAcceptanceCriterion(body: string, text: string): string {
  const criterion = text.replace(/\s+/g, ' ').trim();
  if (!criterion) return body;
  const lines = body.split('\n');
  let last = -1;
  let inFence = false;
  lines.forEach((line, index) => {
    if (FENCE.test(line)) inFence = !inFence;
    else if (!inFence && CRITERION.test(line)) last = index;
  });
  if (last >= 0) {
    lines.splice(last + 1, 0, `- [ ] ${criterion}`);
    return lines.join('\n');
  }
  const prose = body.trimEnd();
  return prose ? `${prose}\n\n- [ ] ${criterion}` : `- [ ] ${criterion}`;
}

/** How a verification reads at a glance, and how loud it should be. */
export interface VerificationSummary {
  label: string;
  tone: 'ok' | 'warning' | 'failing' | 'neutral';
}

/**
 * "Test passing", "Inspection", "Test failing", "Test not run", "No
 * method": the one phrase a table row has room for. The method leads
 * because it is what differs between rows that are all fine.
 */
export function summarizeVerification(
  item: Pick<RequirementItem, 'verificationMethod' | 'verificationStatus'>,
): VerificationSummary {
  const method = getVerificationMethodMeta(item.verificationMethod);
  const status = getVerificationStatusMeta(item.verificationStatus).id;
  if (status === 'failing') {
    return { label: method ? `${method.label} failing` : 'Failing', tone: 'failing' };
  }
  if (status === 'passing') {
    if (!method) return { label: 'Verified', tone: 'ok' };
    return { label: method.id === 'test' ? 'Test passing' : method.label, tone: 'ok' };
  }
  return method
    ? { label: `${method.label} not run`, tone: 'neutral' }
    : { label: 'No method', tone: 'warning' };
}

/** "Test - Verified", "Not verified": what the export and tooltips say. */
export function describeVerification(
  item: Pick<RequirementItem, 'verificationMethod' | 'verificationStatus'>,
): string {
  const method = getVerificationMethodMeta(item.verificationMethod);
  const status = getVerificationStatusMeta(item.verificationStatus);
  return method ? `${method.label} - ${status.label}` : status.label;
}
