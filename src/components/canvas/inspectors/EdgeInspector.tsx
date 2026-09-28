import type { Edge } from '@xyflow/react';
import { EDGE_TYPES, STYLE_GROUP_LABELS } from '../../../domain/canvas/edgeRegistry';
import type { ArchEdgeData, ArchEdgeDataPatch } from '../../../domain/canvas/types';
import { PropertyEditor } from './PropertyEditor';
import { Field, ColorField } from './InspectorCommon';

const EDGE_STYLE_GROUP_ORDER = [
  'sync',
  'async',
  'control',
  'vcs',
  'blank',
  'data',
  'file',
  'generic',
] as const;

export interface EdgeInspectorProps {
  selectedEdge: Edge<ArchEdgeData>;
  onUpdateEdge: (id: string, patch: ArchEdgeDataPatch) => void;
  onClearEdgeWaypoints: (edgeId: string) => void;
  onRemoveEdgeWaypoint?: (edgeId: string, waypointId: string) => void;
  onDeleteEdge: (id: string) => void;
}

export function EdgeInspector({
  selectedEdge,
  onUpdateEdge,
  onClearEdgeWaypoints,
  onRemoveEdgeWaypoint,
  onDeleteEdge,
}: EdgeInspectorProps) {
  const edge = selectedEdge;
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
        defaultValue={edgeTypeDef?.color ?? '#98A2B3'}
        onChange={(color) => onUpdateEdge(edge.id, { color })}
      />

      <Field label="Direction">
        <select
          value={data.direction ?? 'forward'}
          onChange={(e) =>
            onUpdateEdge(edge.id, { direction: e.target.value as ArchEdgeData['direction'] })
          }
        >
          <option value="forward">Forward (source → target)</option>
          <option value="reverse">Reverse (target → source)</option>
          <option value="both">Bi-directional (source ↔ target)</option>
        </select>
      </Field>
      <p className="inspector__hint" style={{ marginTop: -8 }}>
        Controls which end(s) carry an arrowhead, and which way this edge flows when it's animated
        in a scenario step. A bi-directional edge has no single flow direction, so it animates back
        and forth instead.
      </p>

      <Field label="Label override">
        <input
          value={data.label ?? ''}
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

      {(data.labelAnchorT !== undefined || data.labelOffsetX || data.labelOffsetY) && (
        <button
          type="button"
          className="color-field__reset"
          style={{ marginBottom: 16 }}
          onClick={() =>
            onUpdateEdge(edge.id, {
              labelAnchorT: undefined,
              labelOffsetX: undefined,
              labelOffsetY: undefined,
            })
          }
        >
          Reset label position
        </button>
      )}

      {(data.waypoints?.length ?? 0) > 0 && (
        <div className="inspector__field">
          <span>Bends / Waypoints ({data.waypoints!.length})</span>
          <div className="waypoint-list">
            {data.waypoints!.map((wp, index) => (
              <div className="waypoint-row" key={wp.id}>
                <span className="waypoint-row__label">
                  Bend {index + 1}
                  <span className="waypoint-row__coords">
                    ({Math.round(wp.x)}, {Math.round(wp.y)})
                  </span>
                </span>
                {onRemoveEdgeWaypoint && (
                  <button
                    type="button"
                    className="waypoint-row__remove"
                    onClick={() => onRemoveEdgeWaypoint(edge.id, wp.id)}
                    title={`Remove Bend ${index + 1}`}
                    aria-label={`Remove Bend ${index + 1}`}
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
          </div>
          <button
            type="button"
            className="color-field__reset"
            style={{ marginTop: 6, marginBottom: 8 }}
            onClick={() => onClearEdgeWaypoints(edge.id)}
          >
            Straighten edge (remove all bends)
          </button>
          <p className="inspector__hint" style={{ marginTop: 0 }}>
            Bends are pinned to the canvas rather than to either end. Double-click, right-click, or
            Alt-click any bend handle on the canvas, or click × above, to remove individual
            waypoints.
          </p>
        </div>
      )}

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
