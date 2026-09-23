import { useEffect, useRef } from 'react';
import type { CSSProperties, KeyboardEvent } from 'react';
import { ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown } from 'lucide-react';
import { getItemType, getStatusMeta, isItemWorkable } from '../../domain/requirementsRegistry';
import type { EpicTree, EpicTreeNode } from '../../domain/requirementsHierarchy';
import type { RequirementItem, RequirementsDocument } from '../../domain/requirementsTypes';
import { HighlightedText, HighlightedTitle } from './HighlightText';

export interface OutlineGroup {
  key: string;
  label: string;
  color: string;
  items: RequirementItem[];
}

interface RequirementsOutlineProps {
  doc: RequirementsDocument;
  /** Grouped by type or category... */
  groups: OutlineGroup[];
  /** ...or, when set, the epic tree (groups is then ignored). */
  epicTree?: EpicTree;
  /** Prefixes section keys so each grouping keeps its own folded sections
   * ("type:ticket" vs "category:ui"). */
  sectionKeyPrefix: string;
  /** Section key used for the epic tree's "No epic" section. */
  noEpicSectionKey: string;
  selectedId: string | null;
  onSelect: (itemId: string) => void;
  /** Items whose children are hidden - shared with the list's epic folds. */
  foldedIds: ReadonlySet<string>;
  onToggleFolded: (itemId: string) => void;
  /** Folded sections, as "<prefix>:<sectionKey>". */
  collapsedSectionKeys: ReadonlySet<string>;
  onToggleSection: (fullSectionKey: string) => void;
  /** Folds every section and every parent currently in the outline. */
  onCollapseAll: (fullSectionKeys: string[], parentIds: string[]) => void;
  /** Unfolds this grouping's sections and every parent. */
  onExpandAll: (fullSectionKeys: string[]) => void;
  searchQuery?: string;
}

/** Height of one row, and of a section header - sticky offsets stack
 * these, so they must match the CSS. */
const ROW_HEIGHT = 28;
const TOOLBAR_HEIGHT = 34;
const SECTION_HEADER_HEIGHT = 28;

interface OutlineNode {
  key: string;
  item: RequirementItem;
  depth: number;
  children: OutlineNode[];
  isContext?: boolean;
}

interface OutlineSection {
  /** Full key ("<prefix>:<key>"), or null for the epic tree's top-level
   * epics, which have no header of their own. */
  fullKey: string | null;
  label?: string;
  color?: string;
  nodes: OutlineNode[];
}

function fromEpicNode(node: EpicTreeNode): OutlineNode {
  return {
    key: node.key,
    item: node.item,
    depth: node.depth,
    isContext: node.isContext,
    children: node.children.map(fromEpicNode),
  };
}

function subtreeContains(node: OutlineNode, itemId: string): boolean {
  return node.children.some((c) => c.item.id === itemId || subtreeContains(c, itemId));
}

/** Finds an outline row by item id without building a CSS selector from
 * the id, so no escaping is involved whatever characters it contains. */
function findRow(container: HTMLElement | null, itemId: string): HTMLElement | undefined {
  if (!container) return undefined;
  return Array.from(container.querySelectorAll<HTMLElement>('[data-outline-id]')).find(
    (el) => el.dataset.outlineId === itemId,
  );
}

/**
 * The split view's left pane: one compact row per item (id, title, status)
 * in the same grouping as the list, so a large document stays scannable.
 *
 * Everything with contents can be folded - each group (Tickets, a
 * category, "No epic") and each parent item - and the header above the
 * list folds or unfolds all of it at once. While you scroll, each group's
 * header and each parent above your position stay pinned at the top, so
 * you can always see where you are. A search shows every match regardless
 * of folds.
 *
 * Keyboard, as in a file tree: Up/Down move between visible rows,
 * Right unfolds (or steps into the first child), Left folds (or steps out
 * to the parent), Home/End jump to the first/last row.
 */
export function RequirementsOutline({
  doc,
  groups,
  epicTree,
  sectionKeyPrefix,
  noEpicSectionKey,
  selectedId,
  onSelect,
  foldedIds,
  onToggleFolded,
  collapsedSectionKeys,
  onToggleSection,
  onCollapseAll,
  onExpandAll,
  searchQuery,
}: RequirementsOutlineProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const isSearching = Boolean(searchQuery);

  const sections: OutlineSection[] = [];
  if (epicTree) {
    if (epicTree.roots.length > 0) {
      sections.push({ fullKey: null, nodes: epicTree.roots.map(fromEpicNode) });
    }
    if (epicTree.unparented.length > 0) {
      sections.push({
        fullKey: `${sectionKeyPrefix}:${noEpicSectionKey}`,
        label: 'No epic',
        color: 'var(--chrome-text-dim)',
        nodes: epicTree.unparented.map((item) => ({
          key: `unparented:${item.id}`,
          item,
          depth: 0,
          children: [],
        })),
      });
    }
  } else {
    for (const group of groups) {
      sections.push({
        fullKey: `${sectionKeyPrefix}:${group.key}`,
        label: group.label,
        color: group.color,
        nodes: group.items.map((item) => ({
          key: `${group.key}:${item.id}`,
          item,
          depth: 0,
          children: [],
        })),
      });
    }
  }

  const isSectionFolded = (section: OutlineSection) =>
    !isSearching && section.fullKey !== null && collapsedSectionKeys.has(section.fullKey);
  const isNodeFolded = (node: OutlineNode) =>
    !isSearching && node.children.length > 0 && foldedIds.has(node.item.id);

  // The rows currently visible, in order, each with its parent row - for
  // keyboard navigation.
  const visibleRows: { node: OutlineNode; parent: OutlineNode | null }[] = [];
  const parentIds: string[] = [];
  const walk = (node: OutlineNode, parent: OutlineNode | null, visible: boolean) => {
    if (visible) visibleRows.push({ node, parent });
    if (node.children.length > 0) parentIds.push(node.item.id);
    node.children.forEach((c) => walk(c, node, visible && !isNodeFolded(node)));
  };
  for (const section of sections) {
    section.nodes.forEach((n) => walk(n, null, !isSectionFolded(section)));
  }
  const sectionKeys = sections.map((s) => s.fullKey).filter((k): k is string => k !== null);
  const anythingFolded =
    sectionKeys.some((k) => collapsedSectionKeys.has(k)) ||
    parentIds.some((id) => foldedIds.has(id));

  // Keep the selected row in view when the selection changes from
  // elsewhere (a relationship chip, search, Back).
  useEffect(() => {
    if (selectedId) findRow(listRef.current, selectedId)?.scrollIntoView({ block: 'nearest' });
  }, [selectedId]);

  const select = (itemId: string) => {
    onSelect(itemId);
    // Focus follows selection for keyboard users; after the re-render,
    // since the row may only just have been revealed.
    requestAnimationFrame(() => findRow(listRef.current, itemId)?.focus());
  };

  /** Folding a parent that contains the selected row moves the selection
   * up to the parent, so the selection never disappears into a fold. */
  const toggleNode = (node: OutlineNode) => {
    const folding = !foldedIds.has(node.item.id);
    if (folding && selectedId && subtreeContains(node, selectedId)) select(node.item.id);
    onToggleFolded(node.item.id);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (visibleRows.length === 0) return;
    const index = visibleRows.findIndex((r) => r.node.item.id === selectedId);
    const current = visibleRows[index];
    const move = (to: number) => {
      e.preventDefault();
      select(visibleRows[Math.min(visibleRows.length - 1, Math.max(0, to))].node.item.id);
    };
    switch (e.key) {
      case 'ArrowDown':
        move(index < 0 ? 0 : index + 1);
        break;
      case 'ArrowUp':
        move(index < 0 ? 0 : index - 1);
        break;
      case 'Home':
        move(0);
        break;
      case 'End':
        move(visibleRows.length - 1);
        break;
      case 'ArrowRight':
        if (!current || current.node.children.length === 0) return;
        e.preventDefault();
        if (isNodeFolded(current.node)) onToggleFolded(current.node.item.id);
        else select(current.node.children[0].item.id);
        break;
      case 'ArrowLeft':
        if (!current) return;
        e.preventDefault();
        if (current.node.children.length > 0 && !isNodeFolded(current.node)) {
          onToggleFolded(current.node.item.id);
        } else if (current.parent) {
          select(current.parent.item.id);
        }
        break;
    }
  };

  const renderNode = (node: OutlineNode, stickyTop: number): React.ReactNode => {
    const type = getItemType(doc, node.item.typeId);
    const status = isItemWorkable(doc, node.item) ? getStatusMeta(node.item.status) : null;
    const isSelected = node.item.id === selectedId;
    const hasChildren = node.children.length > 0;
    const isFolded = isNodeFolded(node);
    // A parent row stays pinned while you scroll through its children -
    // it's sticky within its own wrapper, so it leaves with them.
    const rowStyle: CSSProperties = {
      paddingLeft: 6 + node.depth * 14,
      ...(hasChildren && !isFolded
        ? { top: stickyTop + node.depth * ROW_HEIGHT, zIndex: 3 - Math.min(node.depth, 2) }
        : {}),
    };
    return (
      <div key={node.key} role="none">
        <div
          className={`requirements-outline__row${isSelected ? ' is-selected' : ''}${
            node.isContext ? ' is-context' : ''
          }${hasChildren && !isFolded ? ' is-pinned' : ''}`}
          style={rowStyle}
        >
          {hasChildren ? (
            <button
              type="button"
              className="requirements-outline__fold"
              onClick={() => toggleNode(node)}
              aria-label={`${isFolded ? 'Show' : 'Hide'} the items under ${node.item.id}`}
              tabIndex={-1}
            >
              {isFolded ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
            </button>
          ) : (
            <span className="requirements-outline__fold-spacer" />
          )}
          <button
            type="button"
            role="treeitem"
            aria-selected={isSelected}
            aria-expanded={hasChildren ? !isFolded : undefined}
            aria-level={node.depth + 1}
            data-outline-id={node.item.id}
            className="requirements-outline__select"
            // Only the selected row is in the tab order; arrows move
            // between rows, as in a tree.
            tabIndex={isSelected || (!selectedId && node === visibleRows[0]?.node) ? 0 : -1}
            onClick={() => onSelect(node.item.id)}
            onDoubleClick={() => hasChildren && toggleNode(node)}
            title={node.item.title || node.item.id}
          >
            <span
              className="requirements-outline__id"
              style={{ color: type?.color ?? 'var(--chrome-text-dim)' }}
            >
              <HighlightedText text={node.item.id} search={searchQuery} />
            </span>
            <HighlightedTitle
              className="requirements-outline__title"
              text={node.item.title || 'Untitled'}
              search={searchQuery}
            />
            {hasChildren && (
              <span className="requirements-outline__count">{countRows(node.children)}</span>
            )}
            {status && (
              <span
                className="requirements-outline__status"
                style={{ background: status.color }}
                title={status.label}
                aria-label={status.label}
              />
            )}
          </button>
        </div>
        {hasChildren && !isFolded && (
          <div role="group">{node.children.map((c) => renderNode(c, stickyTop))}</div>
        )}
      </div>
    );
  };

  return (
    <div className="requirements-outline">
      <div className="requirements-outline__toolbar" style={{ height: TOOLBAR_HEIGHT }}>
        <span className="requirements-outline__toolbar-label">
          {visibleRows.length} of {sections.reduce((n, s) => n + countRows(s.nodes), 0)} shown
        </span>
        <button
          type="button"
          className="requirements-outline__toolbar-btn"
          onClick={() => onCollapseAll(sectionKeys, parentIds)}
          title="Fold every group and every parent in the outline"
          disabled={isSearching}
        >
          <ChevronsDownUp size={12} />
          <span>Collapse</span>
        </button>
        <button
          type="button"
          className="requirements-outline__toolbar-btn"
          onClick={() => onExpandAll(sectionKeys)}
          title="Unfold everything in the outline"
          disabled={isSearching || !anythingFolded}
        >
          <ChevronsUpDown size={12} />
          <span>Expand</span>
        </button>
      </div>
      <div ref={listRef} role="tree" aria-label="Requirements outline" onKeyDown={onKeyDown}>
        {sections.map((section) => {
          const folded = isSectionFolded(section);
          const hasHeader = section.fullKey !== null;
          const count = countRows(section.nodes);
          return (
            <div
              key={section.fullKey ?? '__roots__'}
              className="requirements-outline__section"
              role="none"
            >
              {hasHeader && (
                <button
                  type="button"
                  className="requirements-outline__section-title"
                  style={{ color: section.color, top: TOOLBAR_HEIGHT }}
                  onClick={() => onToggleSection(section.fullKey!)}
                  aria-expanded={!folded}
                  disabled={isSearching}
                >
                  {folded ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                  <span className="requirements-outline__section-label">{section.label}</span>
                  <span className="requirements-outline__section-count">{count}</span>
                </button>
              )}
              {!folded &&
                section.nodes.map((node) =>
                  renderNode(node, TOOLBAR_HEIGHT + (hasHeader ? SECTION_HEADER_HEIGHT : 0)),
                )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Every row in a set of nodes, counting nested ones - the total a
 * section or the whole outline would show fully unfolded. */
function countRows(nodes: OutlineNode[]): number {
  return nodes.reduce((n, node) => n + 1 + countRows(node.children), 0);
}
