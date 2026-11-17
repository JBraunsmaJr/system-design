import type { ReactNode } from 'react';
import {
  percentOf,
  type RequirementsCoverage,
} from '../../domain/requirements/requirementsCoverage';

interface RequirementsCoverageBarProps {
  coverage: RequirementsCoverage;
  /** Shown at the right end: the gap filters. */
  children?: ReactNode;
}

interface Measure {
  key: string;
  label: string;
  part: number;
  whole: number;
  tone: 'accent' | 'violet' | 'success';
  title: string;
}

/**
 * How complete the document is, above the list: how many descriptive items
 * are on the diagram, how many requirements have acceptance criteria and
 * are verified, how much of the work is done. The numbers only report; the
 * gap filters beside them (passed as children) are what narrow the view to
 * the items still missing.
 */
export function RequirementsCoverageBar({ coverage, children }: RequirementsCoverageBarProps) {
  if (coverage.total === 0) return null;
  const measures: Measure[] = [];
  if (coverage.descriptive > 0) {
    measures.push({
      key: 'diagram',
      label: 'On the diagram',
      part: coverage.onDiagram,
      whole: coverage.descriptive,
      tone: 'accent',
      title:
        'Requirements, goals and other descriptive items that a component on the diagram is linked to. Work items and epics are not counted.',
    });
  }
  if (coverage.verifiable > 0) {
    measures.push({
      key: 'criteria',
      label: 'Acceptance criteria',
      part: coverage.withCriteria,
      whole: coverage.verifiable,
      tone: 'violet',
      title:
        'Requirements and constraints whose description has at least one task-list line ("- [ ] ...") saying what must hold.',
    });
    measures.push({
      key: 'verified',
      label: 'Verified',
      part: coverage.verified,
      whole: coverage.verifiable,
      tone: 'success',
      title: 'Requirements and constraints marked verified.',
    });
  }
  if (coverage.workable > 0) {
    measures.push({
      key: 'done',
      label: 'Work done',
      part: coverage.done,
      whole: coverage.workable,
      tone: 'success',
      title: 'Work items (tickets and the like) marked done.',
    });
  }

  return (
    <div className="requirements-coverage" role="group" aria-label="Coverage">
      <span className="requirements-coverage__total">
        {coverage.total} {coverage.total === 1 ? 'item' : 'items'}
      </span>
      {measures.map((m) => (
        <span key={m.key} className="requirements-coverage__measure" title={m.title}>
          <span className="requirements-coverage__label">{m.label}</span>
          <span className="requirements-coverage__numbers">
            {m.part}
            <span className="requirements-coverage__of">/{m.whole}</span>
          </span>
          <span
            className={`requirements-coverage__bar requirements-coverage__bar--${m.tone}`}
            aria-hidden
          >
            <span style={{ width: `${percentOf(m.part, m.whole)}%` }} />
          </span>
        </span>
      ))}
      {children}
    </div>
  );
}
