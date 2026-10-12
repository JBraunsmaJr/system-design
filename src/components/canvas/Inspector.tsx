import {type KeyboardEvent, useEffect, useState} from 'react';
import {ExternalLink, FileText, X} from 'lucide-react';
import type {Edge, Node} from '@xyflow/react';
import {getNodeType} from '../../domain/canvas/nodeRegistry';
import {getGroupType} from '../../domain/canvas/groupRegistry';
import {getShapeType, globalShapeRegistry} from '../../domain/canvas/shapeRegistry';
import {CODE_LANGUAGES} from '../../domain/canvas/codeRegistry';
import {EDGE_TYPES, resolveEdgeRouting, resolveEdgeStrokeWidth,} from '../../domain/canvas/edgeRegistry';
import {IconPicker} from './IconPicker';
import {
    ColorField,
    EdgeRoutingField,
    EdgeStrokeWidthField,
    EdgeTypeSelect,
    Field,
    LockField,
    ZOrderControls,
} from './InspectorFields';
import {type MultiSelectionActions, MultiSelectionInspector} from './MultiSelectionInspector';
import {RequirementLinker} from '../requirements/RequirementLinker';
import type {ArchEdgeData, ArchEdgeDataPatch, ArchNodeData} from '../../domain/canvas/types';
import type {ZOrderCommand} from '../../domain/canvas/zOrder';
import type {RequirementsDocument} from '../../domain/requirements/requirementsTypes';
import {getDecisionStatusMeta, isDecisionItem} from '../../domain/requirements/decisionRecords';
import {markdownExcerpt} from '../../common/utils/markdownExcerpt';
import {
    linkedDocumentHref,
    normalizeLinkedDocument,
    parseDocumentIdInput,
    resolveLinkedDocument,
} from '../../domain/canvas/documentLinks';
import type {LinkableDocumentList} from '../../collab/sync/linkableDocuments';

interface InspectorProps {
  selectedNode: Node<ArchNodeData> | null;
  selectedEdge: Edge<ArchEdgeData> | null;
  onUpdateNode: (id: string, patch: Partial<ArchNodeData>) => void;
  onUpdateEdge: (id: string, patch: ArchEdgeDataPatch) => void;
  /** Drops every bend from an edge, returning it to automatic routing.
   * Its own callback rather than an onUpdateEdge patch because
   * waypoints deliberately aren't patchable - see ArchEdgeDataPatch. */
  onClearEdgeWaypoints: (edgeId: string) => void;
  onRemoveEdgeWaypoint?: (edgeId: string, waypointId: string) => void;
  onDeleteNode: (id: string) => void;
  onDeleteEdge: (id: string) => void;
  onDrillInto: (id: string) => void;
  requirements: RequirementsDocument;
  onNavigateToRequirement: (itemId: string) => void;
  onZOrderCommand: (command: ZOrderCommand) => void;
    /** The document open in this tab - never offered as a link target. */
    currentDocId?: string;
    /** The documents a node can link to - this browser's and the
     * workspace's - for the "Linked document" picker. Read when a node is
     * selected (and when the tab regains focus) rather than held as App
     * state, so the catalogue costs nothing until someone actually looks at
     * a node. Without it the field isn't shown. */
    listDocuments?: () => Promise<LinkableDocumentList>;
    /** Every selected node and edge. When more than one thing is selected
     * and `multiSelection` is given, the Inspector edits all of them at
     * once instead of showing only the first. */
    selectedNodes?: Node<ArchNodeData>[];
    selectedEdges?: Edge<ArchEdgeData>[];
    multiSelection?: MultiSelectionActions;
}

export function Inspector({
  selectedNode,
  selectedEdge,
  onClearEdgeWaypoints,
  onRemoveEdgeWaypoint,
  onUpdateNode,
  onUpdateEdge,
  onDeleteNode,
  onDeleteEdge,
  onDrillInto,
  requirements,
  onNavigateToRequirement,
  onZOrderCommand,
                              currentDocId,
                              listDocuments,
                              selectedNodes,
                              selectedEdges,
                              multiSelection,
}: InspectorProps) {
    const selectionCount = (selectedNodes?.length ?? 0) + (selectedEdges?.length ?? 0);
    if (multiSelection && selectionCount > 1) {
        return (
            <MultiSelectionInspector
                nodes={selectedNodes ?? []}
                edges={selectedEdges ?? []}
                actions={multiSelection}
                requirements={requirements}
                onNavigateToRequirement={onNavigateToRequirement}
                onZOrderCommand={onZOrderCommand}
            />
        );
    }

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
            Drag a corner handle on the selected annotation to resize its box - text wraps to fit
            once resized, instead of auto-sizing to fit the text.
          </p>

          <LinkedRequirementsField
            nodeId={selectedNode.id}
            linkedRequirementIds={data.linkedRequirementIds}
            onUpdateNode={onUpdateNode}
            requirements={requirements}
            onNavigateToRequirement={onNavigateToRequirement}
          />

          <ZOrderControls onCommand={onZOrderCommand} />
            <NodeLockField node={selectedNode} onUpdateNode={onUpdateNode}/>

          <button
            type="button"
            className="inspector__delete"
            disabled={data.locked === true}
            title={data.locked ? 'Unlock to delete' : undefined}
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
                style={{ fontSize: 12, fontWeight: 600, color: 'var(--chrome-text-dim)' }}
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

            {listDocuments && (
                <LinkedDocumentField
                    nodeId={selectedNode.id}
                    linkedDocument={data.linkedDocument}
                    onUpdateNode={onUpdateNode}
                    currentDocId={currentDocId}
                    listDocuments={listDocuments}
                />
            )}

          <ZOrderControls onCommand={onZOrderCommand} />
            <NodeLockField node={selectedNode} onUpdateNode={onUpdateNode}/>

          <button
            type="button"
            className="inspector__delete"
            disabled={data.locked === true}
            title={data.locked ? 'Unlock to delete' : undefined}
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
            <NodeLockField node={selectedNode} onUpdateNode={onUpdateNode}/>

          <button
            type="button"
            className="inspector__delete"
            disabled={data.locked === true}
            title={data.locked ? 'Unlock to delete' : undefined}
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

          {!isGroup && (data.unwiredPortCount ?? 0) > 0 && (
              <p className="inspector__hint inspector__hint--warning">
                  {data.unwiredPortCount} connection{data.unwiredPortCount === 1 ? '' : 's'} to this node{' '}
                  {data.unwiredPortCount === 1 ? "isn't" : "aren't"} wired to anything inside its
                  sub-diagram. Open it and drag from the port on its edge to the node that handles it.
              </p>
          )}

        <LinkedRequirementsField
          nodeId={selectedNode.id}
          linkedRequirementIds={data.linkedRequirementIds}
          onUpdateNode={onUpdateNode}
          requirements={requirements}
          onNavigateToRequirement={onNavigateToRequirement}
        />

          {listDocuments && (
              <LinkedDocumentField
                  nodeId={selectedNode.id}
                  linkedDocument={data.linkedDocument}
                  onUpdateNode={onUpdateNode}
                  currentDocId={currentDocId}
                  listDocuments={listDocuments}
              />
          )}

        <ZOrderControls onCommand={onZOrderCommand} />
          <NodeLockField node={selectedNode} onUpdateNode={onUpdateNode}/>

        <button
          type="button"
          className="inspector__delete"
          disabled={data.locked === true}
          title={data.locked ? 'Unlock to delete' : undefined}
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

  const edge = selectedEdge!;
  const data = edge.data as ArchEdgeData;
  const edgeTypeDef = EDGE_TYPES.find((t) => t.id === data.edgeType);
  return (
    <aside className="inspector">
      <div className="panel-header">Edge</div>

      <Field label="Type">
          <EdgeTypeSelect
          value={data.edgeType}
          onChange={(edgeType) => onUpdateEdge(edge.id, {edgeType})}
          />
      </Field>

      <ColorField
        value={data.color}
        defaultValue={edgeTypeDef?.color ?? '#98A2B3'}
        onChange={(color) => onUpdateEdge(edge.id, { color })}
      />

        <EdgeStrokeWidthField
            value={resolveEdgeStrokeWidth(data.strokeWidth)}
            onChange={(strokeWidth) => onUpdateEdge(edge.id, {strokeWidth})}
        />

        <EdgeRoutingField
            value={resolveEdgeRouting(data.routing)}
            onChange={(routing) => onUpdateEdge(edge.id, {routing})}
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

function NodeLockField({
                           node,
                           onUpdateNode,
                       }: {
    node: Node<ArchNodeData>;
    onUpdateNode: (id: string, patch: Partial<ArchNodeData>) => void;
}) {
  return (
      <LockField
          locked={node.data.locked === true}
          // Absent rather than false when unlocked - see onSetLocked.
          onChange={(locked) => onUpdateNode(node.id, {locked: locked ? true : undefined})}
      />
  );
}

// Thin wrapper so each of Inspector's node-type branches only needs to
// pass nodeId/data/onUpdateNode, rather than repeating the same
// linked-ids array-splice logic at all four call sites (text, shape,
// code, and the shared typed/group branch).
function LinkedRequirementsField({
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
      <>
          <Field label="Linked requirements">
              <RequirementLinker
                  linkedIds={linkedIds}
                  doc={requirements}
                  onLink={(itemId) =>
                      onUpdateNode(nodeId, {linkedRequirementIds: [...linkedIds, itemId]})
                  }
                  onUnlink={(itemId) =>
                      onUpdateNode(nodeId, {linkedRequirementIds: linkedIds.filter((id) => id !== itemId)})
                  }
                  onNavigate={onNavigateToRequirement}
              />
          </Field>
          <LinkedDecisionsSummary
              linkedIds={linkedIds}
              requirements={requirements}
              onNavigateToRequirement={onNavigateToRequirement}
          />
      </>
  );
}

/**
 * "Why is this built this way?", answered on the node itself: every
 * decision record linked to it, with its status and what was decided.
 * Linking happens through the ordinary requirement linker above - a
 * decision is just another item - so this only reads. Rejected and
 * superseded decisions are listed last and dimmed: still history worth
 * finding, but not the reason the node looks the way it does today.
 */
function LinkedDecisionsSummary({
                                    linkedIds,
                                    requirements,
                                    onNavigateToRequirement,
                                }: {
    linkedIds: string[];
    requirements: RequirementsDocument;
    onNavigateToRequirement: (itemId: string) => void;
}) {
    const decisions = linkedIds
        .map((id) => requirements.items.find((i) => i.id === id))
        .filter((item): item is NonNullable<typeof item> => !!item && isDecisionItem(item));
    if (decisions.length === 0) return null;
    const typeColor =
        requirements.itemTypes.find((t) => t.id === decisions[0].typeId)?.color ?? undefined;
    const isHistory = (status: string) => status === 'rejected' || status === 'superseded';
    const ordered = [...decisions].sort(
        (a, b) =>
            Number(isHistory(getDecisionStatusMeta(a.decisionStatus).id)) -
            Number(isHistory(getDecisionStatusMeta(b.decisionStatus).id)),
    );
    return (
        <div className="inspector__decisions">
            <span className="inspector__decisions-title">Why it's built this way</span>
            {ordered.map((item) => {
                const status = getDecisionStatusMeta(item.decisionStatus);
                const summary = markdownExcerpt(item.decisionOutcome?.trim() || item.body, 140);
                return (
                    <button
                        key={item.id}
                        type="button"
                        className={`inspector__decision${isHistory(status.id) ? ' is-history' : ''}`}
                        style={{borderLeftColor: typeColor}}
                        onClick={() => onNavigateToRequirement(item.id)}
                        title={`Go to ${item.id}`}
                    >
            <span className="inspector__decision-head">
              <span className="inspector__decision-id" style={{color: typeColor}}>
                {item.id}
              </span>
              <span className="inspector__decision-title">{item.title || 'Untitled'}</span>
              <span className="inspector__decision-status" style={{color: status.color}}>
                {status.label}
              </span>
            </span>
                        {summary && <span className="inspector__decision-summary">{summary}</span>}
                    </button>
                );
            })}
        </div>
    );
}

/**
 * Points this node at another document - the box for a shared platform
 * opening that platform's own document. See domain/canvas/documentLinks.ts.
 *
 * The picker offers this browser's documents and the workspace documents it
 * can read (collab/sync/linkableDocuments.ts), never the one open here. For
 * anything else - a document shared by link, or a workspace that can't be
 * reached right now - a document id or editor link can be entered directly.
 * An existing link to a document neither source lists still shows and still
 * opens: a document arrives by its id wherever it exists.
 */
function LinkedDocumentField({
                                 nodeId,
                                 linkedDocument,
                                 onUpdateNode,
                                 currentDocId,
                                 listDocuments,
                             }: {
    nodeId: string;
    linkedDocument: unknown;
    onUpdateNode: (id: string, patch: Partial<ArchNodeData>) => void;
    currentDocId: string | undefined;
    listDocuments: () => Promise<LinkableDocumentList>;
}) {
    const [list, setList] = useState<LinkableDocumentList | null>(null);
    const [isEnteringId, setIsEnteringId] = useState(false);
    const [idInput, setIdInput] = useState('');

    // Loaded when a node is selected, and again whenever this tab regains
    // focus - the usual way a document gets created or renamed is in another
    // tab, and the picker shouldn't need the node reselected to see it.
    useEffect(() => {
        let cancelled = false;
        // Responses can arrive out of order (a slow workspace read, then a
        // quick one after a focus); only the latest request may land.
        let latest = 0;
        const load = () => {
            const request = ++latest;
            listDocuments().then(
                (next) => {
                    if (!cancelled && request === latest) setList(next);
                },
                () => {
                    if (!cancelled && request === latest)
                        setList({documents: [], workspaceUnavailable: false});
                },
            );
        };
        const onVisibilityChange = () => {
            if (document.visibilityState === 'visible') load();
        };
        load();
        window.addEventListener('focus', load);
        document.addEventListener('visibilitychange', onVisibilityChange);
        return () => {
            cancelled = true;
            window.removeEventListener('focus', load);
            document.removeEventListener('visibilitychange', onVisibilityChange);
        };
    }, [listDocuments, nodeId]);

    // Leaving a half-typed id behind when the selection moves on would
    // offer it to the next node.
    const [idFormNodeId, setIdFormNodeId] = useState(nodeId);
    if (idFormNodeId !== nodeId) {
        setIdFormNodeId(nodeId);
        setIsEnteringId(false);
        setIdInput('');
    }

    const documents = list?.documents ?? null;
    const ref = normalizeLinkedDocument(linkedDocument);
    const resolved = ref ? resolveLinkedDocument(ref, documents ?? []) : null;
    const candidates = (documents ?? []).filter((d) => d.docId !== currentDocId);
    const localCandidates = candidates.filter((d) => d.source !== 'workspace');
    const workspaceCandidates = candidates.filter((d) => d.source === 'workspace');

    const linkTo = (docId: string, title: string) =>
        onUpdateNode(nodeId, {linkedDocument: {docId, title}});

    const enteredId = parseDocumentIdInput(idInput);
    const idError =
        idInput.trim() === ''
            ? null
            : !enteredId
                ? 'Not a document id or editor link.'
                : enteredId === currentDocId
                    ? "That's the document open here."
                    : null;
    const submitId = () => {
        if (!enteredId || idError) return;
        const known = documents?.find((d) => d.docId === enteredId);
        linkTo(enteredId, known?.title ?? '');
        setIsEnteringId(false);
        setIdInput('');
    };

    if (resolved) {
        const href = linkedDocumentHref(window.location.href, resolved.ref.docId);
        // A div rather than Field's <label>: a click anywhere in a label
        // activates its first control, which here would be "Unlink".
        return (
            <div className="inspector__field">
                <span>Linked document</span>
                <div className="inspector__doc-link">
          <span className="inspector__doc-link-pill">
            <FileText size={12}/>
            <span className="inspector__doc-link-title" title={resolved.title}>
              {resolved.title}
            </span>
            <button
                type="button"
                className="inspector__doc-link-remove"
                onClick={() => onUpdateNode(nodeId, {linkedDocument: undefined})}
                aria-label="Unlink document"
                title="Unlink document"
            >
              <X size={10}/>
            </button>
          </span>
                    {href && (
                        <a
                            className="inspector__doc-link-open"
                            href={href}
                            target="_blank"
                            rel="noopener noreferrer"
                        >
                            Open <ExternalLink size={11}/>
                        </a>
                    )}
                </div>
                {documents && !resolved.isKnownHere && (
                    <p className="inspector__hint">
                        {list?.workspaceUnavailable
                            ? "Not in this browser, and the workspace can't be reached right now to check. It still opens wherever the document exists."
                            : 'Neither this browser nor your workspace lists that document. It still opens wherever it exists - for example from a link someone shared.'}
                    </p>
                )}
            </div>
        );
    }

    return (
        <div className="inspector__field">
            <span>Linked document</span>
            {isEnteringId ? (
                <div className="inspector__doc-id">
                    <input
                        autoFocus
                        aria-label="Document id or editor link"
                        placeholder="Document id, or a link to it"
                        value={idInput}
                        onChange={(e) => setIdInput(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') submitId();
                            if (e.key === 'Escape') {
                                setIsEnteringId(false);
                                setIdInput('');
                            }
                        }}
                    />
                    <div className="inspector__doc-id-actions">
                        <button type="button" disabled={!enteredId || Boolean(idError)} onClick={submitId}>
                            Link
                        </button>
                        <button
                            type="button"
                            onClick={() => {
                                setIsEnteringId(false);
                                setIdInput('');
                            }}
                        >
                            Cancel
                        </button>
                    </div>
                    {idError && <p className="inspector__hint">{idError}</p>}
                </div>
            ) : (
                <>
                    <select
                        aria-label="Link to another document"
                        value=""
                        disabled={!documents || candidates.length === 0}
                        onChange={(e) => {
                            const target = candidates.find((d) => d.docId === e.target.value);
                            if (target) linkTo(target.docId, target.title);
                        }}
                    >
                        <option value="">
                            {!documents
                                ? 'Loading documents...'
                                : candidates.length === 0
                                    ? 'No other documents to link'
                                    : 'Link to another document...'}
                        </option>
                        {workspaceCandidates.length > 0 ? (
                            <>
                                <optgroup label="In this browser">
                                    {localCandidates.map((d) => (
                                        <option key={d.docId} value={d.docId}>
                                            {d.title || 'Untitled document'}
                                        </option>
                                    ))}
                                </optgroup>
                                <optgroup label="In your workspace">
                                    {workspaceCandidates.map((d) => (
                                        <option key={d.docId} value={d.docId}>
                                            {d.title || 'Untitled document'}
                                        </option>
                                    ))}
                                </optgroup>
                            </>
                        ) : (
                            localCandidates.map((d) => (
                                <option key={d.docId} value={d.docId}>
                                    {d.title || 'Untitled document'}
                                </option>
                            ))
                        )}
                    </select>
                    <button
                        type="button"
                        className="inspector__doc-id-toggle"
                        onClick={() => setIsEnteringId(true)}
                    >
                        Enter a document id or link instead
                    </button>
                    {list?.workspaceUnavailable && (
                        <p className="inspector__hint">
                            Your workspace can't be reached right now, so only this browser's documents are
                            listed.
                        </p>
                    )}
                </>
            )}
        </div>
  );
}

function PropertyEditor({
  properties,
  onChange,
}: {
  /** Optional in practice even where the type says otherwise: files and peers
   * can deliver nodes or edges without it (the schema-0.7 corpus fixture's
   * edges have none), and an unguarded Object.entries here crashed the whole
   * app the moment such an edge was selected. */
  properties: Record<string, string> | undefined;
  onChange: (p: Record<string, string>) => void;
}) {
  const current = properties ?? {};
  const entries = Object.entries(current);
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
              Object.entries(current).forEach(([k, v]) => {
                next[k === key ? e.target.value : k] = v;
              });
              onChange(next);
            }}
          />
          <input
            value={value}
            placeholder="value"
            onChange={(e) => onChange({ ...current, [key]: e.target.value })}
          />
          <button
            type="button"
            className="property-row__remove"
            onClick={() => {
              const next = { ...current };
              delete next[key];
              onChange(next);
            }}
            aria-label={`Remove ${key || 'property'}`}
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        className="property-row__add"
        onClick={() => onChange({ ...current, ['']: '' })}
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
  const [draft, setDraft] = useState('');

  const commit = () => {
    const value = draft.trim();
    if (value && !tags.includes(value)) {
      onChange([...tags, value]);
    }
    setDraft('');
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      commit();
    } else if (event.key === 'Backspace' && draft === '' && tags.length > 0) {
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
          placeholder={tags.length === 0 ? 'env:prod, team:payments...' : 'Add tag...'}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={commit}
        />
      </div>
    </Field>
  );
}
