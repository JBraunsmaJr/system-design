import { useState } from "react";
import { GitBranch, Lock, Trash2, X } from "lucide-react";
import type { RequirementsDocument } from "../../domain/requirementsTypes";

interface ManageRelationshipTypesModalProps {
  doc: RequirementsDocument;
  onAddCustomType: (label: string, inverseLabel: string, color: string, isBlocking: boolean) => void;
  onDeleteCustomType: (typeId: string) => void;
  onClose: () => void;
}

const DEFAULT_CUSTOM_COLOR = "#22B8CF";

export function ManageRelationshipTypesModal({
  doc,
  onAddCustomType,
  onDeleteCustomType,
  onClose,
}: ManageRelationshipTypesModalProps) {
  const [label, setLabel] = useState("");
  const [inverseLabel, setInverseLabel] = useState("");
  const [color, setColor] = useState(DEFAULT_CUSTOM_COLOR);
  const [isBlocking, setIsBlocking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = () => {
    const trimmedLabel = label.trim();
    // A relationship type without an inverse typed in is treated as
    // symmetric (like the built-in "Relates to") rather than requiring
    // the user to retype the same word twice for the common case.
    const trimmedInverse = inverseLabel.trim() || trimmedLabel;
    if (!trimmedLabel) {
      setError("A label is required.");
      return;
    }
    onAddCustomType(trimmedLabel, trimmedInverse, color, isBlocking);
    setLabel("");
    setInverseLabel("");
    setIsBlocking(false);
    setError(null);
  };

  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div className="manage-types-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="manage-types-modal__header">
          <span>Manage relationship types</span>
          <button type="button" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className="manage-types-modal__list">
          {doc.relationshipTypes.map((type) => (
            <div key={type.id} className="manage-types-modal__row">
              <span className="manage-types-modal__swatch" style={{ background: type.color }} />
              <span className="manage-types-modal__label">{type.label}</span>
              <span className="manage-types-modal__prefix">
                {type.inverseLabel !== type.label ? type.inverseLabel : "(symmetric)"}
              </span>
              {type.isBlocking && (
                <GitBranch
                  size={12}
                  className="manage-types-modal__workable"
                  aria-label="Represents a blocking dependency"
                />
              )}
              {type.isBuiltIn ? (
                <Lock size={12} className="manage-types-modal__lock" aria-label="Built-in type" />
              ) : (
                <button
                  type="button"
                  className="manage-types-modal__delete"
                  onClick={() => onDeleteCustomType(type.id)}
                  aria-label={`Delete ${type.label} relationship type`}
                  title="Delete this type (and any relationships using it)"
                >
                  <Trash2 size={12} />
                </button>
              )}
            </div>
          ))}
        </div>

        <div className="manage-types-modal__form">
          <input
            placeholder="Label, e.g. Depends on"
            value={label}
            onChange={(e) => {
              setLabel(e.target.value);
              setError(null);
            }}
          />
          <input
            placeholder="Inverse (optional), e.g. Is a dependency of"
            value={inverseLabel}
            onChange={(e) => {
              setInverseLabel(e.target.value);
              setError(null);
            }}
          />
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)} aria-label="Type color" />
          <label className="manage-types-modal__workable-toggle" title="Treated as an ordering constraint - checked for circular dependencies">
            <input type="checkbox" checked={isBlocking} onChange={(e) => setIsBlocking(e.target.checked)} />
            Blocking
          </label>
          <button type="button" className="primary" onClick={onSubmit}>
            Add type
          </button>
        </div>
        {error && <p className="manage-types-modal__error">{error}</p>}
      </div>
    </div>
  );
}
