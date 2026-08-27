import { useState, type KeyboardEvent } from "react";
import type { Node, Edge } from "@xyflow/react";
import { getNodeType } from "../domain/nodeRegistry";
import { getGroupType } from "../domain/groupRegistry";
import { getShapeType } from "../domain/shapeRegistry";
import { EDGE_TYPES, STYLE_GROUP_LABELS } from "../domain/edgeRegistry";
import type { ArchNodeData, ArchEdgeData } from "../domain/types";

const EDGE_STYLE_GROUP_ORDER = ["sync", "async", "control", "vcs", "blank", "data", "file", "generic"] as const;

interface InspectorProps {
  selectedNode: Node<ArchNodeData> | null;
  selectedEdge: Edge<ArchEdgeData> | null;
  onUpdateNode: (id: string, patch: Partial<ArchNodeData>) => void;
  onUpdateEdge: (id: string, patch: Partial<ArchEdgeData>) => void;
  onDeleteNode: (id: string) => void;
  onDeleteEdge: (id: string) => void;
  onDrillInto: (id: string) => void;
}

export function Inspector({
  selectedNode,
  selectedEdge,
  onUpdateNode,
  onUpdateEdge,
  onDeleteNode,
  onDeleteEdge,
  onDrillInto,
}: InspectorProps) {
  if (!selectedNode && !selectedEdge) {
    return (
      <aside className="inspector">
        <div className="panel-header">Inspector</div>
        <p className="inspector__empty">
          Select a node or edge to edit its label, description, properties, and tags.
        </p>
      </aside>
    );
  }

  if (selectedNode) {
    const data = selectedNode.data;

    if (selectedNode.type === "text") {
      const color = data.textColor ?? "#e7e9ee";
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
            Drag a corner handle on the selected annotation to resize its box - text wraps to
            fit once resized, instead of auto-sizing to fit the text.
          </p>

          <button type="button" className="inspector__delete" onClick={() => onDeleteNode(selectedNode.id)}>
            Delete text
          </button>
        </aside>
      );
    }

    if (selectedNode.type === "shape") {
      const shapeDef = getShapeType(data.nodeType);
      const fontSize = data.fontSize ?? 16;
      return (
        <aside className="inspector">
          <div className="panel-header">{shapeDef?.label ?? "Shape"}</div>

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
            defaultValue={shapeDef?.color ?? "#5B7CFA"}
            onChange={(color) => onUpdateNode(selectedNode.id, { color })}
          />

          <p className="inspector__hint" style={{ marginTop: -8 }}>
            Double-click the shape on the canvas to edit its text directly.
          </p>

          <button type="button" className="inspector__delete" onClick={() => onDeleteNode(selectedNode.id)}>
            Delete shape
          </button>
        </aside>
      );
    }

    const isGroup = selectedNode.type === "group";
    const nodeDef = !isGroup ? getNodeType(data.nodeType) : undefined;
    const groupDef = isGroup ? getGroupType(data.nodeType) : undefined;
    const headerLabel = nodeDef?.label ?? groupDef?.label ?? data.nodeType;
    const defaultColor = nodeDef?.color ?? groupDef?.color ?? "#98A2B3";
    const subCount = data.subDiagram?.nodes.length ?? 0;

    return (
      <aside className="inspector">
        <div className="panel-header">{headerLabel}</div>

        <Field label="Label">
          <input value={data.label} onChange={(e) => onUpdateNode(selectedNode.id, { label: e.target.value })} />
        </Field>

        <Field label="Description">
          <textarea
            rows={3}
            value={data.description ?? ""}
            onChange={(e) => onUpdateNode(selectedNode.id, { description: e.target.value })}
          />
        </Field>

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
          <button type="button" className="inspector__drill" onClick={() => onDrillInto(selectedNode.id)}>
            {subCount > 0 ? `Open sub-diagram (${subCount})` : "Create sub-diagram"} →
          </button>
        )}

        <button type="button" className="inspector__delete" onClick={() => onDeleteNode(selectedNode.id)}>
          {isGroup ? "Delete boundary" : "Delete node"}
        </button>
        {isGroup && (
          <p className="inspector__hint">
            Deleting a boundary keeps the nodes inside it - they're released, not deleted.
          </p>
        )}
        {!isGroup && subCount > 0 && (
          <p className="inspector__hint">
            Deleting this node also deletes its sub-diagram ({subCount} node{subCount === 1 ? "" : "s"} inside).
          </p>
        )}
      </aside>
    );
  }

  const edge = selectedEdge!;
  const data = edge.data as ArchEdgeData;
  const edgeTypeDef = EDGE_TYPES.find((t) => t.id === data.edgeType);
  return (
    <aside className="inspector">
      <div className="panel-header">Edge</div>

      <Field label="Type">
        <select
          value={data.edgeType}
          onChange={(e) => onUpdateEdge(edge.id, { edgeType: e.target.value })}
        >
          {EDGE_STYLE_GROUP_ORDER.map((group) => {
            const options = EDGE_TYPES.filter((t) => t.styleGroup === group);
            if (!options.length) return null;
            return (
              <optgroup key={group} label={STYLE_GROUP_LABELS[group]}>
                {options.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.menuLabel ?? t.label}
                  </option>
                ))}
              </optgroup>
            );
          })}
        </select>
      </Field>

      <ColorField
        value={data.color}
        defaultValue={edgeTypeDef?.color ?? "#98A2B3"}
        onChange={(color) => onUpdateEdge(edge.id, { color })}
      />

      <Field label="Direction">
        <select
          value={data.direction ?? "forward"}
          onChange={(e) => onUpdateEdge(edge.id, { direction: e.target.value as "forward" | "reverse" })}
        >
          <option value="forward">Forward (source → target)</option>
          <option value="reverse">Reverse (target → source)</option>
        </select>
      </Field>
      <p className="inspector__hint" style={{ marginTop: -8 }}>
        Controls which way the arrowhead points, and which way this edge flows when it's animated
        in a scenario step.
      </p>

      <Field label="Label override">
        <input
          value={data.label ?? ""}
          placeholder={edgeTypeDef?.label}
          onChange={(e) => onUpdateEdge(edge.id, { label: e.target.value })}
        />
      </Field>

      <label className="inspector__checkbox">
        <input
          type="checkbox"
          checked={data.hideLabel ?? false}
          onChange={(e) => onUpdateEdge(edge.id, { hideLabel: e.target.checked })}
        />
        <span>Hide label on canvas</span>
      </label>

      <PropertyEditor
        properties={data.properties}
        onChange={(properties) => onUpdateEdge(edge.id, { properties })}
      />

      <button type="button" className="inspector__delete" onClick={() => onDeleteEdge(edge.id)}>
        Delete edge
      </button>
    </aside>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="inspector__field">
      <span>{label}</span>
      {children}
    </label>
  );
}

// Shared by typed/group nodes, edges, and shapes - a color override with a
// "Reset" link that only appears once an override is actually set, so
// there's a clear way back to "just use the type's default color" without
// needing to manually match the exact default hex value.
function ColorField({
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
        <input type="color" value={value ?? defaultValue} onChange={(e) => onChange(e.target.value)} />
        {value && (
          <button type="button" className="color-field__reset" onClick={() => onChange(undefined)}>
            Reset
          </button>
        )}
      </div>
    </Field>
  );
}

function PropertyEditor({
  properties,
  onChange,
}: {
  properties: Record<string, string>;
  onChange: (p: Record<string, string>) => void;
}) {
  const entries = Object.entries(properties);
  return (
    <div className="inspector__field">
      <span>Properties</span>
      {entries.map(([key, value], index) => (
        <div className="property-row" key={index}>
          <input
            value={key}
            placeholder="key"
            onChange={(e) => {
              const next: Record<string, string> = {};
              Object.entries(properties).forEach(([k, v]) => {
                next[k === key ? e.target.value : k] = v;
              });
              onChange(next);
            }}
          />
          <input
            value={value}
            placeholder="value"
            onChange={(e) => onChange({ ...properties, [key]: e.target.value })}
          />
          <button
            type="button"
            className="property-row__remove"
            onClick={() => {
              const next = { ...properties };
              delete next[key];
              onChange(next);
            }}
            aria-label={`Remove ${key || "property"}`}
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        className="property-row__add"
        onClick={() => onChange({ ...properties, [""]: "" })}
      >
        + Add property
      </button>
    </div>
  );
}

// Chip-style tag editor. This is a fully *controlled* component (chips are
// rendered directly from the `tags` prop on every render) - the previous
// version used an uncontrolled `defaultValue` input, which only reads its
// initial value once and then never updates, so it kept showing whatever
// you'd last typed no matter which node/edge you had selected. That's what
// made tags look "global" - it was a stale-input bug, not a shared-data bug.
function TagEditor({ tags, onChange }: { tags: string[]; onChange: (tags: string[]) => void }) {
  const [draft, setDraft] = useState("");

  const commit = () => {
    const value = draft.trim();
    if (value && !tags.includes(value)) {
      onChange([...tags, value]);
    }
    setDraft("");
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      commit();
    } else if (event.key === "Backspace" && draft === "" && tags.length > 0) {
      onChange(tags.slice(0, -1));
    }
  };

  return (
    <Field label="Tags">
      <div className="tag-editor">
        {tags.map((tag) => (
          <span className="tag-chip" key={tag}>
            {tag}
            <button
              type="button"
              onClick={() => onChange(tags.filter((t) => t !== tag))}
              aria-label={`Remove tag ${tag}`}
            >
              ×
            </button>
          </span>
        ))}
        <input
          className="tag-editor__input"
          value={draft}
          placeholder={tags.length === 0 ? "env:prod, team:payments..." : "Add tag..."}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={commit}
        />
      </div>
    </Field>
  );
}
