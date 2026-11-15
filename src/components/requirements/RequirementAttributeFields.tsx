import { useState } from 'react';
import type { RequirementItem } from '../../domain/requirements/requirementsTypes';
import {
  getLifecycleMeta,
  LIFECYCLES,
  ownerMemberPatch,
  ownerNamePatch,
  PRIORITIES,
} from '../../domain/requirements/requirementAttributes';
import { MenuPicker, type MenuOption } from './MenuPicker';

export interface AttributeOption {
  id: string;
  name: string;
}

interface RequirementAttributeFieldsProps {
  item: RequirementItem;
  members: readonly AttributeOption[];
  milestones: readonly AttributeOption[];
  onUpdateItem: (id: string, patch: Partial<RequirementItem>) => void;
}

const NONE = '__none__';
const OTHER_OWNER = '__other__';

const PRIORITY_OPTIONS: MenuOption[] = [
  ...PRIORITIES,
  { id: NONE, label: 'Not set', description: 'No priority' },
];

/**
 * The four values set on a requirement - status, priority, owner, target -
 * as a row of labelled menus, each written the moment it changes.
 *
 * Owner is a team member or, for a stakeholder outside the team, a typed
 * name: "Someone else..." puts a text box beside the menu.
 */
export function RequirementAttributeFields({
  item,
  members,
  milestones,
  onUpdateItem,
}: RequirementAttributeFieldsProps) {
  // Typing a name for someone outside the team: on when one is stored, or
  // when "Someone else..." was just chosen and nothing is typed yet.
  const [isNamingOwner, setIsNamingOwner] = useState(false);
  const [ownerDraft, setOwnerDraft] = useState(item.ownerName ?? '');
  const namingOwner = isNamingOwner || (item.ownerName !== undefined && !item.ownerId);
  const commitOwnerName = () => {
    if (ownerDraft.trim() !== (item.ownerName ?? '')) {
      onUpdateItem(item.id, ownerNamePatch(ownerDraft));
    }
    if (!ownerDraft.trim()) setIsNamingOwner(false);
  };

  const ownerOptions: MenuOption[] = [
    ...members.map((m) => ({ id: m.id, label: m.name })),
    { id: OTHER_OWNER, label: 'Someone else...', description: 'A person or team outside this one' },
    { id: NONE, label: 'No owner' },
  ];
  const targetOptions: MenuOption[] = [
    ...milestones.map((m) => ({ id: m.id, label: m.name })),
    { id: NONE, label: 'No target' },
  ];

  return (
    <div className="requirement-attributes">
      <div className="requirement-attributes__field">
        <span>Status</span>
        <MenuPicker
          label="Status"
          value={getLifecycleMeta(item.lifecycle).id}
          options={LIFECYCLES}
          placeholder="Draft"
          onChange={(id) =>
            onUpdateItem(item.id, { lifecycle: id as RequirementItem['lifecycle'] })
          }
        />
      </div>

      <div className="requirement-attributes__field">
        <span>Priority</span>
        <MenuPicker
          label="Priority"
          value={item.priority ?? ''}
          options={PRIORITY_OPTIONS}
          placeholder="Not set"
          width={150}
          onChange={(id) =>
            onUpdateItem(item.id, {
              priority: id === NONE ? undefined : (id as RequirementItem['priority']),
            })
          }
        />
      </div>

      <div className="requirement-attributes__field">
        <span title="The stakeholder accountable for this: who says whether it is right and whether it has been met">
          Owner
        </span>
        <span className="requirement-attributes__owner">
          <MenuPicker
            label="Owner"
            value={namingOwner ? OTHER_OWNER : (item.ownerId ?? '')}
            options={ownerOptions}
            placeholder="No owner"
            width={210}
            onChange={(id) => {
              if (id === OTHER_OWNER) {
                setOwnerDraft(item.ownerName ?? '');
                setIsNamingOwner(true);
                return;
              }
              setIsNamingOwner(false);
              onUpdateItem(item.id, ownerMemberPatch(id === NONE ? undefined : id));
            }}
          />
          {namingOwner && (
            <input
              type="text"
              className="requirement-attributes__owner-name"
              value={ownerDraft}
              placeholder="Name or team"
              aria-label="Owner's name"
              autoFocus={isNamingOwner}
              onChange={(e) => setOwnerDraft(e.target.value)}
              onBlur={commitOwnerName}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
              }}
            />
          )}
        </span>
      </div>

      <div className="requirement-attributes__field">
        <span title="The milestone this is due for. Milestones are created on the Plan tab.">
          Target
        </span>
        <MenuPicker
          label="Target"
          value={item.targetMilestoneId ?? ''}
          options={targetOptions}
          placeholder={milestones.length === 0 ? 'No milestones yet' : 'No target'}
          width={230}
          onChange={(id) =>
            onUpdateItem(item.id, { targetMilestoneId: id === NONE ? undefined : id })
          }
        />
      </div>
    </div>
  );
}
