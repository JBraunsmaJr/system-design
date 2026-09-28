import type { ReactNode } from 'react';
import type { ArchNodeData } from '../../../domain/canvas/types';
import type { RequirementsDocument } from '../../../domain/requirements/requirementsTypes';
import { RequirementLinker } from '../../requirements/RequirementLinker';

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="inspector__field">
      <span>{label}</span>
      {children}
    </label>
  );
}

// Thin wrapper so each of Inspector's node-type branches only needs to
// pass nodeId/data/onUpdateNode, rather than repeating the same
// linked-ids array-splice logic at all four call sites (text, shape,
// code, and the shared typed/group branch).
export function LinkedRequirementsField({
  nodeId,
  linkedRequirementIds,
  onUpdateNode,
  requirements,
  onNavigateToRequirement,
}: {
  nodeId: string;
  linkedRequirementIds: string[] | undefined;
  onUpdateNode: (id: string, patch: Partial<ArchNodeData>) => void;
  requirements: RequirementsDocument;
  onNavigateToRequirement: (itemId: string) => void;
}) {
  const linkedIds = linkedRequirementIds ?? [];
  return (
    <Field label="Linked requirements">
      <RequirementLinker
        linkedIds={linkedIds}
        doc={requirements}
        onLink={(itemId) => onUpdateNode(nodeId, { linkedRequirementIds: [...linkedIds, itemId] })}
        onUnlink={(itemId) =>
          onUpdateNode(nodeId, { linkedRequirementIds: linkedIds.filter((id) => id !== itemId) })
        }
        onNavigate={onNavigateToRequirement}
      />
    </Field>
  );
}

// Shared by typed/group nodes, edges, and shapes - a color override with a
// "Reset" link that only appears once an override is actually set, so
// there's a clear way back to "just use the type's default color" without
// needing to manually match the exact default hex value.
export function ColorField({
  value,
  defaultValue,
  onChange,
}: {
  value: string | undefined;
  defaultValue: string;
  onChange: (color: string | undefined) => void;
}) {
  return (
    <Field label="Color">
      <div className="color-field">
        <input
          type="color"
          value={value ?? defaultValue}
          onChange={(e) => onChange(e.target.value)}
        />
        {value && (
          <button type="button" className="color-field__reset" onClick={() => onChange(undefined)}>
            Reset
          </button>
        )}
      </div>
    </Field>
  );
}
