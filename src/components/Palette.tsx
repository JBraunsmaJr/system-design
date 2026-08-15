import * as Icons from "lucide-react";
import { NODE_TYPES, CATEGORY_LABELS, CATEGORY_COLORS } from "../domain/nodeRegistry";
import type { NodeCategory } from "../domain/types";

const CATEGORY_ORDER = Object.keys(CATEGORY_LABELS) as NodeCategory[];

export const DRAG_MIME_TYPE = "application/x-archnode";

export function Palette() {
  return (
    <aside className="palette">
      <div className="panel-header">Components</div>
      <div className="palette__list">
        {CATEGORY_ORDER.map((category) => {
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
      </div>
      <p className="palette__hint">Drag a component onto the canvas to place it.</p>
    </aside>
  );
}
