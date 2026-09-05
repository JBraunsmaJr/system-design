import type {
  RequirementsDocument,
  RequirementItem,
  RequirementItemType,
} from "../domain/requirementsTypes";
import { EMPTY_REQUIREMENTS_DOCUMENT } from "../domain/requirementsTypes";
import {
  generateItemId,
  createCategory,
  addRelationship as addRelationshipPure,
  defaultStatusForType,
  isPrefixTaken,
} from "../domain/requirementsRegistry";

/**
 * RequirementsStore is the same kind of seam TeamStore is (see
 * teamStore.ts for the fuller rationale) - the narrow, named-operation
 * contract everything that reads or mutates the requirements document
 * works against, so a local implementation (this file) and a
 * collaborative, Yjs-backed one (yjsRequirementsStore.ts) can be swapped
 * behind it without any consuming code needing to change.
 *
 * The operations here were derived by reading every onUpdateDoc /
 * onUpdateRequirements call site across RequirementsView.tsx,
 * TimelineView.tsx, and SkillTreeView.tsx (24 in total) - same discipline
 * as TeamStore, just a larger surface, since three different views
 * mutate this document today via their own separate inline transforms.
 *
 * One thing worth being explicit about: addItem, addCustomType, and
 * createAndAssignCategory all generate ids by inspecting CURRENT local
 * state (a sequence counter for items, "scan for the smallest unused
 * number" for categories and custom types) - see the doc comments on
 * addItem and createAndAssignCategory below, and yjsRequirementsStore.ts,
 * for what that means once two peers can create things concurrently
 * without having synced first. Relationship and relationship-type ids
 * already use a timestamp+random scheme (see requirementsRegistry.ts)
 * and don't have this problem.
 *
 * A second thing worth being explicit about: createAndAssignCategory
 * existed as THREE separate, slightly-diverged inline implementations
 * before this - RequirementsView.tsx used the shared, canonical
 * createCategory helper (category-N ids, colors cycling through a
 * palette), while TimelineView.tsx and SkillTreeView.tsx each had their
 * own inline copy (cat-<timestamp> ids, a single fixed color). This
 * store has exactly one implementation, using the canonical helper -
 * once views are migrated onto this seam, that pre-existing
 * inconsistency disappears as a side effect, not as a separate fix.
 */
export interface RequirementsStore {
  getSnapshot(): RequirementsDocument;
  subscribe(listener: () => void): () => void;

  /** Creates a new, empty item of the given type and returns its
   * generated id (e.g. "REQ-6"), the same shape callers need today to
   * scroll to / focus the new item immediately after creating it. */
  addItem(typeId: string): string;
  updateItem(id: string, patch: Partial<Omit<RequirementItem, "id" | "typeId">>): void;
  /** Also removes any relationship touching this item on either side -
   * matching all three existing deleteItem call sites' "orphaned
   * reference" cleanup. */
  deleteItem(id: string): void;

  /** Assigns itemId to an existing category matching label
   * (case-insensitive), or creates a new one first if none matches. */
  createAndAssignCategory(itemId: string, label: string): void;

  /** Returns false (and does nothing) if prefix is already taken by
   * another type - matching onAddCustomType's existing validate-and-
   * reject behavior, rather than silently creating a colliding prefix. */
  addCustomType(label: string, prefix: string, color: string, isWorkable: boolean): boolean;
  updateType(typeId: string, patch: Partial<Pick<RequirementItemType, "label" | "color" | "isWorkable">>): void;
  /** Also removes every item of this type, and any relationship
   * touching one of those now-deleted items - matching
   * onDeleteCustomType's existing cascade. */
  deleteCustomType(typeId: string): void;

  addCustomRelationshipType(label: string, inverseLabel: string, color: string, isBlocking: boolean): void;
  /** Also removes every relationship of this type (items themselves are
   * untouched) - matching onDeleteCustomRelationshipType's existing
   * cascade. */
  deleteCustomRelationshipType(typeId: string): void;

  /** Runs the same validation as the existing pure addRelationship
   * helper (duplicate check, cycle prevention for blocking types) and
   * returns an error string instead of committing if it fails. */
  addRelationship(typeId: string, fromItemId: string, toItemId: string): string | null;
  deleteRelationship(relationshipId: string): void;

  /** Clears sprintId on every item currently assigned to any of the
   * given sprint ids - used when deleting a sprint (one id) or a whole
   * PI (every sprint id it contained), matching TimelineView's existing
   * onDeleteSprint / onDeletePI cleanup. */
  unassignItemsFromSprints(sprintIds: string[]): void;
}

function nextCustomTypeId(doc: RequirementsDocument): string {
  let n = 1;
  while (doc.itemTypes.some((t) => t.id === `custom-${n}`)) n++;
  return `custom-${n}`;
}

export function createLocalRequirementsStore(
  initial: RequirementsDocument = EMPTY_REQUIREMENTS_DOCUMENT
): RequirementsStore {
  let doc: RequirementsDocument = initial;
  const listeners = new Set<() => void>();

  const notify = () => {
    for (const listener of listeners) listener();
  };

  return {
    getSnapshot: () => doc,

    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    addItem: (typeId) => {
      const { id, nextSequence } = generateItemId(doc, typeId);
      const newItem: RequirementItem = { id, typeId, title: "", body: "", status: defaultStatusForType(doc, typeId) };
      doc = { ...doc, items: [...doc.items, newItem], nextSequence };
      notify();
      return id;
    },

    updateItem: (id, patch) => {
      doc = { ...doc, items: doc.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) };
      notify();
    },

    deleteItem: (id) => {
      doc = {
        ...doc,
        items: doc.items.filter((i) => i.id !== id),
        relationships: doc.relationships.filter((r) => r.fromItemId !== id && r.toItemId !== id),
      };
      notify();
    },

    createAndAssignCategory: (itemId, label) => {
      const { category, categories } = createCategory(doc, label);
      doc = {
        ...doc,
        categories,
        items: doc.items.map((i) => (i.id === itemId ? { ...i, categoryId: category.id } : i)),
      };
      notify();
    },

    addCustomType: (label, prefix, color, isWorkable) => {
      if (isPrefixTaken(doc, prefix)) return false;
      const newType: RequirementItemType = {
        id: nextCustomTypeId(doc),
        label,
        prefix: prefix.toUpperCase(),
        color,
        isBuiltIn: false,
        isWorkable,
      };
      doc = { ...doc, itemTypes: [...doc.itemTypes, newType] };
      notify();
      return true;
    },

    updateType: (typeId, patch) => {
      doc = { ...doc, itemTypes: doc.itemTypes.map((t) => (t.id === typeId ? { ...t, ...patch } : t)) };
      notify();
    },

    deleteCustomType: (typeId) => {
      const removedIds = new Set(doc.items.filter((i) => i.typeId === typeId).map((i) => i.id));
      doc = {
        ...doc,
        itemTypes: doc.itemTypes.filter((t) => t.id !== typeId),
        items: doc.items.filter((i) => i.typeId !== typeId),
        relationships: doc.relationships.filter((r) => !removedIds.has(r.fromItemId) && !removedIds.has(r.toItemId)),
      };
      notify();
    },

    addCustomRelationshipType: (label, inverseLabel, color, isBlocking) => {
      const newType = {
        id: `rel-type-${Date.now().toString(36)}`,
        label,
        inverseLabel,
        color,
        isBuiltIn: false,
        isBlocking,
      };
      doc = { ...doc, relationshipTypes: [...doc.relationshipTypes, newType] };
      notify();
    },

    deleteCustomRelationshipType: (typeId) => {
      doc = {
        ...doc,
        relationshipTypes: doc.relationshipTypes.filter((t) => t.id !== typeId),
        relationships: doc.relationships.filter((r) => r.typeId !== typeId),
      };
      notify();
    },

    addRelationship: (typeId, fromItemId, toItemId) => {
      const result = addRelationshipPure(doc, typeId, fromItemId, toItemId);
      if (result.error) return result.error;
      doc = { ...doc, relationships: result.relationships };
      notify();
      return null;
    },

    deleteRelationship: (relationshipId) => {
      doc = { ...doc, relationships: doc.relationships.filter((r) => r.id !== relationshipId) };
      notify();
    },

    unassignItemsFromSprints: (sprintIds) => {
      const sprintIdSet = new Set(sprintIds);
      doc = {
        ...doc,
        items: doc.items.map((item) =>
          item.sprintId && sprintIdSet.has(item.sprintId) ? { ...item, sprintId: undefined } : item
        ),
      };
      notify();
    },
  };
}

/**
 * A RequirementsStore that owns no state of its own - same purpose and
 * reasoning as createAdapterTeamStore in teamStore.ts. Requirements is
 * mutated by THREE separate views today (RequirementsView, TimelineView,
 * SkillTreeView), each with its own inline transforms - this adapter
 * gives all three a single, shared, named-operation interface instead,
 * constructed once in App.tsx and passed to all three, while
 * `requirements` itself stays exactly where it already lives in the
 * undoable DiagramSnapshot, updated through the same setRequirements
 * function as before. Every operation here is the exact same transform
 * the local implementation above uses, just applied to externally-owned
 * state via setSnapshot instead of an internal closure variable.
 */
export function createAdapterRequirementsStore(
  getSnapshot: () => RequirementsDocument,
  setSnapshot: (updater: (prev: RequirementsDocument) => RequirementsDocument) => void
): RequirementsStore {
  return {
    getSnapshot,

    subscribe: () => () => {},

    addItem: (typeId) => {
      const { id, nextSequence } = generateItemId(getSnapshot(), typeId);
      const newItem: RequirementItem = {
        id,
        typeId,
        title: "",
        body: "",
        status: defaultStatusForType(getSnapshot(), typeId),
      };
      setSnapshot((prev) => ({ ...prev, items: [...prev.items, newItem], nextSequence }));
      return id;
    },

    updateItem: (id, patch) => {
      setSnapshot((prev) => ({
        ...prev,
        items: prev.items.map((i) => (i.id === id ? { ...i, ...patch } : i)),
      }));
    },

    deleteItem: (id) => {
      setSnapshot((prev) => ({
        ...prev,
        items: prev.items.filter((i) => i.id !== id),
        relationships: prev.relationships.filter((r) => r.fromItemId !== id && r.toItemId !== id),
      }));
    },

    createAndAssignCategory: (itemId, label) => {
      setSnapshot((prev) => {
        const { category, categories } = createCategory(prev, label);
        return {
          ...prev,
          categories,
          items: prev.items.map((i) => (i.id === itemId ? { ...i, categoryId: category.id } : i)),
        };
      });
    },

    addCustomType: (label, prefix, color, isWorkable) => {
      if (isPrefixTaken(getSnapshot(), prefix)) return false;
      const newType: RequirementItemType = {
        id: nextCustomTypeId(getSnapshot()),
        label,
        prefix: prefix.toUpperCase(),
        color,
        isBuiltIn: false,
        isWorkable,
      };
      setSnapshot((prev) => ({ ...prev, itemTypes: [...prev.itemTypes, newType] }));
      return true;
    },

    updateType: (typeId, patch) => {
      setSnapshot((prev) => ({
        ...prev,
        itemTypes: prev.itemTypes.map((t) => (t.id === typeId ? { ...t, ...patch } : t)),
      }));
    },

    deleteCustomType: (typeId) => {
      setSnapshot((prev) => {
        const removedIds = new Set(prev.items.filter((i) => i.typeId === typeId).map((i) => i.id));
        return {
          ...prev,
          itemTypes: prev.itemTypes.filter((t) => t.id !== typeId),
          items: prev.items.filter((i) => i.typeId !== typeId),
          relationships: prev.relationships.filter((r) => !removedIds.has(r.fromItemId) && !removedIds.has(r.toItemId)),
        };
      });
    },

    addCustomRelationshipType: (label, inverseLabel, color, isBlocking) => {
      const newType = {
        id: `rel-type-${Date.now().toString(36)}`,
        label,
        inverseLabel,
        color,
        isBuiltIn: false,
        isBlocking,
      };
      setSnapshot((prev) => ({ ...prev, relationshipTypes: [...prev.relationshipTypes, newType] }));
    },

    deleteCustomRelationshipType: (typeId) => {
      setSnapshot((prev) => ({
        ...prev,
        relationshipTypes: prev.relationshipTypes.filter((t) => t.id !== typeId),
        relationships: prev.relationships.filter((r) => r.typeId !== typeId),
      }));
    },

    addRelationship: (typeId, fromItemId, toItemId) => {
      const result = addRelationshipPure(getSnapshot(), typeId, fromItemId, toItemId);
      if (result.error) return result.error;
      setSnapshot((prev) => ({ ...prev, relationships: result.relationships }));
      return null;
    },

    deleteRelationship: (relationshipId) => {
      setSnapshot((prev) => ({ ...prev, relationships: prev.relationships.filter((r) => r.id !== relationshipId) }));
    },

    unassignItemsFromSprints: (sprintIds) => {
      const sprintIdSet = new Set(sprintIds);
      setSnapshot((prev) => ({
        ...prev,
        items: prev.items.map((item) =>
          item.sprintId && sprintIdSet.has(item.sprintId) ? { ...item, sprintId: undefined } : item
        ),
      }));
    },
  };
}
