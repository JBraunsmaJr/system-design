import type { RequirementsDocument } from './requirementsTypes';
import { isItemWorkable } from './requirementsRegistry';
import { isExpectedOnDiagram, itemHasGap } from './requirementsFilter';

/**
 * How complete the requirements document is, as three fractions the
 * Requirements view shows above the list. Counted over every item, not the
 * filtered ones: narrowing the view shouldn't make the document look more
 * finished than it is.
 */
export interface RequirementsCoverage {
  total: number;
  /** Items with a body. */
  described: number;
  /** Items expected on the diagram: descriptive ones, not work or epics. */
  descriptive: number;
  /** Descriptive items some component is linked to. */
  onDiagram: number;
  /** Work items, and how many of them are done. */
  workable: number;
  done: number;
}

export function computeCoverage(
  doc: RequirementsDocument,
  linkedItemIds: ReadonlySet<string>,
): RequirementsCoverage {
  const coverage: RequirementsCoverage = {
    total: doc.items.length,
    described: 0,
    descriptive: 0,
    onDiagram: 0,
    workable: 0,
    done: 0,
  };
  const context = { doc, linkedItemIds };
  for (const item of doc.items) {
    if (!itemHasGap(item, 'no-description', context)) coverage.described += 1;
    if (isItemWorkable(doc, item)) {
      coverage.workable += 1;
      if (item.status === 'done') coverage.done += 1;
    }
    if (isExpectedOnDiagram(doc, item)) {
      coverage.descriptive += 1;
      if (!itemHasGap(item, 'not-on-diagram', context)) coverage.onDiagram += 1;
    }
  }
  return coverage;
}

/** `part` of `whole` as a whole percentage; 100 when there is nothing to
 * count, so an empty measure reads as complete rather than as a gap. */
export function percentOf(part: number, whole: number): number {
  return whole === 0 ? 100 : Math.round((part / whole) * 100);
}
