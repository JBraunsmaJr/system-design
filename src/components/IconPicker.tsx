import { useMemo, useState } from "react";
import * as Icons from "lucide-react";

// lucide-react exports every icon under three names (e.g. "Zap", "ZapIcon",
// "LucideZap") plus a handful of genuinely non-icon exports (LucideProvider,
// createLucideIcon, the base Icon component). This filter was verified
// against the installed package directly - checked for broken/undefined
// entries in the result - rather than assumed, since a bad filter here
// would show broken icon buttons throughout the picker.
const ALL_ICON_NAMES = Object.keys(Icons)
  .filter((name) => /^[A-Z]/.test(name) && !name.endsWith("Icon") && !name.startsWith("Lucide"))
  .sort();

const RESULT_LIMIT = 60;

interface IconPickerProps {
  /** Current override, if any - undefined means "use defaultValue". */
  value: string | undefined;
  /** The node type's own default icon, shown when there's no override. */
  defaultValue: string;
  onChange: (icon: string | undefined) => void;
}

export function IconPicker({ value, defaultValue, onChange }: IconPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pool = q ? ALL_ICON_NAMES.filter((name) => name.toLowerCase().includes(q)) : ALL_ICON_NAMES;
    return pool.slice(0, RESULT_LIMIT);
  }, [query]);

  const resolved = value ?? defaultValue;
  const CurrentIcon = (Icons[resolved as keyof typeof Icons] as Icons.LucideIcon) || Icons.Box;

  return (
    <label className="inspector__field">
      <span>Icon</span>
      <div className="icon-picker">
        <div className="icon-picker__row">
          <button
            type="button"
            className="icon-picker__trigger"
            onClick={() => setIsOpen((v) => !v)}
            aria-expanded={isOpen}
          >
            <CurrentIcon size={15} />
            <span>{resolved}</span>
          </button>
          {value && (
            <button
              type="button"
              className="color-field__reset"
              onClick={() => {
                onChange(undefined);
                setIsOpen(false);
              }}
            >
              Reset
            </button>
          )}
        </div>

        {isOpen && (
          <div className="icon-picker__panel">
            <input
              className="icon-picker__search"
              type="text"
              placeholder="Search icons..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus
            />
            {results.length > 0 ? (
              <div className="icon-picker__grid">
                {results.map((name) => {
                  const IconComp = Icons[name as keyof typeof Icons] as Icons.LucideIcon;
                  return (
                    <button
                      key={name}
                      type="button"
                      className={`icon-picker__item${name === resolved ? " is-selected" : ""}`}
                      title={name}
                      onClick={() => {
                        onChange(name);
                        setIsOpen(false);
                        setQuery("");
                      }}
                    >
                      <IconComp size={16} />
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="icon-picker__empty">No icons match "{query}"</p>
            )}
            {!query && (
              <p className="icon-picker__hint">
                Showing the first {RESULT_LIMIT} of {ALL_ICON_NAMES.length} icons - type to search all of them.
              </p>
            )}
          </div>
        )}
      </div>
    </label>
  );
}
