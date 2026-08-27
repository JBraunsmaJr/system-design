export interface ShapeTypeDefinition {
  id: string;
  label: string;
  icon: string;
  color: string;
  defaultWidth: number;
  defaultHeight: number;
  /** Whether resizing this shape should preserve its aspect ratio - true for
   * Circle/Square (both should stay 1:1), false for Rectangle. */
  keepAspectRatio: boolean;
}

export const SHAPE_TYPES: ShapeTypeDefinition[] = [
  { id: "circle", label: "Circle", icon: "Circle", color: "#5B7CFA", defaultWidth: 100, defaultHeight: 100, keepAspectRatio: true },
  { id: "square", label: "Square", icon: "Square", color: "#5B7CFA", defaultWidth: 100, defaultHeight: 100, keepAspectRatio: true },
  { id: "rectangle", label: "Rectangle", icon: "RectangleHorizontal", color: "#5B7CFA", defaultWidth: 160, defaultHeight: 100, keepAspectRatio: false },
];

export function getShapeType(id: string): ShapeTypeDefinition | undefined {
  return SHAPE_TYPES.find((s) => s.id === id);
}
