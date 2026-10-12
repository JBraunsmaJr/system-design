import {type KeyboardEvent, useState} from 'react';
import {Group, Ungroup} from 'lucide-react';
import type {Edge, Node} from '@xyflow/react';
import {CATEGORY_LABELS, getNodeType, NODE_TYPES} from '../../domain/canvas/nodeRegistry';
import {getGroupType, GROUP_TYPES} from '../../domain/canvas/groupRegistry';
import {getEdgeType, resolveEdgeRouting, resolveEdgeStrokeWidth,} from '../../domain/canvas/edgeRegistry';
import {
    defaultNodeColor,
    defaultNodeIcon,
    nodeColorOverride,
    nodeColorPatch,
    nodeHasIcon,
} from '../../domain/canvas/nodeDefaults';
import type {ArchEdgeData, ArchEdgeDataPatch, ArchNodeData, NodeCategory,} from '../../domain/canvas/types';
import type {ZOrderCommand} from '../../domain/canvas/zOrder';
import type {RequirementsDocument} from '../../domain/requirements/requirementsTypes';
import {RequirementLinker} from '../requirements/RequirementLinker';
import {IconPicker} from './IconPicker';
import {
    ColorField,
    EdgeRoutingField,
    EdgeStrokeWidthField,
    EdgeTypeSelect,
    Field,
    LockField,
    TriStateCheckbox,
    ZOrderControls,
} from './InspectorFields';
import {MIXED, sharedValue} from './mixedValue';

/** What the multi-selection Inspector can do - all of it to every selected
 * item at once, each in a single transaction (see useCanvasEditing). */
export interface MultiSelectionActions {
    onUpdateNodes: (updates: { id: string; patch: Partial<ArchNodeData> }[]) => void;
    onUpdateEdges: (updates: { id: string; patch: ArchEdgeDataPatch }[]) => void;
    onSetLocked: (nodeIds: string[], locked: boolean) => void;
    onGroup: (nodeIds: string[]) => void;
    onUngroup: (nodeIds: string[]) => void;
    onDeleteSelection: () => void;
}

const FONT_SIZES = [
    {value: 12, label: 'Small'},
    {value: 16, label: 'Medium'},
    {value: 20, label: 'Large'},
    {value: 28, label: 'X-Large'},
    {value: 40, label: 'Huge'},
];

/** Node categories in the order the palette introduces them. */
const NODE_CATEGORY_ORDER: NodeCategory[] = [
    ...new Set(NODE_TYPES.map((t) => t.category)),
] as NodeCategory[];

/**
 * The Inspector for more than one selected item: every field shown here
 * applies to all of them.
 *
 * Only fields that mean something for EVERY selected item of a kind are
 * offered - an icon only when every node draws one, a node type only when
 * they're all the same kind of node. A field whose items disagree shows
 * "Mixed" until it's changed, at which point they all get the new value.
 * Per-item text (labels, descriptions, code) stays in the single-item
 * Inspector, where it belongs.
 */
export function MultiSelectionInspector({
                                            nodes,
                                            edges,
                                            actions,
                                            requirements,
                                            onNavigateToRequirement,
                                            onZOrderCommand,
                                        }: {
    nodes: Node<ArchNodeData>[];
    edges: Edge<ArchEdgeData>[];
    actions: MultiSelectionActions;
    requirements: RequirementsDocument;
    onNavigateToRequirement: (itemId: string) => void;
    onZOrderCommand: (command: ZOrderCommand) => void;
}) {
    const total = nodes.length + edges.length;
    const parts = [
        nodes.length > 0 ? `${nodes.length} node${nodes.length === 1 ? '' : 's'}` : null,
        edges.length > 0 ? `${edges.length} edge${edges.length === 1 ? '' : 's'}` : null,
    ].filter(Boolean);
    const lockedCount = nodes.filter((n) => n.data.locked).length;

    return (
        <aside className="inspector">
            <div className="panel-header">{total} selected</div>
            <p className="inspector__hint inspector__multi-summary">
                {parts.join(' · ')} - changes here apply to all of them.
            </p>

            {nodes.length > 0 && (
                <NodesSection
                    nodes={nodes}
                    actions={actions}
                    requirements={requirements}
                    onNavigateToRequirement={onNavigateToRequirement}
                    onZOrderCommand={onZOrderCommand}
                />
            )}

            {edges.length > 0 && <EdgesSection edges={edges} actions={actions}/>}

            <button type="button" className="inspector__delete" onClick={actions.onDeleteSelection}>
                Delete {total} items
            </button>
            {lockedCount > 0 && (
                <p className="inspector__hint">
                    {lockedCount} locked node{lockedCount === 1 ? '' : 's'} will be kept - unlock{' '}
                    {lockedCount === 1 ? 'it' : 'them'} first to delete.
                </p>
            )}
        </aside>
    );
}

function NodesSection({
                          nodes,
                          actions,
                          requirements,
                          onNavigateToRequirement,
                          onZOrderCommand,
                      }: {
    nodes: Node<ArchNodeData>[];
    actions: MultiSelectionActions;
    requirements: RequirementsDocument;
    onNavigateToRequirement: (itemId: string) => void;
    onZOrderCommand: (command: ZOrderCommand) => void;
}) {
    const ids = nodes.map((n) => n.id);
    const updateEach = (patchFor: (node: Node<ArchNodeData>) => Partial<ArchNodeData>) =>
        actions.onUpdateNodes(nodes.map((n) => ({id: n.id, patch: patchFor(n)})));

    const kind = sharedValue(nodes, (n) => n.type ?? 'typed');
    const nodeType = sharedValue(nodes, (n) => n.data.nodeType);

    const colorOverride = sharedValue(nodes, nodeColorOverride);
    const defaultColor = sharedValue(nodes, defaultNodeColor);
    const anyColorOverride = nodes.some((n) => nodeColorOverride(n) !== undefined);
    const effectiveColor = sharedValue(nodes, (n) => nodeColorOverride(n) ?? defaultNodeColor(n));

    const allHaveIcons = nodes.every(nodeHasIcon);
    const iconOverride = sharedValue(nodes, (n) => n.data.icon);
    const defaultIcon = sharedValue(nodes, defaultNodeIcon);

    const allHaveFontSize = nodes.every((n) => n.type === 'text' || n.type === 'shape');
    const fontSize = sharedValue(nodes, (n) => n.data.fontSize ?? 16);

    const locked = sharedValue(nodes, (n) => n.data.locked === true);
    const groupIds = nodes.filter((n) => n.type === 'group').map((n) => n.id);

    return (
        <section className="inspector__section">
            <div className="inspector__section-heading">Nodes</div>

            {kind === 'typed' && (
                <Field label="Type">
                    <select
                        value={nodeType === MIXED ? '' : nodeType}
                        onChange={(e) => {
                            const next = getNodeType(e.target.value);
                            if (!next) return;
                            updateEach((n) => {
                                // A label still reading its old type's name was never really
                                // chosen - it follows the type. Anything else was typed by
                                // someone and is kept.
                                const oldLabel = getNodeType(n.data.nodeType)?.label;
                                return n.data.label === oldLabel
                                    ? {nodeType: next.id, label: next.label}
                                    : {nodeType: next.id};
                            });
                        }}
                    >
                        {nodeType === MIXED && (
                            <option value="" disabled>
                                Mixed
                            </option>
                        )}
                        {/* A type this build doesn't know (an older file, a custom
                library) is still shown as what it is, not as the first
                option in the list. */}
                        {nodeType !== MIXED && !getNodeType(nodeType) && (
                            <option value={nodeType} disabled>
                                {nodeType}
                            </option>
                        )}
                        {NODE_CATEGORY_ORDER.map((category) => (
                            <optgroup key={category} label={CATEGORY_LABELS[category]}>
                                {NODE_TYPES.filter((t) => t.category === category).map((t) => (
                                    <option key={t.id} value={t.id}>
                                        {t.label}
                                    </option>
                                ))}
                            </optgroup>
                        ))}
                    </select>
                </Field>
            )}

            {kind === 'group' && (
                <Field label="Boundary kind">
                    <select
                        value={nodeType === MIXED ? '' : nodeType}
                        onChange={(e) => {
                            const next = getGroupType(e.target.value);
                            if (!next) return;
                            updateEach((n) => {
                                const oldLabel = getGroupType(n.data.nodeType)?.label;
                                return n.data.label === oldLabel
                                    ? {nodeType: next.id, label: next.label}
                                    : {nodeType: next.id};
                            });
                        }}
                    >
                        {nodeType === MIXED && (
                            <option value="" disabled>
                                Mixed
                            </option>
                        )}
                        {nodeType !== MIXED && !getGroupType(nodeType) && (
                            <option value={nodeType} disabled>
                                {nodeType}
                            </option>
                        )}
                        {GROUP_TYPES.map((g) => (
                            <option key={g.id} value={g.id}>
                                {g.label}
                            </option>
                        ))}
                    </select>
                </Field>
            )}

            <ColorField
                value={
                    colorOverride !== MIXED
                        ? colorOverride
                        : effectiveColor !== MIXED
                            ? effectiveColor
                            : nodeColorOverride(nodes[0])
                }
                defaultValue={defaultColor !== MIXED ? defaultColor : defaultNodeColor(nodes[0])}
                mixed={effectiveColor === MIXED}
                canReset={anyColorOverride}
                onChange={(color) => updateEach((n) => nodeColorPatch(n, color))}
            />

            {allHaveIcons && (
                <IconPicker
                    value={iconOverride === MIXED ? undefined : iconOverride}
                    defaultValue={defaultIcon === MIXED ? undefined : defaultIcon}
                    mixed={sharedValue(nodes, (n) => n.data.icon ?? defaultNodeIcon(n)) === MIXED}
                    canReset={nodes.some((n) => n.data.icon !== undefined)}
                    onChange={(icon) => updateEach(() => ({icon}))}
                />
            )}

            {allHaveFontSize && (
                <Field label="Text size">
                    <select
                        value={fontSize === MIXED ? '' : String(fontSize)}
                        onChange={(e) => {
                            if (e.target.value) updateEach(() => ({fontSize: Number(e.target.value)}));
                        }}
                    >
                        {fontSize === MIXED && (
                            <option value="" disabled>
                                Mixed
                            </option>
                        )}
                        {FONT_SIZES.map((f) => (
                            <option key={f.value} value={String(f.value)}>
                                {f.label}
                            </option>
                        ))}
                    </select>
                </Field>
            )}

            <SharedTagEditor nodes={nodes} onUpdateNodes={actions.onUpdateNodes}/>

            <SharedRequirementsField
                nodes={nodes}
                onUpdateNodes={actions.onUpdateNodes}
                requirements={requirements}
                onNavigateToRequirement={onNavigateToRequirement}
            />

            <ZOrderControls onCommand={onZOrderCommand}/>
            <LockField locked={locked} onChange={(next) => actions.onSetLocked(ids, next)}/>

            <div className="inspector__button-row">
                <button type="button" onClick={() => actions.onGroup(ids)} title="Ctrl+G">
                    <Group size={13}/> Group
                </button>
                {groupIds.length > 0 && (
                    <button type="button" onClick={() => actions.onUngroup(groupIds)} title="Ctrl+Shift+G">
                        <Ungroup size={13}/> Ungroup
                    </button>
                )}
            </div>
        </section>
    );
}

function EdgesSection({
                          edges,
                          actions,
                      }: {
    edges: Edge<ArchEdgeData>[];
    actions: MultiSelectionActions;
}) {
    const update = (patch: ArchEdgeDataPatch) =>
        actions.onUpdateEdges(edges.map((e) => ({id: e.id, patch})));

    const edgeType = sharedValue(edges, (e) => e.data?.edgeType ?? 'generic');
    const colorOverride = sharedValue(edges, (e) => e.data?.color);
    const defaultColor = sharedValue(edges, (e) => getEdgeType(e.data?.edgeType ?? 'generic').color);
    const effectiveColor = sharedValue(
        edges,
        (e) => e.data?.color ?? getEdgeType(e.data?.edgeType ?? 'generic').color,
    );
    const strokeWidth = sharedValue(edges, (e) => resolveEdgeStrokeWidth(e.data?.strokeWidth));
    const routing = sharedValue(edges, (e) => resolveEdgeRouting(e.data?.routing));
    const direction = sharedValue(edges, (e) => e.data?.direction ?? 'forward');
    const hideLabel = sharedValue(edges, (e) => e.data?.hideLabel === true);
    const first = edges[0].data;

    return (
        <section className="inspector__section">
            <div className="inspector__section-heading">Edges</div>

            <Field label="Type">
                <EdgeTypeSelect
                    value={edgeType === MIXED ? '' : edgeType}
                    mixed={edgeType === MIXED}
                    onChange={(next) => update({edgeType: next})}
                />
            </Field>

            <ColorField
                value={
                    colorOverride !== MIXED
                        ? colorOverride
                        : effectiveColor !== MIXED
                            ? effectiveColor
                            : first?.color
                }
                defaultValue={
                    defaultColor !== MIXED ? defaultColor : getEdgeType(first?.edgeType ?? 'generic').color
                }
                mixed={effectiveColor === MIXED}
                canReset={edges.some((e) => e.data?.color !== undefined)}
                onChange={(color) => update({color})}
            />

            <EdgeStrokeWidthField
                value={strokeWidth === MIXED ? resolveEdgeStrokeWidth(first?.strokeWidth) : strokeWidth}
                mixed={strokeWidth === MIXED}
                onChange={(next) => update({strokeWidth: next})}
            />

            <EdgeRoutingField
                value={routing === MIXED ? 'orthogonal' : routing}
                mixed={routing === MIXED}
                onChange={(next) => update({routing: next})}
            />

            <Field label="Direction">
                <select
                    value={direction === MIXED ? '' : direction}
                    onChange={(e) => {
                        if (e.target.value)
                            update({direction: e.target.value as NonNullable<ArchEdgeData['direction']>});
                    }}
                >
                    {direction === MIXED && (
                        <option value="" disabled>
                            Mixed
                        </option>
                    )}
                    <option value="forward">Forward (source → target)</option>
                    <option value="reverse">Reverse (target → source)</option>
                    <option value="both">Bi-directional (source ↔ target)</option>
                </select>
            </Field>

            <TriStateCheckbox
                checked={hideLabel}
                label="Hide labels on canvas"
                onChange={(next) => update({hideLabel: next})}
            />
        </section>
    );
}

/**
 * Tags every selected node has, as removable chips, plus an input that adds
 * a tag to all of them. Tags only some of them carry are counted but not
 * listed - removing one of those from "all" would be a surprising edit.
 */
function SharedTagEditor({
                             nodes,
                             onUpdateNodes,
                         }: {
    nodes: Node<ArchNodeData>[];
    onUpdateNodes: MultiSelectionActions['onUpdateNodes'];
}) {
    const [draft, setDraft] = useState('');
    const tagsOf = (n: Node<ArchNodeData>) => n.data.tags ?? [];
    const common = tagsOf(nodes[0]).filter((t) => nodes.every((n) => tagsOf(n).includes(t)));
    const partial = new Set(nodes.flatMap(tagsOf).filter((t) => !common.includes(t))).size;

    const addToAll = () => {
        const value = draft.trim();
        setDraft('');
        if (!value) return;
        onUpdateNodes(
            nodes
                .filter((n) => !tagsOf(n).includes(value))
                .map((n) => ({id: n.id, patch: {tags: [...tagsOf(n), value]}})),
        );
    };
    const removeFromAll = (tag: string) =>
        onUpdateNodes(
            nodes.map((n) => ({id: n.id, patch: {tags: tagsOf(n).filter((t) => t !== tag)}})),
        );

    const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'Enter' || event.key === ',') {
            event.preventDefault();
            addToAll();
        }
    };

    return (
        <Field label="Tags (on all)">
            <div className="tag-editor">
                {common.map((tag) => (
                    <span className="tag-chip" key={tag}>
            {tag}
                        <button
                            type="button"
                            onClick={() => removeFromAll(tag)}
                            aria-label={`Remove tag ${tag} from all`}
                        >
              ×
            </button>
          </span>
                ))}
                <input
                    className="tag-editor__input"
                    value={draft}
                    placeholder="Add tag to all..."
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={onKeyDown}
                    onBlur={addToAll}
                />
            </div>
            {partial > 0 && (
                <span className="inspector__hint">
          +{partial} tag{partial === 1 ? '' : 's'} on only some of them
        </span>
            )}
        </Field>
    );
}

/** The requirement linker, for requirements linked to EVERY selected node.
 * Linking adds to all of them; unlinking removes from all of them. */
function SharedRequirementsField({
                                     nodes,
                                     onUpdateNodes,
                                     requirements,
                                     onNavigateToRequirement,
                                 }: {
    nodes: Node<ArchNodeData>[];
    onUpdateNodes: MultiSelectionActions['onUpdateNodes'];
    requirements: RequirementsDocument;
    onNavigateToRequirement: (itemId: string) => void;
}) {
    const linkedOf = (n: Node<ArchNodeData>) => n.data.linkedRequirementIds ?? [];
    const common = linkedOf(nodes[0]).filter((id) => nodes.every((n) => linkedOf(n).includes(id)));
    return (
        <Field label="Linked requirements (on all)">
            <RequirementLinker
                linkedIds={common}
                doc={requirements}
                onLink={(itemId) =>
                    onUpdateNodes(
                        nodes
                            .filter((n) => !linkedOf(n).includes(itemId))
                            .map((n) => ({
                                id: n.id,
                                patch: {linkedRequirementIds: [...linkedOf(n), itemId]},
                            })),
                    )
                }
                onUnlink={(itemId) =>
                    onUpdateNodes(
                        nodes.map((n) => ({
                            id: n.id,
                            patch: {linkedRequirementIds: linkedOf(n).filter((id) => id !== itemId)},
                        })),
                    )
                }
                onNavigate={onNavigateToRequirement}
            />
        </Field>
    );
}
