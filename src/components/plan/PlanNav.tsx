import { PLAN_SECTIONS, type PlanSection } from '../../app/planNavigation';

interface PlanNavProps {
  section: PlanSection;
  onSelect: (section: PlanSection) => void;
}

/**
 * The Plan tab's sections: Board, Gantt, Dependencies, Team.
 *
 * Links in a nav, not an ARIA tablist: each section is a separate view with
 * its own toolbar below, and `aria-current` says which one is showing
 * without implying the arrow-key behavior a tablist promises.
 */
export function PlanNav({ section, onSelect }: PlanNavProps) {
  return (
    <nav className="plan-nav" aria-label="Plan sections">
      {PLAN_SECTIONS.map(({ id, label, hint }) => (
        <button
          key={id}
          type="button"
          className={`plan-nav__item${id === section ? ' is-active' : ''}`}
          aria-current={id === section ? 'page' : undefined}
          title={hint}
          onClick={() => onSelect(id)}
        >
          {label}
        </button>
      ))}
    </nav>
  );
}
