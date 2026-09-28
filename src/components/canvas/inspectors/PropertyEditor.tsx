export interface PropertyEditorProps {
  /** Optional in practice even where the type says otherwise: files and peers
   * can deliver nodes or edges without it (the schema-0.7 corpus fixture's
   * edges have none), and an unguarded Object.entries here crashed the whole
   * app the moment such an edge was selected. */
  properties: Record<string, string> | undefined;
  onChange: (p: Record<string, string>) => void;
}

export function PropertyEditor({ properties, onChange }: PropertyEditorProps) {
  const current = properties ?? {};
  const entries = Object.entries(current);
  return (
    <div className="inspector__field">
      <span>Properties</span>
      {entries.map(([key, value], index) => (
        <div className="property-row" key={index}>
          <input
            value={key}
            placeholder="key"
            onChange={(e) => {
              const next: Record<string, string> = {};
              Object.entries(current).forEach(([k, v]) => {
                next[k === key ? e.target.value : k] = v;
              });
              onChange(next);
            }}
          />
          <input
            value={value}
            placeholder="value"
            onChange={(e) => onChange({ ...current, [key]: e.target.value })}
          />
          <button
            type="button"
            className="property-row__remove"
            onClick={() => {
              const next = { ...current };
              delete next[key];
              onChange(next);
            }}
            aria-label={`Remove ${key || 'property'}`}
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        className="property-row__add"
        onClick={() => onChange({ ...current, ['']: '' })}
      >
        + Add property
      </button>
    </div>
  );
}
