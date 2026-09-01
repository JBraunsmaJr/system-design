import { getItemType } from "../../domain/requirementsRegistry";
import type { RequirementItem, RequirementsDocument } from "../../domain/requirementsTypes";

interface ReferencePopoverProps {
  doc: RequirementsDocument;
  candidates: RequirementItem[];
  selectedIndex: number;
  /** Top/left in pixels, relative to the positioned ancestor (the editor
   * wrapper) - see RequirementEditor's caret-tracking. */
  position: { top: number; left: number };
  onSelect: (item: RequirementItem) => void;
  onHoverIndex: (index: number) => void;
}

export function ReferencePopover({ doc, candidates, selectedIndex, position, onSelect, onHoverIndex }: ReferencePopoverProps) {
  return (
    <div className="reference-popover" style={{ top: position.top, left: position.left }}>
      {candidates.map((item, index) => {
        const type = getItemType(doc, item.typeId);
        return (
          <div
            key={item.id}
            className={`reference-popover__item${index === selectedIndex ? " is-selected" : ""}`}
            // mousedown + preventDefault (not onClick) keeps focus on the
            // textarea throughout the click, so it never blurs - avoiding
            // any race between "the textarea lost focus" and "a selection
            // was made" entirely, rather than needing to untangle it after
            // the fact.
            onMouseDown={(e) => {
              e.preventDefault();
              onSelect(item);
            }}
            onMouseEnter={() => onHoverIndex(index)}
          >
            <span className="reference-popover__id" style={{ color: type?.color ?? "var(--chrome-text-dim)" }}>
              {item.id}
            </span>
            <span className="reference-popover__title">{item.title || "(untitled)"}</span>
          </div>
        );
      })}
    </div>
  );
}
