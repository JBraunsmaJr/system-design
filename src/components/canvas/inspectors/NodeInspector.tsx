import type { Node } from '@xyflow/react';
import { getNodeType } from '../../../domain/canvas/nodeRegistry';
import { getGroupType } from '../../../domain/canvas/groupRegistry';
import { getShapeType, globalShapeRegistry } from '../../../domain/canvas/shapeRegistry';
import { CODE_LANGUAGES } from '../../../domain/canvas/codeRegistry';
import { IconPicker } from '../IconPicker';
import type { ArchNodeData } from '../../../domain/canvas/types';
import type { ZOrderCommand } from '../../../domain/canvas/zOrder';
import type { RequirementsDocument } from '../../../domain/requirements/requirementsTypes';
import { ZOrderControls } from './ZOrderControls';
import { TagEditor } from './TagEditor';
import { PropertyEditor } from './PropertyEditor';
import { Field, ColorField, LinkedRequirementsField } from './InspectorCommon';

export interface NodeInspectorProps {
  selectedNode: Node<ArchNodeData>;
  onUpdateNode: (id: string, patch: Partial<ArchNodeData>) => void;
  onDeleteNode: (id: string) => void;
  onDrillInto: (id: string) => void;
  requirements: RequirementsDocument;
  onNavigateToRequirement: (itemId: string) => void;
  onZOrderCommand: (command: ZOrderCommand) => void;
}

export function NodeInspector({
  selectedNode,
  onUpdateNode,
  onDeleteNode,
  onDrillInto,
  requirements,
  onNavigateToRequirement,
  onZOrderCommand,
}: NodeInspectorProps) {
  const data = selectedNode.data;

  if (selectedNode.type === 'text') {
    const color = data.textColor ?? '#e7e9ee';
    const fontSize = data.fontSize ?? 16;
    return (
      <aside className="inspector">
        <div className="panel-header">Text</div>

        <Field label="Text">
          <textarea
            rows={4}
            value={data.label}
            onChange={(e) => onUpdateNode(selectedNode.id, { label: e.target.value })}
          />
        </Field>

        <Field label="Color">
          <input
            type="color"
            value={color}
            onChange={(e) => onUpdateNode(selectedNode.id, { textColor: e.target.value })}
          />
        </Field>

        <Field label="Size">
          <select
            value={fontSize}
            onChange={(e) => onUpdateNode(selectedNode.id, { fontSize: Number(e.target.value) })}
          >
            <option value={12}>Small</option>
            <option value={16}>Medium</option>
            <option value={20}>Large</option>
            <option value={28}>X-Large</option>
            <option value={40}>Huge</option>
          </select>
        </Field>
        <p className="inspector__hint" style={{ marginTop: -8 }}>
          Drag a corner handle on the selected annotation to resize its box - text wraps to fit once
          resized, instead of auto-sizing to fit the text.
        </p>

        <LinkedRequirementsField
          nodeId={selectedNode.id}
          linkedRequirementIds={data.linkedRequirementIds}
          onUpdateNode={onUpdateNode}
          requirements={requirements}
          onNavigateToRequirement={onNavigateToRequirement}
        />

        <ZOrderControls onCommand={onZOrderCommand} />

        <button
          type="button"
          className="inspector__delete"
          onClick={() => onDeleteNode(selectedNode.id)}
        >
          Delete text
        </button>
      </aside>
    );
  }

  if (selectedNode.type === 'shape') {
    const fullShapeDef = globalShapeRegistry.getShape(data.nodeType);
    const shapeDef = getShapeType(data.nodeType);
    const fontSize = data.fontSize ?? 16;
    return (
      <aside className="inspector">
        <div className="panel-header">{fullShapeDef?.name ?? shapeDef?.label ?? 'Shape'}</div>

        <Field label="Text">
          <textarea
            rows={2}
            placeholder="(optional label inside the shape)"
            value={data.label}
            onChange={(e) => onUpdateNode(selectedNode.id, { label: e.target.value })}
          />
        </Field>

        <Field label="Text size">
          <select
            value={fontSize}
            onChange={(e) => onUpdateNode(selectedNode.id, { fontSize: Number(e.target.value) })}
          >
            <option value={12}>Small</option>
            <option value={16}>Medium</option>
            <option value={20}>Large</option>
            <option value={28}>X-Large</option>
          </select>
        </Field>

        <ColorField
          value={data.color}
          defaultValue={fullShapeDef?.defaults.color ?? shapeDef?.color ?? '#5B7CFA'}
          onChange={(color) => onUpdateNode(selectedNode.id, { color })}
        />

        <IconPicker
          value={data.icon}
          defaultValue={fullShapeDef?.iconId}
          onChange={(icon) => onUpdateNode(selectedNode.id, { icon })}
        />

        {fullShapeDef?.properties && fullShapeDef.properties.length > 0 && (
          <div className="inspector__custom-properties" style={{ marginTop: 12 }}>
            <span
              className="inspector__section-title"
              style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}
            >
              Shape Properties
            </span>
            {fullShapeDef.properties.map((prop) => {
              const currentVal = data.properties?.[prop.id] ?? prop.defaultValue ?? '';
              return (
                <Field key={prop.id} label={prop.label}>
                  {prop.type === 'select' && prop.options ? (
                    <select
                      value={String(currentVal)}
                      onChange={(e) =>
                        onUpdateNode(selectedNode.id, {
                          properties: { ...(data.properties || {}), [prop.id]: e.target.value },
                        })
                      }
                    >
                      {prop.options.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  ) : prop.type === 'boolean' ? (
                    <input
                      type="checkbox"
                      checked={currentVal === 'true' || currentVal === '1'}
                      onChange={(e) =>
                        onUpdateNode(selectedNode.id, {
                          properties: {
                            ...(data.properties || {}),
                            [prop.id]: e.target.checked ? 'true' : 'false',
                          },
                        })
                      }
                    />
                  ) : prop.type === 'color' ? (
                    <input
                      type="color"
                      value={String(currentVal || '#5B7CFA')}
                      onChange={(e) =>
                        onUpdateNode(selectedNode.id, {
                          properties: { ...(data.properties || {}), [prop.id]: e.target.value },
                        })
                      }
                    />
                  ) : (
                    <input
                      type={prop.type === 'number' ? 'number' : 'text'}
                      value={String(currentVal)}
                      placeholder={prop.description}
                      onChange={(e) =>
                        onUpdateNode(selectedNode.id, {
                          properties: { ...(data.properties || {}), [prop.id]: e.target.value },
                        })
                      }
                    />
                  )}
                </Field>
              );
            })}
          </div>
        )}

        <p className="inspector__hint" style={{ marginTop: 4 }}>
          Double-click the shape on the canvas to edit its text directly.
        </p>

        <LinkedRequirementsField
          nodeId={selectedNode.id}
          linkedRequirementIds={data.linkedRequirementIds}
          onUpdateNode={onUpdateNode}
          requirements={requirements}
          onNavigateToRequirement={onNavigateToRequirement}
        />

        <ZOrderControls onCommand={onZOrderCommand} />

        <button
          type="button"
          className="inspector__delete"
          onClick={() => onDeleteNode(selectedNode.id)}
        >
          Delete shape
        </button>
      </aside>
    );
  }

  if (selectedNode.type === 'code') {
    return (
      <aside className="inspector">
        <div className="panel-header">Code Snippet</div>

        <Field label="Title (optional)">
          <input
            placeholder="e.g. Request payload"
            value={data.label}
            onChange={(e) => onUpdateNode(selectedNode.id, { label: e.target.value })}
          />
        </Field>

        <Field label="Language">
          <select
            value={data.codeLanguage ?? 'json'}
            onChange={(e) => onUpdateNode(selectedNode.id, { codeLanguage: e.target.value })}
          >
            {CODE_LANGUAGES.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </select>
        </Field>

        <ColorField
          value={data.color}
          defaultValue="#22B8CF"
          onChange={(color) => onUpdateNode(selectedNode.id, { color })}
        />

        <p className="inspector__hint" style={{ marginTop: -8 }}>
          Double-click the code on the canvas to edit it directly. Tab inserts indentation instead
          of moving focus.
        </p>

        <LinkedRequirementsField
          nodeId={selectedNode.id}
          linkedRequirementIds={data.linkedRequirementIds}
          onUpdateNode={onUpdateNode}
          requirements={requirements}
          onNavigateToRequirement={onNavigateToRequirement}
        />

        <ZOrderControls onCommand={onZOrderCommand} />

        <button
          type="button"
          className="inspector__delete"
          onClick={() => onDeleteNode(selectedNode.id)}
        >
          Delete code snippet
        </button>
      </aside>
    );
  }

  const isGroup = selectedNode.type === 'group';
  const nodeDef = !isGroup ? getNodeType(data.nodeType) : undefined;
  const groupDef = isGroup ? getGroupType(data.nodeType) : undefined;
  const headerLabel = nodeDef?.label ?? groupDef?.label ?? data.nodeType;
  const defaultColor = nodeDef?.color ?? groupDef?.color ?? '#98A2B3';
  const subCount = data.subDiagramNodeCount ?? data.subDiagram?.nodes.length ?? 0;
  const hasSubDiagram = data.hasSubDiagram ?? subCount > 0;

  return (
    <aside className="inspector">
      <div className="panel-header">{headerLabel}</div>

      <Field label="Label">
        <input
          value={data.label}
          onChange={(e) => onUpdateNode(selectedNode.id, { label: e.target.value })}
        />
      </Field>

      <Field label="Description">
        <textarea
          rows={3}
          value={data.description ?? ''}
          onChange={(e) => onUpdateNode(selectedNode.id, { description: e.target.value })}
        />
      </Field>

      {/* Boundaries carry an icon in their label chip just as typed
          nodes do, so they get the same override. The fallback differs
          per kind: SquareDashed matches GroupNode's own final fallback,
          so clearing the override lands back on exactly what the node
          renders rather than on a different default. */}
      <IconPicker
        value={data.icon}
        defaultValue={
          (isGroup ? groupDef?.icon : nodeDef?.icon) ?? (isGroup ? 'SquareDashed' : 'Box')
        }
        onChange={(icon) => onUpdateNode(selectedNode.id, { icon })}
      />

      <ColorField
        value={data.color}
        defaultValue={defaultColor}
        onChange={(color) => onUpdateNode(selectedNode.id, { color })}
      />

      <PropertyEditor
        properties={data.properties}
        onChange={(properties) => onUpdateNode(selectedNode.id, { properties })}
      />

      <TagEditor tags={data.tags} onChange={(tags) => onUpdateNode(selectedNode.id, { tags })} />

      {!isGroup && (
        <button
          type="button"
          style={{ marginBottom: '16px' }}
          className="inspector__drill"
          onClick={() => onDrillInto(selectedNode.id)}
        >
          {subCount > 0
            ? `Open sub-diagram (${subCount})`
            : hasSubDiagram
              ? 'Open sub-diagram'
              : 'Create sub-diagram'}{' '}
          →
        </button>
      )}

      <LinkedRequirementsField
        nodeId={selectedNode.id}
        linkedRequirementIds={data.linkedRequirementIds}
        onUpdateNode={onUpdateNode}
        requirements={requirements}
        onNavigateToRequirement={onNavigateToRequirement}
      />

      <ZOrderControls onCommand={onZOrderCommand} />

      <button
        type="button"
        className="inspector__delete"
        onClick={() => onDeleteNode(selectedNode.id)}
      >
        {isGroup ? 'Delete boundary' : 'Delete node'}
      </button>
      {isGroup && (
        <p className="inspector__hint">
          Deleting a boundary keeps the nodes inside it - they're released, not deleted.
        </p>
      )}
      {!isGroup && (subCount > 0 || hasSubDiagram) && (
        <p className="inspector__hint">
          Deleting this node also deletes its sub-diagram
          {subCount > 0 ? ` (${subCount} node${subCount === 1 ? '' : 's'} inside)` : ''}.
        </p>
      )}
    </aside>
  );
}
