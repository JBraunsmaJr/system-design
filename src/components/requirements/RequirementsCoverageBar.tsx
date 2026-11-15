import {
  percentOf,
  type RequirementsCoverage,
} from '../../domain/requirements/requirementsCoverage';
import type { RequirementGap } from '../../domain/requirements/requirementsFilter';

interface RequirementsCoverageBarProps {
  coverage: RequirementsCoverage;
  /** The gaps the view is currently narrowed to. */
  activeGaps: readonly RequirementGap[];
  onToggleGap: (gap: RequirementGap) => void;
}

interface Measure {
  key: string;
  label: string;
  part: number;
  whole: number;
  tone: 'accent' | 'violet' | 'success';
  /** The gap this measure narrows to when clicked, with what to call the
   * items that have it. Left out for a measure that only reports. */
  gap?: RequirementGap;
  gapLabel?: string;
  title: string;
}

/**
 * How complete the document is, above the list: how many descriptive items
 * are on the diagram, how many items have a description, how much of the
 * work is done. The first two are buttons that narrow the view to the
 * items still missing - the number is only useful if the gap is one click
 * away.
 */
export function RequirementsCoverageBar({
  coverage,
  activeGaps,
  onToggleGap,
}: RequirementsCoverageBarProps) {
  if (coverage.total === 0) return null;
  const measures: Measure[] = [];
  if (coverage.descriptive > 0) {
    measures.push({
      key: 'diagram',
      label: 'On the diagram',
      part: coverage.onDiagram,
      whole: coverage.descriptive,
      tone: 'accent',
      gap: 'not-on-diagram',
      gapLabel: 'not on the diagram',
      title:
        'Requirements, goals and other descriptive items that a component on the diagram is linked to. Work items such as tickets are not counted.',
    });
  }
  measures.push({
    key: 'described',
    label: 'Described',
    part: coverage.described,
    whole: coverage.total,
    tone: 'violet',
    gap: 'no-description',
    gapLabel: 'with no description',
    title: 'Items that have a description.',
  });
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
      {measures.map((m) => {
        const missing = m.whole - m.part;
        const body = (
          <>
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
            {m.gap && missing > 0 && (
              <span className="requirements-coverage__missing">{missing} missing</span>
            )}
          </>
        );
        const gap = m.gap;
        if (!gap || missing === 0) {
          return (
            <span key={m.key} className="requirements-coverage__measure" title={m.title}>
              {body}
            </span>
          );
        }
        const active = activeGaps.includes(gap);
        return (
          <button
            key={m.key}
            type="button"
            className={`requirements-coverage__measure requirements-coverage__measure--button${
              active ? ' is-active' : ''
            }`}
            aria-pressed={active}
            onClick={() => onToggleGap(gap)}
            title={`${m.title} Click to ${active ? 'show everything again' : `show only the ${missing} ${m.gapLabel}`}.`}
          >
            {body}
          </button>
        );
      })}
    </div>
  );
}
