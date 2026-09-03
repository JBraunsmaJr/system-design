import {
  Check,
  ListChecks,
  CalendarRange,
  Users,
  Redo2,
  Undo2,
  Workflow,
  FilePlus2,
  FolderOpen,
  Save,
  Route,
  FileDown,
} from "lucide-react";
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
  viewMode: "diagram" | "requirements" | "timeline" | "team";
  onSetViewMode: (mode: "diagram" | "requirements" | "timeline" | "team") => void;
  onExportRequirementsMarkdown: () => void;
  canExportRequirements: boolean;
  hasAutosaved: boolean;
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
  hasAutosaved,
}: ToolbarProps) {
  return (
    <header className="toolbar">
      <div className="toolbar__brand">
        <span className="toolbar__brand-mark">SD</span>
        <span className="toolbar__brand-name">System Design Editor</span>
      </div>
      <div className="toolbar__view-tabs">
        <button
          type="button"
          className={viewMode === "diagram" ? "active" : undefined}
          onClick={() => onSetViewMode("diagram")}
          title="Diagram"
        >
          <Workflow size={13} />
          <span className="toolbar__label">Diagram</span>
        </button>
        <button
          type="button"
          className={viewMode === "requirements" ? "active" : undefined}
          onClick={() => onSetViewMode("requirements")}
          title="Requirements"
        >
          <ListChecks size={13} />
          <span className="toolbar__label">Requirements</span>
        </button>
        <button
          type="button"
          className={viewMode === "timeline" ? "active" : undefined}
          onClick={() => onSetViewMode("timeline")}
          title="Timeline"
        >
          <CalendarRange size={13} />
          <span className="toolbar__label">Timeline</span>
        </button>
        <button
          type="button"
          className={viewMode === "team" ? "active" : undefined}
          onClick={() => onSetViewMode("team")}
          title="Team & Capacity"
        >
          <Users size={13} />
          <span className="toolbar__label">Team</span>
        </button>
      </div>
      <input
        className="toolbar__title"
        value={title}
        onChange={(e) => onTitleChange(e.target.value)}
        aria-label="Diagram title"
      />
      {hasAutosaved && (
        <span className="toolbar__autosave-indicator" title="Your work is automatically saved in this browser">
          <Check size={12} />
          <span className="toolbar__label">Autosaved</span>
        </span>
      )}
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
          <button
            type="button"
            className={isScenarioPanelOpen ? "active" : undefined}
            onClick={onToggleScenarioPanel}
            title="Scenarios"
          >
            <Route size={14} />
            <span className="toolbar__label">Scenarios</span>
          </button>
        )}
        {viewMode === "diagram" && <ExportMenu onExportPng={onExportPng} onExportSvg={onExportSvg} disabled={!canExport} />}
        {viewMode === "requirements" && (
          <button type="button" onClick={onExportRequirementsMarkdown} disabled={!canExportRequirements} title="Export Markdown">
            <FileDown size={14} />
            <span className="toolbar__label">Export Markdown</span>
          </button>
        )}
        <button type="button" onClick={onNew} title="New">
          <FilePlus2 size={14} />
          <span className="toolbar__label">New</span>
        </button>
        <button type="button" onClick={onLoadClick} title="Open">
          <FolderOpen size={14} />
          <span className="toolbar__label">Open</span>
        </button>
        <button type="button" className="primary" onClick={onSave} title="Save">
          <Save size={14} />
          <span className="toolbar__label">Save</span>
        </button>
      </div>
    </header>
  );
}
