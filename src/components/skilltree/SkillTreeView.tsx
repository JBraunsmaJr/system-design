import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, CircleDot, Lock, Unlock } from "lucide-react";
import { computeSkillTree, type SkillTreeNode } from "../../domain/skillTree";
import { getItemType, addRelationship } from "../../domain/requirementsRegistry";
import { RequirementDetailModal } from "../timeline/RequirementDetailModal";
import type { RequirementItem, RequirementsDocument } from "../../domain/requirementsTypes";
import type { ProgramIncrement } from "../../domain/programIncrements";
import type { TeamDocument } from "../../domain/teamTypes";
import type { SubDiagram } from "../../domain/types";
import type { DiagramPath } from "../../domain/subDiagramTree";

interface SkillTreeViewProps {
  requirements: RequirementsDocument;
  onUpdateRequirements: (updater: (doc: RequirementsDocument) => RequirementsDocument) => void;
  programIncrements: ProgramIncrement[];
  team?: TeamDocument;
  diagramRoot?: SubDiagram;
  onNavigateToNode?: (path: DiagramPath, nodeId: string) => void;
  onCreateLinkedNode?: (itemId: string, label: string) => void;
  onNavigateToRequirement?: (itemId: string) => void;
}

const RANK_WIDTH = 260;
const CARD_HEIGHT = 92;
const CARD_WIDTH = 220;

function stateIcon(node: SkillTreeNode) {
  if (node.state === "done") return <CheckCircle2 size={13} />;
  if (node.state === "in-progress") return <CircleDot size={13} />;
  if (node.state === "locked") return <Lock size={13} />;
  return <Unlock size={13} />;
}

/**
 * Rank/index -> pixel position, computed directly from the same source
 * as everything else here (no DOM measurement needed, unlike a
 * dropdown's position) - a rank is a column, items within a rank stack
 * vertically in a stable order (the order they appear in doc.items,
 * i.e. creation order, rather than an unstable sort like item id string
 * order which would put "TICKET-10" before "TICKET-2").
 */
function useSkillTreeLayout(nodes: SkillTreeNode[]) {
  return useMemo(() => {
    const byRank = new Map<number, SkillTreeNode[]>();
    for (const node of nodes) {
      const list = byRank.get(node.rank) ?? [];
      list.push(node);
      byRank.set(node.rank, list);
    }
    const positions = new Map<string, { x: number; y: number }>();
    let maxCount = 0;
    for (const list of byRank.values()) {
      maxCount = Math.max(maxCount, list.length);
      list.forEach((node, index) => {
        positions.set(node.item.id, { x: node.rank * RANK_WIDTH, y: index * CARD_HEIGHT });
      });
    }
    const maxRank = nodes.length > 0 ? Math.max(...nodes.map((n) => n.rank)) : 0;
    return {
      positions,
      totalWidth: (maxRank + 1) * RANK_WIDTH,
      totalHeight: Math.max(1, maxCount) * CARD_HEIGHT,
    };
  }, [nodes]);
}

/**
 * Edges and cards are both positioned from the SAME computed
 * rank/index coordinates, not from a DOM measurement of one to match
 * the other - unlike the Gantt view's earlier "should I draw connector
 * lines" question (where the two things being connected were each
 * independently, dynamically laid out and measuring one from the other
 * was real complexity), here the layout itself is the single source of
 * truth for both, so drawing the lines is just arithmetic on numbers
 * this component already has.
 */
export function SkillTreeView({
  requirements,
  onUpdateRequirements,
  programIncrements,
  team,
  diagramRoot,
  onNavigateToNode,
  onCreateLinkedNode,
  onNavigateToRequirement,
}: SkillTreeViewProps) {
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);

  const tree = useMemo(() => computeSkillTree(requirements), [requirements]);
  const { positions, totalWidth, totalHeight } = useSkillTreeLayout(tree.nodes);
  // Edge rendering below needs to look up the blocked-side node's state for
  // every edge (to color the path). Without this, tree.nodes.find(...)
  // inside the edges.map would be a linear search per edge - O(edges *
  // nodes) total. One map built here makes each lookup O(1), for O(nodes +
  // edges) overall.
  const nodeByItemId = useMemo(() => new Map(tree.nodes.map((n) => [n.item.id, n])), [tree.nodes]);

  const blockedDespiteProgress = tree.nodes.filter((n) => n.isBlockedDespiteProgress);
  const cycleWarnings = tree.nodes.filter((n) => n.inCycle);

  const onUpdateItem = (id: string, patch: Partial<RequirementItem>) => {
    onUpdateRequirements((doc) => ({
      ...doc,
      items: doc.items.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    }));
  };

  const onDeleteItem = (id: string) => {
    onUpdateRequirements((doc) => ({
      ...doc,
      items: doc.items.filter((item) => item.id !== id),
      relationships: doc.relationships.filter((r) => r.fromItemId !== id && r.toItemId !== id),
    }));
    setSelectedItemId(null);
  };

  const onCreateAndAssignCategory = (itemId: string, label: string) => {
    const trimmed = label.trim();
    if (!trimmed) return;
    onUpdateRequirements((doc) => {
      const existing = doc.categories.find((c) => c.label.toLowerCase() === trimmed.toLowerCase());
      if (existing) {
        return { ...doc, items: doc.items.map((item) => (item.id === itemId ? { ...item, categoryId: existing.id } : item)) };
      }
      const newCategory = { id: `cat-${Date.now().toString(36)}`, label: trimmed, color: "#22B8CF" };
      return {
        ...doc,
        categories: [...doc.categories, newCategory],
        items: doc.items.map((item) => (item.id === itemId ? { ...item, categoryId: newCategory.id } : item)),
      };
    });
  };

  const onAddRelationship = (typeId: string, fromItemId: string, toItemId: string): string | null => {
    const result = addRelationship(requirements, typeId, fromItemId, toItemId);
    if (result.error) return result.error;
    onUpdateRequirements((doc) => ({ ...doc, relationships: result.relationships }));
    return null;
  };

  const onDeleteRelationship = (relationshipId: string) => {
    onUpdateRequirements((doc) => ({ ...doc, relationships: doc.relationships.filter((r) => r.id !== relationshipId) }));
  };

  const selectedItem = selectedItemId ? requirements.items.find((i) => i.id === selectedItemId) : null;

  if (tree.nodes.length === 0) {
    return (
      <div className="skill-tree__empty">
        <p>
          No workable items yet - add a Ticket (or any type marked "Workable" in Manage Types) from the Requirements
          tab to see it here.
        </p>
      </div>
    );
  }

  return (
    <div className="skill-tree">
      {(blockedDespiteProgress.length > 0 || cycleWarnings.length > 0) && (
        <div className="skill-tree__warnings">
          {blockedDespiteProgress.length > 0 && (
            <div className="skill-tree__warning-row">
              <AlertTriangle size={13} />
              <span>
                {blockedDespiteProgress.length} in-progress {blockedDespiteProgress.length === 1 ? "item is" : "items are"}{" "}
                blocked by unfinished work: {blockedDespiteProgress.map((n) => n.item.id).join(", ")}
              </span>
            </div>
          )}
          {cycleWarnings.length > 0 && (
            <div className="skill-tree__warning-row">
              <AlertTriangle size={13} />
              <span>
                {cycleWarnings.length} {cycleWarnings.length === 1 ? "item is" : "items are"} part of a circular
                dependency in the underlying data and couldn't be placed normally: {cycleWarnings.map((n) => n.item.id).join(", ")}
              </span>
            </div>
          )}
        </div>
      )}

      <div className="skill-tree__scroll">
        <div className="skill-tree__canvas" style={{ width: totalWidth, height: totalHeight }}>
          <svg className="skill-tree__edges" width={totalWidth} height={totalHeight}>
            {tree.edges.map((edge, i) => {
              const from = positions.get(edge.fromItemId);
              const to = positions.get(edge.toItemId);
              if (!from || !to) return null;
              const blockedNode = nodeByItemId.get(edge.toItemId);
              const isActivePath = blockedNode?.state !== "locked";
              const x1 = from.x + CARD_WIDTH;
              const y1 = from.y + CARD_HEIGHT / 2 - 10;
              const x2 = to.x;
              const y2 = to.y + CARD_HEIGHT / 2 - 10;
              const midX = (x1 + x2) / 2;
              return (
                <path
                  key={i}
                  d={`M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`}
                  className={`skill-tree__edge-path${isActivePath ? " is-active" : ""}`}
                  fill="none"
                />
              );
            })}
          </svg>

          {tree.nodes.map((node) => {
            const pos = positions.get(node.item.id);
            if (!pos) return null;
            const type = getItemType(requirements, node.item.typeId);
            return (
              <button
                key={node.item.id}
                type="button"
                className={`skill-tree__card is-${node.state}`}
                style={{ left: pos.x, top: pos.y, width: CARD_WIDTH }}
                onClick={() => setSelectedItemId(node.item.id)}
                title={`${node.item.id}: ${node.item.title || "Untitled"}`}
              >
                <div className="skill-tree__card-top">
                  <span className="skill-tree__card-id" style={{ color: type?.color ?? "var(--chrome-text-dim)" }}>
                    {node.item.id}
                  </span>
                  <span className="skill-tree__card-state-icon">{stateIcon(node)}</span>
                  {node.isBlockedDespiteProgress && (
                    <AlertTriangle size={12} className="skill-tree__card-warning" aria-label="Blocked by unfinished work" />
                  )}
                </div>
                <div className="skill-tree__card-title">{node.item.title || "Untitled"}</div>
              </button>
            );
          })}
        </div>
      </div>

      {selectedItem && (
        <RequirementDetailModal
          item={selectedItem}
          doc={requirements}
          programIncrements={programIncrements}
          team={team}
          diagramRoot={diagramRoot}
          onNavigateToNode={onNavigateToNode}
          onCreateLinkedNode={onCreateLinkedNode}
          onClose={() => setSelectedItemId(null)}
          onUpdateItem={onUpdateItem}
          onDeleteItem={onDeleteItem}
          onNavigateToRequirement={onNavigateToRequirement}
          onSelectItem={(id) => setSelectedItemId(id)}
          onCreateAndAssignCategory={onCreateAndAssignCategory}
          onAddRelationship={onAddRelationship}
          onDeleteRelationship={onDeleteRelationship}
        />
      )}
    </div>
  );
}
