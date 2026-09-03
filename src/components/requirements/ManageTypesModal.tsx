import { useState } from "react";
import { Briefcase, Check, Lock, Pencil, Trash2, X } from "lucide-react";
import { isPrefixTaken } from "../../domain/requirementsRegistry";
import type { RequirementItemType, RequirementsDocument } from "../../domain/requirementsTypes";

interface ManageTypesModalProps {
  doc: RequirementsDocument;
  onAddCustomType: (label: string, prefix: string, color: string, isWorkable: boolean) => boolean;
  onUpdateType: (typeId: string, patch: Partial<Pick<RequirementItemType, "label" | "color" | "isWorkable">>) => void;
  onDeleteCustomType: (typeId: string) => void;
  onClose: () => void;
}

const DEFAULT_CUSTOM_COLOR = "#22B8CF";

export function ManageTypesModal({ doc, onAddCustomType, onUpdateType, onDeleteCustomType, onClose }: ManageTypesModalProps) {
  const [label, setLabel] = useState("");
  const [prefix, setPrefix] = useState("");
  const [color, setColor] = useState(DEFAULT_CUSTOM_COLOR);
  const [isWorkable, setIsWorkable] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Editing an existing type - label/color/isWorkable only, never prefix
  // (see onUpdateType's own doc comment in RequirementsView for why
  // prefix specifically stays locked once a type exists). Tracked as one
  // "which row" id plus its own draft fields, rather than editable state
  // living on every row at once, since only one row is ever being edited
  // at a time.
  const [editingTypeId, setEditingTypeId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [editColor, setEditColor] = useState("");
  const [editWorkable, setEditWorkable] = useState(false);

  const startEditing = (type: RequirementItemType) => {
    setEditingTypeId(type.id);
    setEditLabel(type.label);
    setEditColor(type.color);
    setEditWorkable(type.isWorkable);
  };
  const cancelEditing = () => setEditingTypeId(null);
  const saveEditing = () => {
    if (!editingTypeId) return;
    const trimmed = editLabel.trim();
    if (!trimmed) return;
    onUpdateType(editingTypeId, { label: trimmed, color: editColor, isWorkable: editWorkable });
    setEditingTypeId(null);
  };

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
    const added = onAddCustomType(trimmedLabel, trimmedPrefix, color, isWorkable);
    if (!added) {
      setError(`"${trimmedPrefix}" is already used by another type.`);
      return;
    }
    setLabel("");
    setPrefix("");
    setIsWorkable(false);
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
          {doc.itemTypes.map((type) =>
            editingTypeId === type.id ? (
              <div key={type.id} className="manage-types-modal__row manage-types-modal__row--editing">
                <input
                  type="color"
                  value={editColor}
                  onChange={(e) => setEditColor(e.target.value)}
                  aria-label="Edit type color"
                  className="manage-types-modal__edit-color"
                />
                <input
                  value={editLabel}
                  onChange={(e) => setEditLabel(e.target.value)}
                  aria-label="Edit type label"
                  className="manage-types-modal__edit-label"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter") saveEditing();
                    if (e.key === "Escape") cancelEditing();
                  }}
                />
                <span className="manage-types-modal__prefix">{type.prefix}-</span>
                <label className="manage-types-modal__workable-toggle">
                  <input
                    type="checkbox"
                    checked={editWorkable}
                    onChange={(e) => setEditWorkable(e.target.checked)}
                  />
                  Workable
                </label>
                <button
                  type="button"
                  className="manage-types-modal__save"
                  onClick={saveEditing}
                  disabled={!editLabel.trim()}
                  aria-label="Save changes"
                  title="Save"
                >
                  <Check size={13} />
                </button>
                <button
                  type="button"
                  className="manage-types-modal__cancel"
                  onClick={cancelEditing}
                  aria-label="Cancel editing"
                  title="Cancel"
                >
                  <X size={13} />
                </button>
              </div>
            ) : (
              <div key={type.id} className="manage-types-modal__row">
                <span className="manage-types-modal__swatch" style={{ background: type.color }} />
                <span className="manage-types-modal__label">{type.label}</span>
                <span className="manage-types-modal__prefix">{type.prefix}-</span>
                {type.isWorkable && (
                  <Briefcase size={12} className="manage-types-modal__workable" aria-label="Represents workable tasks" />
                )}
                <button
                  type="button"
                  className="manage-types-modal__edit"
                  onClick={() => startEditing(type)}
                  aria-label={`Edit ${type.label} type`}
                  title="Edit label, color, and workable status"
                >
                  <Pencil size={12} />
                </button>
                {type.isBuiltIn ? (
                  <Lock size={12} className="manage-types-modal__lock" aria-label="Built-in type - prefix is locked" />
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
            )
          )}
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
          <label className="manage-types-modal__workable-toggle">
            <input type="checkbox" checked={isWorkable} onChange={(e) => setIsWorkable(e.target.checked)} />
            Workable
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
