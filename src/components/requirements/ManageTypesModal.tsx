import { useState } from "react";
import { Lock, Trash2, X } from "lucide-react";
import { isPrefixTaken } from "../../domain/requirementsRegistry";
import type { RequirementsDocument } from "../../domain/requirementsTypes";

interface ManageTypesModalProps {
  doc: RequirementsDocument;
  onAddCustomType: (label: string, prefix: string, color: string) => boolean;
  onDeleteCustomType: (typeId: string) => void;
  onClose: () => void;
}

const DEFAULT_CUSTOM_COLOR = "#22B8CF";

export function ManageTypesModal({ doc, onAddCustomType, onDeleteCustomType, onClose }: ManageTypesModalProps) {
  const [label, setLabel] = useState("");
  const [prefix, setPrefix] = useState("");
  const [color, setColor] = useState(DEFAULT_CUSTOM_COLOR);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = () => {
    const trimmedLabel = label.trim();
    const trimmedPrefix = prefix.trim().toUpperCase();
    if (!trimmedLabel || !trimmedPrefix) {
      setError("Both a label and a prefix are required.");
      return;
    }
    if (!/^[A-Z][A-Z0-9]*$/.test(trimmedPrefix)) {
      setError("Prefix must start with a letter and contain only letters/numbers.");
      return;
    }
    if (isPrefixTaken(doc, trimmedPrefix)) {
      setError(`"${trimmedPrefix}" is already used by another type.`);
      return;
    }
    const added = onAddCustomType(trimmedLabel, trimmedPrefix, color);
    if (!added) {
      setError(`"${trimmedPrefix}" is already used by another type.`);
      return;
    }
    setLabel("");
    setPrefix("");
    setError(null);
  };

  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div className="manage-types-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="manage-types-modal__header">
          <span>Manage item types</span>
          <button type="button" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className="manage-types-modal__list">
          {doc.itemTypes.map((type) => (
            <div key={type.id} className="manage-types-modal__row">
              <span className="manage-types-modal__swatch" style={{ background: type.color }} />
              <span className="manage-types-modal__label">{type.label}</span>
              <span className="manage-types-modal__prefix">{type.prefix}-</span>
              {type.isBuiltIn ? (
                <Lock size={12} className="manage-types-modal__lock" aria-label="Built-in type" />
              ) : (
                <button
                  type="button"
                  className="manage-types-modal__delete"
                  onClick={() => onDeleteCustomType(type.id)}
                  aria-label={`Delete ${type.label} type`}
                  title="Delete this type (and any items using it)"
                >
                  <Trash2 size={12} />
                </button>
              )}
            </div>
          ))}
        </div>

        <div className="manage-types-modal__form">
          <input
            placeholder="Label, e.g. Constraint"
            value={label}
            onChange={(e) => {
              setLabel(e.target.value);
              setError(null);
            }}
          />
          <input
            placeholder="Prefix, e.g. CON"
            value={prefix}
            onChange={(e) => {
              setPrefix(e.target.value);
              setError(null);
            }}
            style={{ width: 90 }}
          />
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)} aria-label="Type color" />
          <button type="button" className="primary" onClick={onSubmit}>
            Add type
          </button>
        </div>
        {error && <p className="manage-types-modal__error">{error}</p>}
      </div>
    </div>
  );
}
