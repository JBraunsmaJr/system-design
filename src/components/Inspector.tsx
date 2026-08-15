import type { Node, Edge } from "@xyflow/react";
import { getNodeType } from "../domain/nodeRegistry";
import { getGroupType } from "../domain/groupRegistry";
import { EDGE_TYPES } from "../domain/edgeRegistry";
import type { ArchNodeData, ArchEdgeData } from "../domain/types";

interface InspectorProps {
  selectedNode: Node<ArchNodeData> | null;
  selectedEdge: Edge<ArchEdgeData> | null;
  onUpdateNode: (id: string, patch: Partial<ArchNodeData>) => void;
  onUpdateEdge: (id: string, patch: Partial<ArchEdgeData>) => void;
  onDeleteNode: (id: string) => void;
  onDeleteEdge: (id: string) => void;
}

export function Inspector({
  selectedNode,
  selectedEdge,
  onUpdateNode,
  onUpdateEdge,
  onDeleteNode,
  onDeleteEdge,
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
    const isGroup = selectedNode.type === "group";
    const nodeDef = !isGroup ? getNodeType(data.nodeType) : undefined;
    const groupDef = isGroup ? getGroupType(data.nodeType) : undefined;
    const headerLabel = nodeDef?.label ?? groupDef?.label ?? data.nodeType;

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

        <PropertyEditor
          properties={data.properties}
          onChange={(properties) => onUpdateNode(selectedNode.id, { properties })}
        />

        <TagEditor tags={data.tags} onChange={(tags) => onUpdateNode(selectedNode.id, { tags })} />

        <button type="button" className="inspector__delete" onClick={() => onDeleteNode(selectedNode.id)}>
          {isGroup ? "Delete boundary" : "Delete node"}
        </button>
        {isGroup && (
          <p className="inspector__hint">
            Deleting a boundary keeps the nodes inside it - they're released, not deleted.
          </p>
        )}
      </aside>
    );
  }

  const edge = selectedEdge!;
  const data = edge.data as ArchEdgeData;
  return (
    <aside className="inspector">
      <div className="panel-header">Edge</div>

      <Field label="Traffic type">
        <select
          value={data.edgeType}
          onChange={(e) => onUpdateEdge(edge.id, { edgeType: e.target.value })}
        >
          {EDGE_TYPES.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
      </Field>

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
          placeholder={EDGE_TYPES.find((t) => t.id === data.edgeType)?.label}
          onChange={(e) => onUpdateEdge(edge.id, { label: e.target.value })}
        />
      </Field>

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

function TagEditor({ tags, onChange }: { tags: string[]; onChange: (tags: string[]) => void }) {
  return (
    <Field label="Tags">
      <input
        placeholder="env:prod, team:payments"
        defaultValue={tags.join(", ")}
        onBlur={(e) =>
          onChange(
            e.target.value
              .split(",")
              .map((t) => t.trim())
              .filter(Boolean)
          )
        }
      />
    </Field>
  );
}
