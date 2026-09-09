import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link2, X } from "lucide-react";
import {
  getRelationshipType,
  getRelationshipsForItem,
  getOtherItemId,
  getRelationshipLabelForItem,
} from "../../domain/requirementsRegistry";
import { computeFlippedPosition } from "../../domain/popoverPosition";
import type { RequirementsDocument } from "../../domain/requirementsTypes";

interface RelationshipManagerProps {
  itemId: string;
  doc: RequirementsDocument;
  onAddRelationship: (typeId: string, fromItemId: string, toItemId: string) => string | null;
  onDeleteRelationship: (relationshipId: string) => void;
  onNavigateToItem: (itemId: string) => void;
}

const DROPDOWN_WIDTH = 260;

/** One selectable "verb" in the add-relationship popover. A single
 * RelationshipType with distinct forward/inverse labels (e.g. "Blocks" /
 * "Is blocked by") contributes TWO options here, one per direction - a
 * symmetric type like "Relates to" contributes just one, since direction
 * isn't meaningful for it. `direction` records which way to store
 * fromItemId/toItemId when this option is used from the current item's
 * card: "forward" means the current item is the "from" side, "backward"
 * means it's the "to" side. */
interface VerbOption {
  typeId: string;
  displayLabel: string;
  color: string;
  direction: "forward" | "backward";
}

function buildVerbOptions(doc: RequirementsDocument): VerbOption[] {
  const options: VerbOption[] = [];
  for (const type of doc.relationshipTypes) {
    options.push({ typeId: type.id, displayLabel: type.label, color: type.color, direction: "forward" });
    if (type.inverseLabel !== type.label) {
      options.push({ typeId: type.id, displayLabel: type.inverseLabel, color: type.color, direction: "backward" });
    }
  }
  return options;
}

/**
 * Same portal + flip-positioning approach used throughout this app's
 * dropdowns (see CategoryPicker for the full reasoning). Two-part
 * popover: a row of verb chips at the top (built from every relationship
 * type's forward and, where distinct, inverse label), then a searchable
 * list of every OTHER item below - picking one immediately creates the
 * relationship using whichever verb is currently selected, and the
 * popover stays open afterward so several relationships can be added in
 * one sitting without reopening it each time.
 */
export function RelationshipManager({
  itemId,
  doc,
  onAddRelationship,
  onDeleteRelationship,
  onNavigateToItem,
}: RelationshipManagerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const verbOptions = useMemo(() => buildVerbOptions(doc), [doc]);
  const [selectedVerbKey, setSelectedVerbKey] = useState<string | null>(null);
  const activeVerb = useMemo(() => {
    if (selectedVerbKey) {
      const match = verbOptions.find((v) => `${v.typeId}::${v.direction}` === selectedVerbKey);
      if (match) return match;
    }
    return verbOptions[0] ?? null;
  }, [verbOptions, selectedVerbKey]);

  const existingRelationships = useMemo(() => getRelationshipsForItem(doc, itemId), [doc, itemId]);

  const open = () => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    setDropdownPos({ top: rect.bottom + 4, left: Math.max(8, rect.right - DROPDOWN_WIDTH) });
    setIsOpen(true);
  };
  const close = () => {
    setIsOpen(false);
    setQuery("");
    setErrorMessage(null);
  };

  useLayoutEffect(() => {
    if (!isOpen) return;
    const trigger = triggerRef.current;
    const dropdown = dropdownRef.current;
    if (!trigger || !dropdown) return;
    const triggerRect = trigger.getBoundingClientRect();
    const dropdownRect = dropdown.getBoundingClientRect();
    const next = computeFlippedPosition(
      triggerRect,
      { width: dropdownRect.width, height: dropdownRect.height },
      { width: window.innerWidth, height: window.innerHeight }
    );
    setDropdownPos((prev) => (prev && prev.top === next.top && prev.left === next.left ? prev : next));
  }, [isOpen, query, activeVerb, existingRelationships.length]);

  const reposition = useCallback(() => {
    const trigger = triggerRef.current;
    const dropdown = dropdownRef.current;
    if (!trigger || !dropdown) return;
    const triggerRect = trigger.getBoundingClientRect();
    const dropdownRect = dropdown.getBoundingClientRect();
    setDropdownPos(
      computeFlippedPosition(
        triggerRect,
        { width: dropdownRect.width, height: dropdownRect.height },
        { width: window.innerWidth, height: window.innerHeight }
      )
    );
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (event: MouseEvent) => {
      const path = event.composedPath();
      if (triggerRef.current && path.includes(triggerRef.current)) return;
      if (dropdownRef.current && path.includes(dropdownRef.current)) return;
      close();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [isOpen, reposition]);

  // Excludes the current item itself and anything already related to it
  // via the currently-selected verb+direction specifically - the same
  // item can still appear once a DIFFERENT verb is picked, since that's a
  // genuinely different fact (e.g. already "Relates to" REQ-2 doesn't
  // preclude also adding "Blocks" REQ-2).
  const q = query.trim().toLowerCase();
  const alreadyRelatedViaActiveVerb = new Set(
    activeVerb
      ? existingRelationships
          .filter((r) => r.typeId === activeVerb.typeId)
          .map((r) => getOtherItemId(r, itemId))
      : []
  );
  const candidates = doc.items
    .filter((item) => item.id !== itemId)
    .filter((item) => !alreadyRelatedViaActiveVerb.has(item.id))
    .filter((item) => q === "" || item.id.toLowerCase().includes(q) || item.title.toLowerCase().includes(q))
    .slice(0, 20);

  // Grouped by the direction-correct verb rather than rendered one row
  // per relationship. A card with ten relationships was ten full-width
  // rows, most of them repeating the same verb; grouping collapses that
  // to one row per distinct verb with the targets wrapping inside it,
  // which is usually two or three rows for the same content. Insertion
  // order is preserved (Map keeps it) so relationships don't reshuffle
  // as they're added.
  const groupedRelationships = useMemo(() => {
    const groups = new Map<
      string,
      { label: string; color: string; entries: { relationshipId: string; itemId: string; text: string }[] }
    >();
    for (const relationship of existingRelationships) {
      const type = getRelationshipType(doc, relationship.typeId);
      const otherId = getOtherItemId(relationship, itemId);
      const otherItem = doc.items.find((i) => i.id === otherId);
      if (!type || !otherItem) continue;
      const label = getRelationshipLabelForItem(relationship, type, itemId);
      // Keyed by type AND label, not label alone: two different types can
      // share a label, and the same type reads differently from each side
      // ("Blocks" vs "Is blocked by"), which are genuinely separate groups.
      const key = `${relationship.typeId}::${label}`;
      let group = groups.get(key);
      if (!group) {
        group = { label, color: type.color, entries: [] };
        groups.set(key, group);
      }
      group.entries.push({
        relationshipId: relationship.id,
        itemId: otherItem.id,
        text: otherItem.title ? `${otherItem.id}: ${otherItem.title}` : otherItem.id,
      });
    }
    return [...groups.values()];
  }, [existingRelationships, doc, itemId]);

  return (
    <div className="relationship-manager">
      {groupedRelationships.length > 0 && (
        <div className="relationship-manager__groups">
          {groupedRelationships.map((group) => (
            <div key={`${group.label}-${group.color}`} className="relationship-manager__group">
              <span className="relationship-manager__group-verb" style={{ color: group.color }}>
                {group.label}
              </span>
              <div className="relationship-manager__group-targets">
                {group.entries.map((entry) => (
                  <span
                    key={entry.relationshipId}
                    className="relationship-manager__chip"
                    style={{ borderColor: `${group.color}66` }}
                  >
                    <button
                      type="button"
                      className="relationship-manager__chip-target"
                      onClick={() => onNavigateToItem(entry.itemId)}
                      title={`Go to ${entry.text}`}
                    >
                      {entry.text}
                    </button>
                    <button
                      type="button"
                      className="relationship-manager__chip-remove"
                      onClick={() => onDeleteRelationship(entry.relationshipId)}
                      aria-label={`Remove relationship to ${entry.itemId}`}
                    >
                      <X size={10} />
                    </button>
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <button
        ref={triggerRef}
        type="button"
        className="relationship-manager__add"
        onClick={() => (isOpen ? close() : open())}
      >
        <Link2 size={11} />
        Add relationship
      </button>

      {isOpen &&
        dropdownPos &&
        verbOptions.length > 0 &&
        createPortal(
          <div
            ref={dropdownRef}
            className="relationship-manager__dropdown"
            style={{ position: "fixed", top: dropdownPos.top, left: dropdownPos.left }}
          >
            <div className="relationship-manager__verbs">
              {verbOptions.map((verb) => {
                const isActive = activeVerb?.typeId === verb.typeId && activeVerb?.direction === verb.direction;
                return (
                  <button
                    key={`${verb.typeId}-${verb.direction}`}
                    type="button"
                    className={`relationship-manager__verb${isActive ? " active" : ""}`}
                    style={isActive ? { borderColor: verb.color, color: verb.color } : undefined}
                    onClick={() => {
                      setSelectedVerbKey(`${verb.typeId}::${verb.direction}`);
                      setErrorMessage(null);
                    }}
                  >
                    {verb.displayLabel}
                  </button>
                );
              })}
            </div>
            <input
              autoFocus
              className="relationship-manager__search"
              placeholder="Search items to relate..."
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setErrorMessage(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") close();
              }}
            />
            {errorMessage && <p className="relationship-manager__error">{errorMessage}</p>}
            <div className="relationship-manager__list">
              {candidates.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="relationship-manager__option"
                  onClick={(e) => {
                    e.preventDefault();
                    if (!activeVerb) return;
                    const result =
                      activeVerb.direction === "forward"
                        ? onAddRelationship(activeVerb.typeId, itemId, item.id)
                        : onAddRelationship(activeVerb.typeId, item.id, itemId);
                    if (result) {
                      setErrorMessage(result);
                    } else {
                      setErrorMessage(null);
                    }
                  }}
                >
                  <span className="relationship-manager__option-id">{item.id}</span>
                  <span className="relationship-manager__option-title">{item.title || "(untitled)"}</span>
                </button>
              ))}
              {candidates.length === 0 && (
                <p className="relationship-manager__empty">
                  {doc.items.length <= 1 ? "No other items exist yet." : "No matching items."}
                </p>
              )}
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
