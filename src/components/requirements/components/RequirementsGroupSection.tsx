import type { ReactNode } from 'react';
import type { ItemGroup } from '../hooks/useRequirementsFilter';
import type { RequirementItem } from '../../../domain/requirements/requirementsTypes';

export interface RequirementsGroupSectionProps {
  group: ItemGroup;
  renderCard: (item: RequirementItem, options: { sectionKey: string }) => ReactNode;
}

export function RequirementsGroupSection({ group, renderCard }: RequirementsGroupSectionProps) {
  return (
    <section key={group.key} className="requirements-view__group">
      <h3 className="requirements-view__group-title" style={{ color: group.color }}>
        {group.label}
      </h3>
      {group.items.map((item) => renderCard(item, { sectionKey: group.key }))}
    </section>
  );
}
