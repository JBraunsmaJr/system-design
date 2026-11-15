import { useState } from 'react';
import type { RequirementItem } from '../../domain/requirements/requirementsTypes';
import {
  getLifecycleMeta,
  getPriorityMeta,
  LIFECYCLES,
  ownerMemberPatch,
  ownerNamePatch,
  PRIORITIES,
} from '../../domain/requirements/requirementAttributes';

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

const OTHER_OWNER = '__other__';

/**
 * The four values set on a requirement - status, priority, owner, target -
 * as a row of labelled menus, each written the moment it changes. Shared
 * by the table's open row and the split view's page.
 *
 * Owner is a team member or, for a stakeholder outside the team, a typed
 * name: "Someone else..." turns the menu's neighbour into a text box.
 */
export function RequirementAttributeFields({
  item,
  members,
  milestones,
  onUpdateItem,
}: RequirementAttributeFieldsProps) {
  const lifecycle = getLifecycleMeta(item.lifecycle);
  const priority = getPriorityMeta(item.priority);
  // Typing a name for someone outside the team: on when one is stored, or
  // when "Someone else..." was just chosen and nothing is typed yet.
  const [isNamingOwner, setIsNamingOwner] = useState(false);
  const [ownerDraft, setOwnerDraft] = useState(item.ownerName ?? '');
  const namingOwner = isNamingOwner || (item.ownerName !== undefined && !item.ownerId);
  const ownerValue = namingOwner
    ? OTHER_OWNER
    : item.ownerId && members.some((m) => m.id === item.ownerId)
      ? item.ownerId
      : '';
  const targetValue =
    item.targetMilestoneId && milestones.some((m) => m.id === item.targetMilestoneId)
      ? item.targetMilestoneId
      : '';
  const commitOwnerName = () => {
    if (ownerDraft.trim() !== (item.ownerName ?? '')) {
      onUpdateItem(item.id, ownerNamePatch(ownerDraft));
    }
    if (!ownerDraft.trim()) setIsNamingOwner(false);
  };

  return (
    <div className="requirement-attributes">
      <label className="requirement-attributes__field">
        <span>Status</span>
        <span className="requirement-attributes__control">
          <span
            className="requirement-attributes__dot requirement-attributes__dot--ring"
            style={{ borderColor: lifecycle.color }}
            aria-hidden
          />
          <select
            value={lifecycle.id}
            title={lifecycle.description}
            onChange={(e) =>
              onUpdateItem(item.id, { lifecycle: e.target.value as RequirementItem['lifecycle'] })
            }
          >
            {LIFECYCLES.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </select>
        </span>
      </label>

      <label className="requirement-attributes__field">
        <span>Priority</span>
        <span className="requirement-attributes__control">
          <span
            className="requirement-attributes__dot"
            style={{ background: priority?.color ?? 'transparent' }}
            aria-hidden
          />
          <select
            value={priority?.id ?? ''}
            title={priority?.description ?? 'No priority set'}
            onChange={(e) =>
              onUpdateItem(item.id, {
                priority: (e.target.value || undefined) as RequirementItem['priority'],
              })
            }
          >
            <option value="">Not set</option>
            {PRIORITIES.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </span>
      </label>

      <label className="requirement-attributes__field">
        <span>Owner</span>
        <span className="requirement-attributes__control">
          <select
            value={ownerValue}
            title="The stakeholder accountable for this: who says whether it is right and whether it has been met"
            onChange={(e) => {
              const value = e.target.value;
              if (value === OTHER_OWNER) {
                setOwnerDraft('');
                setIsNamingOwner(true);
                return;
              }
              setIsNamingOwner(false);
              onUpdateItem(item.id, ownerMemberPatch(value || undefined));
            }}
          >
            <option value="">No owner</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
            <option value={OTHER_OWNER}>Someone else...</option>
          </select>
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
      </label>

      <label className="requirement-attributes__field">
        <span>Target</span>
        <span className="requirement-attributes__control">
          <select
            value={targetValue}
            title="The milestone this is due for"
            onChange={(e) =>
              onUpdateItem(item.id, { targetMilestoneId: e.target.value || undefined })
            }
          >
            <option value="">{milestones.length === 0 ? 'No milestones yet' : 'No target'}</option>
            {milestones.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </span>
      </label>
    </div>
  );
}
