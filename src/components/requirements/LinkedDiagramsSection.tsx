import { useState } from "react";
import { Plus, Workflow, FileText } from "lucide-react";
import type { LinkedNodeRef, DiagramPath } from "../../domain/subDiagramTree";

interface LinkedDiagramsSectionProps {
  itemId: string;
  itemTitle: string;
  linkedNodes: LinkedNodeRef[];
  onNavigateToNode?: (path: DiagramPath, nodeId: string) => void;
  onCreateLinkedNode?: (itemId: string, label: string) => void;
}

/** Above this many chips the list collapses behind a "+N more" toggle.
 * Six is roughly two rows at the chip's max-width, which reads as a
 * short list rather than a wall - past that the section starts crowding
 * out the item's actual content, which is what it's meant to annotate. */
const COLLAPSE_THRESHOLD = 6;

/**
 * The "Linked Diagrams" block shown under a requirement, in both the
 * requirements list and the timeline's detail modal.
 *
 * Previously this markup existed twice, character for character, once in
 * RequirementCard and once in RequirementDetailModal - so any change to
 * it (including this one) had to be made in both places to avoid the two
 * views drifting apart. It's one component now.
 */
export function LinkedDiagramsSection({
  itemId,
  itemTitle,
  linkedNodes,
  onNavigateToNode,
  onCreateLinkedNode,
}: LinkedDiagramsSectionProps) {
  const [expanded, setExpanded] = useState(false);

  const isCollapsible = linkedNodes.length > COLLAPSE_THRESHOLD;
  const visible = isCollapsible && !expanded ? linkedNodes.slice(0, COLLAPSE_THRESHOLD) : linkedNodes;
  const hiddenCount = linkedNodes.length - visible.length;

  return (
    <div className="requirement-card__diagrams">
      <div className="requirement-card__diagrams-header">
        <span>Linked Diagrams</span>
        {onCreateLinkedNode && (
          <button
            type="button"
            className="requirement-card__diagrams-add"
            onClick={() => onCreateLinkedNode(itemId, itemTitle || itemId)}
            title="Create a new diagram node linked to this item"
          >
            <Plus size={11} /> New
          </button>
        )}
      </div>
      {linkedNodes.length === 0 ? (
        <p className="requirement-card__diagrams-empty">No linked diagram nodes yet.</p>
      ) : (
        <div className="requirement-card__diagrams-list">
          {visible.map((ref) => (
            <button
              key={ref.nodeId}
              type="button"
              className="requirement-card__diagram-chip"
              onClick={() => onNavigateToNode?.(ref.path, ref.nodeId)}
              title={`Go to "${ref.label || "Untitled"}" in the diagram`}
            >
              <Workflow size={11} />
              <span>{ref.label || "Untitled"}</span>
              {ref.hasSubDiagram && (
                <FileText size={10} className="requirement-card__diagram-chip-doc" aria-label="Has sub-diagram documentation" />
              )}
            </button>
          ))}
          {isCollapsible && (
            <button
              type="button"
              className="requirement-card__diagrams-toggle"
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? "Show fewer" : `+${hiddenCount} more`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
