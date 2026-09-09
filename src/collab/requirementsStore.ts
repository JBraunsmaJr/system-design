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
  countItemsUsingType,
} from "../domain/requirementsRegistry";

/**
 * RequirementsStore is the same kind of seam TeamStore is (see
 * teamStore.ts for the fuller rationale) - the narrow, named-operation
 * contract everything that reads or mutates the requirements document
 * works against, so a local implementation (this file) and a
 * collaborative, Yjs-backed one (yjsRequirementsStore.ts) can be swapped
 * behind it without any consuming code needing to change.
 *
 */
export interface RequirementsStore {
  getSnapshot(): RequirementsDocument;
  subscribe(listener: () => void): () => void;

  /** Creates a new, empty item of the given type and returns its
   * generated id (e.g. "REQ-6"), the same shape callers need today to
   * scroll to / focus the new item immediately after creating it. */
  addItem(typeId: string): string;
  updateItem(id: string, patch: Partial<Omit<RequirementItem, "id" | "typeId">>): void;
  /** Converts an existing item to a different type, adjusting workable fields as needed */
  convertItemType(id: string, newTypeId: string): void;
  /** Converts all items using fromTypeId to toTypeId and returns the count of converted items */
  convertAllItemsOfType(fromTypeId: string, toTypeId: string): number;
  /** Also removes any relationship touching this item on either side -
   * matching all three existing deleteItem call sites' "orphaned
   * reference" cleanup. */
  deleteItem(id: string): void;

  /** Assigns itemId to an existing category matching label
   * (case-insensitive), or creates a new one first if none matches. */
  createAndAssignCategory(itemId: string, label: string): void;
  /** Removes the category and clears categoryId on every item that
   * referenced it, so no item is left pointing at a category that no
   * longer exists. Deliberately never blocked on usage: a category is an
   * optional label, and losing it leaves the item itself untouched. */
  deleteCategory(categoryId: string): void;

  /** Returns false (and does nothing) if prefix is already taken by
   * another type - matching onAddCustomType's existing validate-and-
   * reject behavior, rather than silently creating a colliding prefix. */
  addCustomType(label: string, prefix: string, color: string, isWorkable: boolean): boolean;
  updateType(typeId: string, patch: Partial<Pick<RequirementItemType, "label" | "color" | "isWorkable">>): void;
  /** Returns false (and does nothing) if any item still uses this type.
   *
   * This used to cascade instead - deleting the type also deleted every
   * item of that type and every relationship touching one of them. That
   * turned a tidy-up action into silent, unrecoverable data loss, so the
   * contract is now refuse-and-report: the caller checks
   * countItemsUsingType to disable the affordance up front, and this
   * guard is the backstop for the case the caller can't see (a
   * collaborator adding an item of this type between the UI rendering
   * and the click landing).
   *
   * Because a type can now only be removed when nothing references it,
   * there is nothing left to cascade to - the item and relationship
   * cleanup this used to do is gone rather than merely unreachable. */
  deleteCustomType(typeId: string): boolean;

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

    convertItemType: (id, newTypeId) => {
      const targetType = doc.itemTypes.find((t) => t.id === newTypeId);
      if (!targetType) return;
      doc = {
        ...doc,
        items: doc.items.map((item) => {
          if (item.id !== id) return item;
          return {
            ...item,
            typeId: newTypeId,
            status: targetType.isWorkable ? (item.status ?? "todo") : undefined,
            points: targetType.isWorkable ? item.points : undefined,
            assigneeId: targetType.isWorkable ? item.assigneeId : undefined,
            sprintId: targetType.isWorkable ? item.sprintId : undefined,
          };
        }),
      };
      notify();
    },

    convertAllItemsOfType: (fromTypeId, toTypeId) => {
      if (fromTypeId === toTypeId) return 0;
      const targetType = doc.itemTypes.find((t) => t.id === toTypeId);
      if (!targetType) return 0;
      let count = 0;
      doc = {
        ...doc,
        items: doc.items.map((item) => {
          if (item.typeId !== fromTypeId) return item;
          count++;
          return {
            ...item,
            typeId: toTypeId,
            status: targetType.isWorkable ? (item.status ?? "todo") : undefined,
            points: targetType.isWorkable ? item.points : undefined,
            assigneeId: targetType.isWorkable ? item.assigneeId : undefined,
            sprintId: targetType.isWorkable ? item.sprintId : undefined,
          };
        }),
      };
      if (count > 0) notify();
      return count;
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

    deleteCategory: (categoryId) => {
      doc = {
        ...doc,
        categories: doc.categories.filter((c) => c.id !== categoryId),
        items: doc.items.map((i) => (i.categoryId === categoryId ? { ...i, categoryId: undefined } : i)),
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
      if (countItemsUsingType(doc, typeId) > 0) return false;
      doc = { ...doc, itemTypes: doc.itemTypes.filter((t) => t.id !== typeId) };
      notify();
      return true;
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

    convertItemType: (id, newTypeId) => {
      setSnapshot((prev) => {
        const targetType = prev.itemTypes.find((t) => t.id === newTypeId);
        if (!targetType) return prev;
        return {
          ...prev,
          items: prev.items.map((item) => {
            if (item.id !== id) return item;
            return {
              ...item,
              typeId: newTypeId,
              status: targetType.isWorkable ? (item.status ?? "todo") : undefined,
              points: targetType.isWorkable ? item.points : undefined,
              assigneeId: targetType.isWorkable ? item.assigneeId : undefined,
              sprintId: targetType.isWorkable ? item.sprintId : undefined,
            };
          }),
        };
      });
    },

    convertAllItemsOfType: (fromTypeId, toTypeId) => {
      if (fromTypeId === toTypeId) return 0;
      let count = 0;
      setSnapshot((prev) => {
        const targetType = prev.itemTypes.find((t) => t.id === toTypeId);
        if (!targetType) return prev;
        return {
          ...prev,
          items: prev.items.map((item) => {
            if (item.typeId !== fromTypeId) return item;
            count++;
            return {
              ...item,
              typeId: toTypeId,
              status: targetType.isWorkable ? (item.status ?? "todo") : undefined,
              points: targetType.isWorkable ? item.points : undefined,
              assigneeId: targetType.isWorkable ? item.assigneeId : undefined,
              sprintId: targetType.isWorkable ? item.sprintId : undefined,
            };
          }),
        };
      });
      return count;
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

    deleteCategory: (categoryId) => {
      setSnapshot((prev) => ({
        ...prev,
        categories: prev.categories.filter((c) => c.id !== categoryId),
        items: prev.items.map((i) => (i.categoryId === categoryId ? { ...i, categoryId: undefined } : i)),
      }));
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
      if (countItemsUsingType(getSnapshot(), typeId) > 0) return false;
      setSnapshot((prev) => ({ ...prev, itemTypes: prev.itemTypes.filter((t) => t.id !== typeId) }));
      return true;
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
