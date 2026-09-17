import { forwardRef } from "react";
import { getItemType } from "../../domain/requirementsRegistry";
import type { RequirementItem, RequirementsDocument } from "../../domain/requirementsTypes";
import { HighlightedText, HighlightedTitle } from "./HighlightText";

interface ReferencePopoverProps {
  doc: RequirementsDocument;
  candidates: RequirementItem[];
  selectedIndex: number;
  /** Fixed-position viewport coordinates - see RequirementEditor's
   * caret-tracking and flip-positioning logic. */
  position: { top: number; left: number };
  onSelect: (item: RequirementItem) => void;
  onHoverIndex: (index: number) => void;
  searchQuery?: string;
}

// forwardRef so RequirementEditor can measure this popover's actual
// rendered size (via getBoundingClientRect) to decide whether it needs to
// flip above the caret instead of below - see the useLayoutEffect there.
export const ReferencePopover = forwardRef<HTMLDivElement, ReferencePopoverProps>(function ReferencePopover(
  { doc, candidates, selectedIndex, position, onSelect, onHoverIndex, searchQuery },
  ref
) {
  return (
    <div ref={ref} className="reference-popover" style={{ position: "fixed", top: position.top, left: position.left }}>
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
              <HighlightedText text={item.id} search={searchQuery} />
            </span>
            <HighlightedTitle
              className="reference-popover__title"
              text={item.title || "(untitled)"}
              search={searchQuery}
            />
          </div>
        );
      })}
    </div>
  );
});
