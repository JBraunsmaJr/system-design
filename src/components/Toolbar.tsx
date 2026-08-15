interface ToolbarProps {
  title: string;
  onTitleChange: (title: string) => void;
  onNew: () => void;
  onSave: () => void;
  onLoadClick: () => void;
}

export function Toolbar({ title, onTitleChange, onNew, onSave, onLoadClick }: ToolbarProps) {
  return (
    <header className="toolbar">
      <div className="toolbar__brand">
        <span className="toolbar__brand-mark">SD</span>
        <span>System Design Editor</span>
      </div>
      <input
        className="toolbar__title"
        value={title}
        onChange={(e) => onTitleChange(e.target.value)}
        aria-label="Diagram title"
      />
      <div className="toolbar__actions">
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
