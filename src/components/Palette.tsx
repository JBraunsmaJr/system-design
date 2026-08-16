import { useState, type DragEvent } from "react";
import * as Icons from "lucide-react";
import {
  NODE_TYPES,
  CATEGORY_LABELS,
  CATEGORY_COLORS,
  LOGIC_SUBCATEGORY_ORDER,
} from "../domain/nodeRegistry";
import { GROUP_TYPES } from "../domain/groupRegistry";
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

type PaletteMode = "system" | "code";

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
      </div>

      <div className="palette__list">
        {mode === "code" && (
          <p className="palette__mode-hint">
            Endpoints and pseudo-code steps for modeling request-handling logic - most useful
            inside a node's sub-diagram (double-click a node to drill in).
          </p>
        )}

        {mode === "system"
          ? SYSTEM_CATEGORIES.map((category) => (
              <PaletteGroup
                key={category}
                label={CATEGORY_LABELS[category]}
                color={CATEGORY_COLORS[category]}
                items={NODE_TYPES.filter((n) => n.category === category)}
              />
            ))
          : LOGIC_SUBCATEGORY_ORDER.map((subcategory) => (
              <PaletteGroup
                key={subcategory}
                label={subcategory}
                color="#8b90a0"
                items={NODE_TYPES.filter((n) => n.category === "logic" && n.subcategory === subcategory)}
              />
            ))}

        <PaletteGroup
          label="Boundaries"
          color="#8b90a0"
          items={GROUP_TYPES.map((g) => ({ id: g.id, label: g.label, icon: "SquareDashed", color: "#8b90a0" }))}
          isGroupPalette
        />
      </div>
      <p className="palette__hint">
        Drag a component onto the canvas to place it. Drag a component into a boundary to group
        it - drag it back out to release.
      </p>
    </aside>
  );
}

interface PaletteGroupProps {
  label: string;
  color: string;
  items: Pick<NodeTypeDefinition, "id" | "label" | "icon" | "color">[];
  /** True for the Boundaries section, which drags groups rather than typed nodes. */
  isGroupPalette?: boolean;
}

function PaletteGroup({ label, color, items, isGroupPalette }: PaletteGroupProps) {
  if (!items.length) return null;

  const onDragStart = (event: DragEvent, itemId: string) => {
    event.dataTransfer.setData(isGroupPalette ? GROUP_DRAG_MIME_TYPE : DRAG_MIME_TYPE, itemId);
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
