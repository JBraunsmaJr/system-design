import type { ReactNode } from "react";
import {
  Check,
  ListChecks,
  CalendarRange,
  Users,
  Network,
  Redo2,
  Undo2,
  Workflow,
  Save,
  Route,
  FileDown,
  Package,
} from "lucide-react";
import { ExportMenu } from "./ExportMenu";
import { FileMenu } from "./FileMenu";
import {faGithub} from "@fortawesome/free-brands-svg-icons"
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome"

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
  viewMode: "diagram" | "requirements" | "timeline" | "team" | "skill-tree";
  onSetViewMode: (mode: "diagram" | "requirements" | "timeline" | "team" | "skill-tree") => void;
  onExportRequirementsMarkdown: () => void;
  canExportRequirements: boolean;
  onManageLibraries?: () => void;
  hasAutosaved: boolean;
  /** Whether a collaborative session is currently active - disables
   * Open (loading a file replaces the LOCAL, frozen state, which
   * wouldn't even be visible until the session ends, since the
   * displayed content comes from the live session snapshot instead;
   * silently loading something you then can't see is confusing, so
   * it's disabled outright rather than left to quietly do the wrong
   * thing). */
  isInSession: boolean;
  /** Rendered as the last item in the toolbar's own action button
   * group, so it's a genuine, in-flow flex item that participates in
   * this toolbar's own responsive wrapping/overflow behavior - rather
   * than a separately-positioned overlay with no relationship to
   * whatever space the rest of the toolbar's own content actually
   * needs at a given width. */
  collabPanel: ReactNode;
}

function navigateToGithubSource() {
  window.open(
      "https://github.com/jbraunsmajr/system-design", "_blank"
  )
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
  onManageLibraries,
  hasAutosaved,
  isInSession,
  collabPanel,
}: ToolbarProps) {
  return (
    <header className="toolbar">
      <div className="toolbar__row toolbar__row--primary">
        <div className="toolbar__brand">
          <span className="toolbar__brand-mark">SD</span>
          <span className="toolbar__brand-name">System Design Editor</span>
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
          {viewMode === "diagram" && onManageLibraries && (
            <button
              type="button"
              onClick={onManageLibraries}
              title="Manage Shape & Icon Libraries"
            >
              <Package size={14} />
              <span className="toolbar__label">Libraries</span>
            </button>
          )}
          {viewMode === "diagram" && <ExportMenu onExportPng={onExportPng} onExportSvg={onExportSvg} disabled={!canExport} />}
          {viewMode === "requirements" && (
            <button type="button" onClick={onExportRequirementsMarkdown} disabled={!canExportRequirements} title="Export Markdown">
              <FileDown size={14} />
              <span className="toolbar__label">Export Markdown</span>
            </button>
          )}
          <FileMenu onNew={onNew} onLoadClick={onLoadClick} onManageLibraries={onManageLibraries} isInSession={isInSession} />
          <button type="button" className="primary" onClick={onSave} title="Save">
            <Save size={14} />
            <span className="toolbar__label">Save</span>
          </button>
          {collabPanel}
          <button type="button" title={"View source on GitHub"} onClick={navigateToGithubSource}>
            <FontAwesomeIcon icon={faGithub} size={"lg"} />
          </button>
        </div>
      </div>
      <div className="toolbar__row toolbar__row--tabs">
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
          <button
            type="button"
            className={viewMode === "skill-tree" ? "active" : undefined}
            onClick={() => onSetViewMode("skill-tree")}
            title="Skill Tree - see what's ready to work on"
          >
            <Network size={13} />
            <span className="toolbar__label">Skill Tree</span>
          </button>
        </div>
      </div>
    </header>
  );
}
