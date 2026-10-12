import type {Edge, Node} from '@xyflow/react';
import type {ArchEdgeData, ArchNodeData} from './types';

/**
 * Reusable diagram fragments: a group of nodes (with the edges between
 * them, and anything nested in their sub-diagrams) saved under a name, so
 * it can be dropped into any document from the palette.
 *
 * A fragment's contents have the same shape the clipboard uses (see
 * app/hooks/useClipboard.ts): every node and edge carries `relativePath`,
 * its level relative to the saved selection ([] for the selection itself,
 * [oldNodeId] for something inside that node's sub-diagram, and so on).
 * That is what lets a fragment be inserted with the clipboard's own
 * insert routine, nested content and all.
 *
 * Fragments are a per-person library, like custom shape libraries (see
 * domain/storage/assetLibrary.ts): kept in this browser's localStorage,
 * shared by every document opened here, and never written into a shared
 * document. Saving one strips everything that only means something in
 * the document it came from - requirement links, document links, lock
 * state, selection and other transient display state - so dropping it
 * into another document can't leave dangling references there.
 */

export type FragmentNode = Node<ArchNodeData> & { relativePath: string[] };
export type FragmentEdge = Edge<ArchEdgeData> & { relativePath: string[] };

export interface DiagramFragmentContents {
    nodes: FragmentNode[];
    edges: FragmentEdge[];
}

export interface DiagramFragment {
    id: string;
    name: string;
    /** ms since epoch. */
    createdAt: number;
    contents: DiagramFragmentContents;
}

export const FRAGMENTS_STORAGE_KEY = 'system-design-editor:diagram-fragments';
/** Generous for diagrams, small next to localStorage's usual 5 MB quota -
 * one runaway fragment shouldn't be able to crowd out everything else the
 * editor keeps there. */
export const MAX_FRAGMENT_BYTES = 1024 * 1024;
export const MAX_FRAGMENT_NAME_LENGTH = 80;

/** Node data fields that refer into the document the node came from, or
 * are computed per render and never meant to be stored. */
const DOCUMENT_SPECIFIC_NODE_FIELDS = [
    'linkedRequirementIds',
    'linkedDocument',
    'locked',
    'hasSubDiagram',
    'subDiagramNodeCount',
    'unwiredPortCount',
    'subDiagram',
] as const;

/** Edge data fields that are display-only or don't survive insertion:
 * waypoints are absolute canvas coordinates and are not written by
 * addEdge, so a fragment's edges are routed afresh where they land. */
const DOCUMENT_SPECIFIC_EDGE_FIELDS = ['isStepMember', 'waypoints'] as const;

function cleanNodeData(data: ArchNodeData): ArchNodeData {
    const copy: ArchNodeData = {
        ...data,
        properties: {...(data.properties ?? {})},
        tags: [...(data.tags ?? [])],
    };
    for (const field of DOCUMENT_SPECIFIC_NODE_FIELDS) delete copy[field];
    // The flat stores tag every node with its level in the document's tree
    // (see diagramStore.ts) - old ids that mean nothing anywhere else.
    delete (copy as Record<string, unknown>).parentPath;
    return copy;
}

function cleanEdgeData(data: ArchEdgeData | undefined): ArchEdgeData | undefined {
    if (!data) return undefined;
    const copy: ArchEdgeData = {...data, properties: {...(data.properties ?? {})}};
    for (const field of DOCUMENT_SPECIFIC_EDGE_FIELDS) delete copy[field];
    delete (copy as Record<string, unknown>).parentPath;
    return copy;
}

/** Whether `n` sits directly on the canvas the fragment is dropped onto -
 * not nested in a boundary and not inside a sub-diagram. Only these are
 * positioned in that canvas's coordinates. */
function isRootNode(n: FragmentNode): boolean {
    return n.relativePath.length === 0 && !n.parentId;
}

/**
 * Turns collected clipboard contents into what gets saved: document-
 * specific fields stripped, transient React Flow state dropped, and the
 * top-level nodes moved so the group's top-left corner is at 0,0 - which
 * makes "drop it here" mean "its top-left corner goes here".
 */
export function prepareFragmentContents(
    contents: DiagramFragmentContents,
): DiagramFragmentContents {
    const roots = contents.nodes.filter(isRootNode);
    const minX = roots.length > 0 ? Math.min(...roots.map((n) => n.position.x)) : 0;
    const minY = roots.length > 0 ? Math.min(...roots.map((n) => n.position.y)) : 0;

    const nodes = contents.nodes.map((n): FragmentNode => {
        const node: FragmentNode = {
            id: n.id,
            type: n.type,
            position: isRootNode(n)
                ? {x: n.position.x - minX, y: n.position.y - minY}
                : {x: n.position.x, y: n.position.y},
            data: cleanNodeData(n.data),
            relativePath: [...n.relativePath],
        };
        if (n.parentId) node.parentId = n.parentId;
        if (n.width !== undefined) node.width = n.width;
        if (n.height !== undefined) node.height = n.height;
        return node;
    });

    const edges = contents.edges.map((e): FragmentEdge => {
        const edge: FragmentEdge = {
            id: e.id,
            source: e.source,
            target: e.target,
            data: cleanEdgeData(e.data),
            relativePath: [...e.relativePath],
        };
        if (e.type) edge.type = e.type;
        if (e.sourceHandle != null) edge.sourceHandle = e.sourceHandle;
        if (e.targetHandle != null) edge.targetHandle = e.targetHandle;
        return edge;
    });

    return {nodes, edges};
}

/** The fragment's contents with its top-level nodes moved by dx,dy -
 * where a drop puts it. Nested and boundary-relative positions are left
 * alone, since they're relative to something that moves with them. */
export function translateFragmentContents(
    contents: DiagramFragmentContents,
    dx: number,
    dy: number,
): DiagramFragmentContents {
    return {
        nodes: contents.nodes.map((n) =>
            isRootNode(n) ? {...n, position: {x: n.position.x + dx, y: n.position.y + dy}} : n,
        ),
        edges: contents.edges,
    };
}

/** How many elements a fragment drops in, nested content included - shown
 * in the palette so a fragment's size is visible before it's used. */
export function fragmentNodeCount(fragment: DiagramFragment): number {
    return fragment.contents.nodes.length;
}

/** A name for a new fragment when none was given: the single node's label,
 * or "N elements". */
export function suggestFragmentName(contents: DiagramFragmentContents): string {
    const roots = contents.nodes.filter((n) => n.relativePath.length === 0);
    if (roots.length === 1) {
        const label = String(roots[0].data.label ?? '').trim();
        if (label) return label.slice(0, MAX_FRAGMENT_NAME_LENGTH);
    }
    const count = contents.nodes.length;
    return `${count} ${count === 1 ? 'element' : 'elements'}`;
}

// ---------------------------------------------------------------------------
// Validation - fragments come back from localStorage, which anything on this
// origin (or a hand edit) can have written, so every field is checked.
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
    return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

function isPosition(value: unknown): value is { x: number; y: number } {
    return (
        isRecord(value) &&
        typeof value.x === 'number' &&
        Number.isFinite(value.x) &&
        typeof value.y === 'number' &&
        Number.isFinite(value.y)
    );
}

function isFragmentNode(value: unknown): value is FragmentNode {
    if (!isRecord(value)) return false;
    return (
        typeof value.id === 'string' &&
        (value.type === undefined || typeof value.type === 'string') &&
        (value.parentId === undefined || typeof value.parentId === 'string') &&
        isPosition(value.position) &&
        isRecord(value.data) &&
        typeof value.data.nodeType === 'string' &&
        isStringArray(value.relativePath)
    );
}

function isFragmentEdge(value: unknown): value is FragmentEdge {
    if (!isRecord(value)) return false;
    return (
        typeof value.id === 'string' &&
        typeof value.source === 'string' &&
        typeof value.target === 'string' &&
        (value.data === undefined || isRecord(value.data)) &&
        isStringArray(value.relativePath)
    );
}

/** Whether every reference inside `contents` points at something inside
 * it - the clipboard's insert routine relies on that to place everything. */
function isSelfContained(contents: DiagramFragmentContents): boolean {
    const ids = new Set(contents.nodes.map((n) => n.id));
    return (
        contents.nodes.every(
            (n) => (!n.parentId || ids.has(n.parentId)) && n.relativePath.every((id) => ids.has(id)),
        ) &&
        contents.edges.every(
            (e) => ids.has(e.source) && ids.has(e.target) && e.relativePath.every((id) => ids.has(id)),
        )
    );
}

export function validateFragment(value: unknown): DiagramFragment | null {
    if (!isRecord(value)) return null;
    const {id, name, createdAt, contents} = value;
    if (typeof id !== 'string' || !id) return null;
    if (typeof name !== 'string') return null;
    if (!isRecord(contents)) return null;
    if (!Array.isArray(contents.nodes) || !Array.isArray(contents.edges)) return null;
    if (!contents.nodes.every(isFragmentNode) || !contents.edges.every(isFragmentEdge)) return null;
    const typed: DiagramFragmentContents = {
        nodes: contents.nodes,
        edges: contents.edges,
    };
    if (typed.nodes.length === 0 || !isSelfContained(typed)) return null;
    return {
        id,
        name: name.trim().slice(0, MAX_FRAGMENT_NAME_LENGTH) || 'Untitled fragment',
        createdAt: typeof createdAt === 'number' && Number.isFinite(createdAt) ? createdAt : 0,
        contents: typed,
    };
}

// ---------------------------------------------------------------------------
// The library: load, save, subscribe.
// ---------------------------------------------------------------------------

type Listener = () => void;
const listeners = new Set<Listener>();
let cache: DiagramFragment[] | null = null;

function readStorage(): DiagramFragment[] {
    try {
        const raw = localStorage.getItem(FRAGMENTS_STORAGE_KEY);
        if (!raw) return [];
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        const seen = new Set<string>();
        const result: DiagramFragment[] = [];
        for (const entry of parsed) {
            const fragment = validateFragment(entry);
            if (!fragment || seen.has(fragment.id)) continue;
            seen.add(fragment.id);
            result.push(fragment);
        }
        return result;
    } catch {
        return [];
    }
}

function writeStorage(fragments: DiagramFragment[]): boolean {
    try {
        localStorage.setItem(FRAGMENTS_STORAGE_KEY, JSON.stringify(fragments));
        return true;
    } catch {
        return false;
    }
}

function setFragments(next: DiagramFragment[]): boolean {
    if (!writeStorage(next)) return false;
    cache = next;
    for (const listener of listeners) listener();
    return true;
}

/** Every saved fragment, oldest first. The same array is returned until
 * the library changes, so it can back useSyncExternalStore directly. */
export function listFragments(): DiagramFragment[] {
    if (cache === null) cache = readStorage();
    return cache;
}

export function getFragment(id: string): DiagramFragment | undefined {
    return listFragments().find((f) => f.id === id);
}

export function subscribeToFragments(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

export type SaveFragmentResult =
    | { ok: true; fragment: DiagramFragment }
    | { ok: false; reason: 'empty' | 'too-large' | 'storage' };

let idSeed = 0;

/** Saves `contents` (already collected from the canvas) as a new fragment.
 * Fails without changing anything when there's nothing to save, when the
 * fragment is over MAX_FRAGMENT_BYTES, or when the browser refuses the
 * write (quota, private browsing). */
export function saveFragment(name: string, contents: DiagramFragmentContents): SaveFragmentResult {
    const prepared = prepareFragmentContents(contents);
    if (prepared.nodes.length === 0) return {ok: false, reason: 'empty'};
    const fragment: DiagramFragment = {
        id: `fragment-${Date.now().toString(36)}-${(idSeed++).toString(36)}`,
        name: name.trim().slice(0, MAX_FRAGMENT_NAME_LENGTH) || suggestFragmentName(prepared),
        createdAt: Date.now(),
        contents: prepared,
    };
    if (JSON.stringify(fragment).length > MAX_FRAGMENT_BYTES) {
        return {ok: false, reason: 'too-large'};
    }
    if (!setFragments([...listFragments(), fragment])) return {ok: false, reason: 'storage'};
    return {ok: true, fragment};
}

export function renameFragment(id: string, name: string): boolean {
    const trimmed = name.trim().slice(0, MAX_FRAGMENT_NAME_LENGTH);
    if (!trimmed) return false;
    const current = listFragments();
    if (!current.some((f) => f.id === id)) return false;
    return setFragments(current.map((f) => (f.id === id ? {...f, name: trimmed} : f)));
}

export function deleteFragment(id: string): boolean {
    const current = listFragments();
    if (!current.some((f) => f.id === id)) return false;
    return setFragments(current.filter((f) => f.id !== id));
}

/** Drops the in-memory copy so the next read goes back to storage - for
 * tests, and for picking up another tab's changes (see the storage event
 * listener in the palette). */
export function reloadFragments(): void {
    cache = null;
    for (const listener of listeners) listener();
}
