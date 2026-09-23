import { useEffect, useRef } from 'react';
import type { KeyboardEvent } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { getItemType, getStatusMeta, isItemWorkable } from '../../domain/requirementsRegistry';
import type { EpicTree, EpicTreeNode } from '../../domain/requirementsHierarchy';
import { countDescendants } from '../../domain/requirementsHierarchy';
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
  selectedId: string | null;
  onSelect: (itemId: string) => void;
  foldedIds: ReadonlySet<string>;
  onToggleFolded: (itemId: string) => void;
  searchQuery?: string;
}

interface Row {
  key: string;
  item: RequirementItem;
  depth: number;
  childCount: number;
  hasChildren: boolean;
  isContext?: boolean;
}

/**
 * The split view's left pane: one compact row per item (id, title, status)
 * in the same grouping as the list, so the whole document fits on a screen
 * or two. Selecting a row opens that item in the detail pane. In the epic
 * grouping, parents can be folded here too (shared with the list's folds).
 *
 * Arrow Up/Down move the selection between visible rows, Left/Right fold
 * and unfold, the same as a file tree.
 */
export function RequirementsOutline({
  doc,
  groups,
  epicTree,
  selectedId,
  onSelect,
  foldedIds,
  onToggleFolded,
  searchQuery,
}: RequirementsOutlineProps) {
  const listRef = useRef<HTMLDivElement>(null);

  const sections: { key: string; label?: string; color?: string; rows: Row[] }[] = [];
  if (epicTree) {
    const rows: Row[] = [];
    const visit = (node: EpicTreeNode) => {
      rows.push({
        key: node.key,
        item: node.item,
        depth: node.depth,
        childCount: countDescendants(node),
        hasChildren: node.children.length > 0,
        isContext: node.isContext,
      });
      // A search shows every match, folded or not.
      if (!foldedIds.has(node.item.id) || searchQuery) node.children.forEach(visit);
    };
    epicTree.roots.forEach(visit);
    if (rows.length > 0) sections.push({ key: '__epics__', rows });
    if (epicTree.unparented.length > 0) {
      sections.push({
        key: '__no-epic__',
        label: 'No epic',
        color: 'var(--chrome-text-dim)',
        rows: epicTree.unparented.map((item) => ({
          key: `unparented:${item.id}`,
          item,
          depth: 0,
          childCount: 0,
          hasChildren: false,
        })),
      });
    }
  } else {
    for (const group of groups) {
      sections.push({
        key: group.key,
        label: group.label,
        color: group.color,
        rows: group.items.map((item) => ({
          key: `${group.key}:${item.id}`,
          item,
          depth: 0,
          childCount: 0,
          hasChildren: false,
        })),
      });
    }
  }
  const allRows = sections.flatMap((s) => s.rows);

  // Keep the selected row in view when the selection changes from
  // elsewhere (a relationship chip, search, Back).
  useEffect(() => {
    if (!selectedId) return;
    const row = listRef.current?.querySelector<HTMLElement>(
      `[data-outline-id="${CSS.escape(selectedId)}"]`,
    );
    row?.scrollIntoView({ block: 'nearest' });
  }, [selectedId]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (allRows.length === 0) return;
    const index = allRows.findIndex((r) => r.item.id === selectedId);
    const current = allRows[index];
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next =
        index < 0
          ? 0
          : Math.min(allRows.length - 1, Math.max(0, index + (e.key === 'ArrowDown' ? 1 : -1)));
      onSelect(allRows[next].item.id);
      listRef.current
        ?.querySelector<HTMLElement>(`[data-outline-id="${CSS.escape(allRows[next].item.id)}"]`)
        ?.focus();
    } else if (current?.hasChildren && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      const folded = foldedIds.has(current.item.id);
      if ((e.key === 'ArrowLeft') !== folded) {
        e.preventDefault();
        onToggleFolded(current.item.id);
      }
    }
  };

  return (
    <div
      ref={listRef}
      className="requirements-outline"
      role="tree"
      aria-label="Requirements outline"
      onKeyDown={onKeyDown}
    >
      {sections.map((section) => (
        <div key={section.key} className="requirements-outline__section">
          {section.label && (
            <div className="requirements-outline__section-title" style={{ color: section.color }}>
              <span>{section.label}</span>
              <span className="requirements-outline__section-count">{section.rows.length}</span>
            </div>
          )}
          {section.rows.map((row) => {
            const type = getItemType(doc, row.item.typeId);
            const status = isItemWorkable(doc, row.item) ? getStatusMeta(row.item.status) : null;
            const isSelected = row.item.id === selectedId;
            const isFolded = foldedIds.has(row.item.id) && !searchQuery;
            return (
              <div
                key={row.key}
                className={`requirements-outline__row${isSelected ? ' is-selected' : ''}${
                  row.isContext ? ' is-context' : ''
                }`}
                style={{ paddingLeft: 6 + row.depth * 14 }}
              >
                {row.hasChildren ? (
                  <button
                    type="button"
                    className="requirements-outline__fold"
                    onClick={() => onToggleFolded(row.item.id)}
                    aria-label={`${isFolded ? 'Unfold' : 'Fold'} ${row.item.id}`}
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
                  aria-expanded={row.hasChildren ? !isFolded : undefined}
                  data-outline-id={row.item.id}
                  className="requirements-outline__select"
                  // Only the selected row is in the tab order; arrows move
                  // between rows, as in a tree.
                  tabIndex={isSelected || (!selectedId && row === allRows[0]) ? 0 : -1}
                  onClick={() => onSelect(row.item.id)}
                  title={row.item.title || row.item.id}
                >
                  <span
                    className="requirements-outline__id"
                    style={{ color: type?.color ?? 'var(--chrome-text-dim)' }}
                  >
                    <HighlightedText text={row.item.id} search={searchQuery} />
                  </span>
                  <HighlightedTitle
                    className="requirements-outline__title"
                    text={row.item.title || 'Untitled'}
                    search={searchQuery}
                  />
                  {row.hasChildren && (
                    <span className="requirements-outline__count">{row.childCount}</span>
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
            );
          })}
        </div>
      ))}
    </div>
  );
}
