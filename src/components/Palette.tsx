import { useState } from "react";
import * as Icons from "lucide-react";
import { NODE_TYPES, CATEGORY_LABELS, CATEGORY_COLORS } from "../domain/nodeRegistry";
import { GROUP_TYPES } from "../domain/groupRegistry";
import type { NodeCategory } from "../domain/types";

const SYSTEM_CATEGORIES: NodeCategory[] = [
  "compute",
  "data",
  "networking",
  "messaging",
  "external",
  "observability",
];
const CODE_CATEGORIES: NodeCategory[] = ["logic"];

export const DRAG_MIME_TYPE = "application/x-archnode";
export const GROUP_DRAG_MIME_TYPE = "application/x-archgroup";

type PaletteMode = "system" | "code";

export function Palette() {
  const [mode, setMode] = useState<PaletteMode>("system");
  const categories = mode === "system" ? SYSTEM_CATEGORIES : CODE_CATEGORIES;

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

        {categories.map((category) => {
          const items = NODE_TYPES.filter((n) => n.category === category);
          if (!items.length) return null;
          return (
            <div className="palette__group" key={category}>
              <div className="palette__group-label" style={{ color: CATEGORY_COLORS[category] }}>
                {CATEGORY_LABELS[category]}
              </div>
              {items.map((item) => {
                const IconComponent =
                  (Icons[item.icon as keyof typeof Icons] as Icons.LucideIcon) || Icons.Box;
                return (
                  <div
                    key={item.id}
                    className="palette__item"
                    draggable
                    onDragStart={(event) => {
                      event.dataTransfer.setData(DRAG_MIME_TYPE, item.id);
                      event.dataTransfer.effectAllowed = "move";
                    }}
                  >
                    <IconComponent size={15} style={{ color: item.color }} />
                    <span>{item.label}</span>
                  </div>
                );
              })}
            </div>
          );
        })}

        <div className="palette__group">
          <div className="palette__group-label" style={{ color: "#8b90a0" }}>
            Boundaries
          </div>
          {GROUP_TYPES.map((group) => (
            <div
              key={group.id}
              className="palette__item"
              draggable
              onDragStart={(event) => {
                event.dataTransfer.setData(GROUP_DRAG_MIME_TYPE, group.id);
                event.dataTransfer.effectAllowed = "move";
              }}
            >
              <Icons.SquareDashed size={15} style={{ color: "#8b90a0" }} />
              <span>{group.label}</span>
            </div>
          ))}
        </div>
      </div>
      <p className="palette__hint">
        Drag a component onto the canvas to place it. Drag a component into a boundary to group
        it - drag it back out to release.
      </p>
    </aside>
  );
}
