import { useState, type DragEvent } from "react";
import * as Icons from "lucide-react";
import {
  NODE_TYPES,
  CATEGORY_LABELS,
  CATEGORY_COLORS,
  LOGIC_SUBCATEGORY_ORDER,
  VCS_SUBCATEGORY_ORDER,
} from "../domain/nodeRegistry";
import { GROUP_TYPES } from "../domain/groupRegistry";
import { SHAPE_TYPES } from "../domain/shapeRegistry";
import type { NodeCategory, NodeTypeDefinition } from "../domain/types";

const SYSTEM_CATEGORIES: NodeCategory[] = [
  "compute",
  "data",
  "networking",
  "messaging",
  "external",
  "observability",
];

export const DRAG_MIME_TYPE = "application/x-archnode";
export const GROUP_DRAG_MIME_TYPE = "application/x-archgroup";
export const TEXT_DRAG_MIME_TYPE = "application/x-archtext";
export const SHAPE_DRAG_MIME_TYPE = "application/x-archshape";
export const CODE_DRAG_MIME_TYPE = "application/x-archcode";

type PaletteMode = "system" | "code" | "git";

const MODE_HINTS: Record<PaletteMode, string | null> = {
  system: null,
  code: "Endpoints and pseudo-code steps for modeling request-handling logic - most useful inside a node's sub-diagram (double-click a node to drill in).",
  git: "Branching strategy and release/CI pipeline concepts - handy for a repo's own sub-diagram, or a standalone diagram of your workflow.",
};

export function Palette() {
  const [mode, setMode] = useState<PaletteMode>("system");

  return (
    <aside className="palette">
      <div className="palette__tabs">
        <button
          type="button"
          className={mode === "system" ? "is-active" : undefined}
          onClick={() => setMode("system")}
        >
          System
        </button>
        <button
          type="button"
          className={mode === "code" ? "is-active" : undefined}
          onClick={() => setMode("code")}
        >
          Code
        </button>
        <button
          type="button"
          className={mode === "git" ? "is-active" : undefined}
          onClick={() => setMode("git")}
        >
          Git
        </button>
      </div>

      <div className="palette__list">
        {MODE_HINTS[mode] && <p className="palette__mode-hint">{MODE_HINTS[mode]}</p>}

        {mode === "system" &&
          SYSTEM_CATEGORIES.map((category) => (
            <PaletteGroup
              key={category}
              label={CATEGORY_LABELS[category]}
              color={CATEGORY_COLORS[category]}
              dragMimeType={DRAG_MIME_TYPE}
              items={NODE_TYPES.filter((n) => n.category === category)}
            />
          ))}

        {mode === "code" &&
          LOGIC_SUBCATEGORY_ORDER.map((subcategory) => (
            <PaletteGroup
              key={subcategory}
              label={subcategory}
              color="#8b90a0"
              dragMimeType={DRAG_MIME_TYPE}
              items={NODE_TYPES.filter((n) => n.category === "logic" && n.subcategory === subcategory)}
            />
          ))}

        {mode === "git" &&
          VCS_SUBCATEGORY_ORDER.map((subcategory) => (
            <PaletteGroup
              key={subcategory}
              label={subcategory}
              color="#8b90a0"
              dragMimeType={DRAG_MIME_TYPE}
              items={NODE_TYPES.filter((n) => n.category === "vcs" && n.subcategory === subcategory)}
            />
          ))}

        <PaletteGroup
          label="Custom"
          color={CATEGORY_COLORS.custom}
          dragMimeType={DRAG_MIME_TYPE}
          items={NODE_TYPES.filter((n) => n.category === "custom")}
        />

        <PaletteGroup
          label="Boundaries"
          color="#8b90a0"
          dragMimeType={GROUP_DRAG_MIME_TYPE}
          items={GROUP_TYPES.map((g) => ({ id: g.id, label: g.label, icon: g.icon, color: g.color }))}
        />

        <PaletteGroup
          label="Shapes"
          color="#8b90a0"
          dragMimeType={SHAPE_DRAG_MIME_TYPE}
          items={SHAPE_TYPES.map((s) => ({ id: s.id, label: s.label, icon: s.icon, color: s.color }))}
        />

        <PaletteGroup
          label="Code"
          color="#22B8CF"
          dragMimeType={CODE_DRAG_MIME_TYPE}
          items={[{ id: "code", label: "Code Snippet", icon: "FileCode2", color: "#22B8CF" }]}
        />

        <PaletteGroup
          label="Annotations"
          color="#8b90a0"
          dragMimeType={TEXT_DRAG_MIME_TYPE}
          items={[{ id: "text", label: "Text", icon: "Type", color: "#8b90a0" }]}
        />
      </div>
      <p className="palette__hint">
        Drag a component onto the canvas to place it. Drag a boundary over existing nodes (or
        nodes into a boundary) to group them - drag either back out to release.
      </p>
    </aside>
  );
}

interface PaletteGroupProps {
  label: string;
  color: string;
  items: Pick<NodeTypeDefinition, "id" | "label" | "icon" | "color">[];
  dragMimeType: string;
}

function PaletteGroup({ label, color, items, dragMimeType }: PaletteGroupProps) {
  if (!items.length) return null;

  const onDragStart = (event: DragEvent, itemId: string) => {
    event.dataTransfer.setData(dragMimeType, itemId);
    event.dataTransfer.effectAllowed = "move";
  };

  return (
    <div className="palette__group">
      <div className="palette__group-label" style={{ color }}>
        {label}
      </div>
      {items.map((item) => {
        const IconComponent = (Icons[item.icon as keyof typeof Icons] as Icons.LucideIcon) || Icons.Box;
        return (
          <div
            key={item.id}
            className="palette__item"
            draggable
            onDragStart={(event) => onDragStart(event, item.id)}
          >
            <IconComponent size={15} style={{ color: item.color }} />
            <span>{item.label}</span>
          </div>
        );
      })}
    </div>
  );
}
