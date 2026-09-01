import { ListChecks, Redo2, Undo2, Workflow } from "lucide-react";
import { ExportMenu } from "./ExportMenu";

interface ToolbarProps {
  title: string;
  onTitleChange: (title: string) => void;
  onNew: () => void;
  onSave: () => void;
  onLoadClick: () => void;
  isScenarioPanelOpen: boolean;
  onToggleScenarioPanel: () => void;
  onExportPng: () => void;
  onExportSvg: () => void;
  canExport: boolean;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  viewMode: "diagram" | "requirements";
  onSetViewMode: (mode: "diagram" | "requirements") => void;
  onExportRequirementsMarkdown: () => void;
  canExportRequirements: boolean;
}

export function Toolbar({
  title,
  onTitleChange,
  onNew,
  onSave,
  onLoadClick,
  isScenarioPanelOpen,
  onToggleScenarioPanel,
  onExportPng,
  onExportSvg,
  canExport,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  viewMode,
  onSetViewMode,
  onExportRequirementsMarkdown,
  canExportRequirements,
}: ToolbarProps) {
  return (
    <header className="toolbar">
      <div className="toolbar__brand">
        <span className="toolbar__brand-mark">SD</span>
        <span>System Design Editor</span>
      </div>
      <div className="toolbar__view-tabs">
        <button
          type="button"
          className={viewMode === "diagram" ? "active" : undefined}
          onClick={() => onSetViewMode("diagram")}
        >
          <Workflow size={13} />
          Diagram
        </button>
        <button
          type="button"
          className={viewMode === "requirements" ? "active" : undefined}
          onClick={() => onSetViewMode("requirements")}
        >
          <ListChecks size={13} />
          Requirements
        </button>
      </div>
      <input
        className="toolbar__title"
        value={title}
        onChange={(e) => onTitleChange(e.target.value)}
        aria-label="Diagram title"
      />
      <div className="toolbar__actions">
        <button
          type="button"
          className="toolbar__icon-button"
          onClick={onUndo}
          disabled={!canUndo}
          title="Undo (Ctrl+Z)"
          aria-label="Undo"
        >
          <Undo2 size={15} />
        </button>
        <button
          type="button"
          className="toolbar__icon-button"
          onClick={onRedo}
          disabled={!canRedo}
          title="Redo (Ctrl+Shift+Z or Ctrl+Y)"
          aria-label="Redo"
        >
          <Redo2 size={15} />
        </button>
        {viewMode === "diagram" && (
          <button type="button" className={isScenarioPanelOpen ? "active" : undefined} onClick={onToggleScenarioPanel}>
            Scenarios
          </button>
        )}
        {viewMode === "diagram" && <ExportMenu onExportPng={onExportPng} onExportSvg={onExportSvg} disabled={!canExport} />}
        {viewMode === "requirements" && (
          <button type="button" onClick={onExportRequirementsMarkdown} disabled={!canExportRequirements}>
            Export Markdown
          </button>
        )}
        <button type="button" onClick={onNew}>
          New
        </button>
        <button type="button" onClick={onLoadClick}>
          Open
        </button>
        <button type="button" className="primary" onClick={onSave}>
          Save
        </button>
      </div>
    </header>
  );
}
