import { ArrowRight } from 'lucide-react';
import {
  getItemType,
  getRelationshipLabelForItem,
  getRelationshipType,
  getRelationshipsForItem,
  getStatusMeta,
  isItemWorkable,
} from '../../domain/requirementsRegistry';
import type { RequirementsDocument } from '../../domain/requirementsTypes';
import { ItemPeekBody } from './ItemPeekBody';

/** The body of the hover preview - see useItemPeek. */
export function ItemPeekContent({
  doc,
  itemId,
  onGoTo,
}: {
  doc: RequirementsDocument;
  itemId: string;
  onGoTo: () => void;
}) {
  const item = doc.items.find((i) => i.id === itemId);
  if (!item) return null;
  const type = getItemType(doc, item.typeId);
  const status = isItemWorkable(doc, item) ? getStatusMeta(item.status) : null;

  // "Parent of 3 · Blocks 1" - counts per direction-correct verb.
  const counts = new Map<string, { color: string; count: number }>();
  for (const rel of getRelationshipsForItem(doc, item.id)) {
    const relType = getRelationshipType(doc, rel.typeId);
    if (!relType) continue;
    const label = getRelationshipLabelForItem(rel, relType, item.id);
    const entry = counts.get(label) ?? { color: relType.color, count: 0 };
    entry.count++;
    counts.set(label, entry);
  }

  return (
    <>
      <div className="item-peek__header">
        <span className="item-peek__id" style={{ color: type?.color }}>
          {item.id}
        </span>
        {type && <span className="item-peek__type">{type.label}</span>}
        {status && (
          <span className="item-peek__status" style={{ color: status.color }}>
            {status.label}
          </span>
        )}
      </div>
      <div className="item-peek__title">{item.title || 'Untitled'}</div>
      <ItemPeekBody markdown={item.body} doc={doc} />
      {counts.size > 0 && (
        <div className="item-peek__relationships">
          {[...counts.entries()].map(([label, { color, count }]) => (
            <span key={label} style={{ color }}>
              {label} {count}
            </span>
          ))}
        </div>
      )}
      <button type="button" className="item-peek__go" onClick={onGoTo}>
        Go to {item.id}
        <ArrowRight size={12} />
      </button>
    </>
  );
}
