import type { ZOrderCommand } from '../../../domain/canvas/zOrder';
import { ZOrderControls } from './ZOrderControls';

export interface MultiSelectInspectorProps {
  selectedCount: number;
  onZOrderCommand: (command: ZOrderCommand) => void;
}

export function MultiSelectInspector({
  selectedCount,
  onZOrderCommand,
}: MultiSelectInspectorProps) {
  return (
    <aside className="inspector">
      <div className="panel-header">Selection ({selectedCount})</div>
      <p className="inspector__hint">
        {selectedCount} elements selected. Arrange their stacking order or edit them individually.
      </p>
      <ZOrderControls onCommand={onZOrderCommand} />
    </aside>
  );
}
