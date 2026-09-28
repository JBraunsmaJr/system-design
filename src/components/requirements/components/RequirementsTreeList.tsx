import React, { type ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type {
  RequirementItem,
  RequirementsDocument,
} from '../../../domain/requirements/requirementsTypes';
import {
  countDescendants,
  isEpicItem,
  type EpicTree,
  type EpicTreeNode,
} from '../../../domain/requirements/requirementsHierarchy';
import { NO_EPIC_KEY } from '../hooks/useRequirementsFilter';

export interface RequirementsTreeListProps {
  epicTree: EpicTree;
  doc: RequirementsDocument;
  foldedIds: ReadonlySet<string>;
  onToggleFolded: (itemId: string) => void;
  onNavigateToItem: (itemId: string, fromSectionKey?: string) => void;
  domIdByNodeKey: Map<string, string>;
  searchQuery: string;
  renderCard: (
    item: RequirementItem,
    options: {
      sectionKey: string;
      cardKey?: string;
      domId?: string;
      isContext?: boolean;
    },
  ) => ReactNode;
}

export function RequirementsTreeList({
  epicTree,
  doc,
  foldedIds,
  onToggleFolded,
  onNavigateToItem,
  domIdByNodeKey,
  searchQuery,
  renderCard,
}: RequirementsTreeListProps) {
  const renderEpicNode = (node: EpicTreeNode): React.ReactNode => {
    const card = renderCard(node.item, {
      sectionKey: node.rootId,
      cardKey: node.key,
      domId: domIdByNodeKey.get(node.key),
      isContext: node.isContext,
    });
    const isEpic = isEpicItem(doc, node.item);
    if (!isEpic && node.children.length === 0) {
      return <div key={node.key}>{card}</div>;
    }
    const type = doc.itemTypes.find((t) => t.id === node.item.typeId);
    const color = type?.color ?? 'var(--chrome-text-dim)';
    const descendantCount = countDescendants(node);
    const hasChildren = node.children.length > 0;
    const isFolded = hasChildren && foldedIds.has(node.item.id) && !searchQuery.trim();

    return (
      <div
        key={node.key}
        className={`epic-tree__node${isFolded ? ' is-folded' : ''}`}
        style={{ '--epic-depth': node.depth, '--epic-color': color } as React.CSSProperties}
      >
        <div className={`epic-tree__header${node.isContext ? ' is-context' : ''}`}>
          {hasChildren ? (
            <button
              type="button"
              className="epic-tree__fold"
              onClick={() => onToggleFolded(node.item.id)}
              aria-expanded={!isFolded}
              aria-label={`${isFolded ? 'Show' : 'Hide'} the items under ${node.item.id}`}
              title={isFolded ? 'Show children' : 'Hide children'}
            >
              {isFolded ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
            </button>
          ) : (
            <span className="epic-tree__fold-spacer" />
          )}
          <button
            type="button"
            className="epic-tree__header-link"
            onClick={() => onNavigateToItem(node.item.id, node.rootId)}
            title={`Go to ${node.item.id}`}
          >
            <span className="epic-tree__header-id" style={{ color }}>
              {node.item.id}
            </span>
            <span className="epic-tree__header-title">{node.item.title || 'Untitled'}</span>
            <span className="epic-tree__header-count">
              {descendantCount} {descendantCount === 1 ? 'item' : 'items'}
              {isFolded ? ' hidden' : ''}
            </span>
          </button>
        </div>
        {card}
        {hasChildren && !isFolded && (
          <div className="epic-tree__children">{node.children.map(renderEpicNode)}</div>
        )}
      </div>
    );
  };

  return (
    <>
      {epicTree.roots.length > 0 && (
        <section className="requirements-view__group epic-tree">
          {epicTree.roots.map(renderEpicNode)}
        </section>
      )}
      {epicTree.unparented.length > 0 && (
        <section className="requirements-view__group">
          <h3
            className="requirements-view__group-title"
            style={{ color: 'var(--chrome-text-dim)' }}
          >
            No epic
          </h3>
          {epicTree.unparented.map((item) =>
            renderCard(item, { sectionKey: NO_EPIC_KEY }),
          )}
        </section>
      )}
    </>
  );
}
