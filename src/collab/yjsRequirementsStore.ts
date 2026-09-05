import * as Y from "yjs";
import type {
  RequirementsDocument,
  RequirementItem,
  RequirementItemType,
  RequirementCategory,
  RelationshipType,
  RequirementRelationship,
} from "../domain/requirementsTypes";
import { defaultStatusForType, isPrefixTaken, addRelationship as addRelationshipPure, BUILT_IN_ITEM_TYPES, BUILT_IN_RELATIONSHIP_TYPES } from "../domain/requirementsRegistry";
import type { RequirementsStore } from "./requirementsStore";

/**
 * Yjs-backed RequirementsStore. See requirementsStore.ts for why the
 * operations are shaped the way they are; this file is about the schema
 * and id-generation choices that make those operations merge correctly
 * (or, in one deliberately-flagged case, don't yet).
 *
 * Schema (all on the given Y.Doc), following the same "Y.Map keyed by
 * id, nested Y.Map per entry only where a field-patch operation exists"
 * pattern established in yjsTeamStore.ts:
 *  - "itemTypeOrder" / "itemTypes": nested (updateType patches
 *    individual fields).
 *  - "categoryOrder" / "categories": plain values - no operation ever
 *    patches an existing category's fields, only create.
 *  - "itemOrder" / "items": nested - updateItem patches individual
 *    fields extensively (title, body, categoryId, sprintId, assigneeId,
 *    points, status), and items are the most actively, concurrently
 *    edited entity in the whole document, so this is the most important
 *    place for the "different fields merge independently" guarantee to
 *    actually hold.
 *  - "relationshipTypes": plain values, no order array - same reasoning
 *    as team's extraDaysOff: no field-patch operation, and no
 *    meaningful order to preserve for a small, rarely-changed set.
 *  - "relationships": plain values, no order array - same reasoning.
 *  - "nextSequence": Y.Map<string, number> keyed by item-type id - see
 *    addItem below for the important caveat about this one.
 */
export function createYjsRequirementsStore(doc: Y.Doc): RequirementsStore {
  const itemTypeOrder = doc.getArray<string>("itemTypeOrder");
  const itemTypes = doc.getMap<Y.Map<unknown>>("itemTypes");
  const categoryOrder = doc.getArray<string>("categoryOrder");
  const categories = doc.getMap<RequirementCategory>("categories");
  const itemOrder = doc.getArray<string>("itemOrder");
  const items = doc.getMap<Y.Map<unknown>>("items");
  const relationshipTypes = doc.getMap<RelationshipType>("relationshipTypes");
  const relationships = doc.getMap<RequirementRelationship>("relationships");
  const nextSequence = doc.getMap<number>("nextSequence");

  // One-time seed of built-in types, if this is a brand-new doc with
  // nothing in it yet - matching how a fresh RequirementsDocument always
  // starts with these (see EMPTY_REQUIREMENTS_DOCUMENT /
  // withMissingBuiltInTypes). Guarded by a key check so joining an
  // ALREADY-populated doc (the normal case - syncing to an existing
  // session) never stomps on real data, same pattern as
  // yjsTeamStore.ts's settings defaults.
  if (itemTypeOrder.length === 0 && itemTypes.size === 0) {
    doc.transact(() => {
      for (const t of BUILT_IN_ITEM_TYPES) {
        const m = new Y.Map<unknown>();
        m.set("label", t.label);
        m.set("prefix", t.prefix);
        m.set("color", t.color);
        m.set("isBuiltIn", t.isBuiltIn);
        m.set("isWorkable", t.isWorkable);
        itemTypes.set(t.id, m);
        itemTypeOrder.push([t.id]);
      }
      for (const t of BUILT_IN_RELATIONSHIP_TYPES) {
        relationshipTypes.set(t.id, t);
      }
    });
  }

  function itemTypeMapToPlain(id: string, m: Y.Map<unknown>): RequirementItemType {
    return {
      id,
      label: m.get("label") as string,
      prefix: m.get("prefix") as string,
      color: m.get("color") as string,
      isBuiltIn: m.get("isBuiltIn") as boolean,
      isWorkable: m.get("isWorkable") as boolean,
    };
  }

  function itemMapToPlain(id: string, m: Y.Map<unknown>): RequirementItem {
    return {
      id,
      typeId: m.get("typeId") as string,
      title: m.get("title") as string,
      body: m.get("body") as string,
      categoryId: m.get("categoryId") as string | undefined,
      sprintId: m.get("sprintId") as string | undefined,
      assigneeId: m.get("assigneeId") as string | undefined,
      points: m.get("points") as number | undefined,
      status: m.get("status") as RequirementItem["status"],
    };
  }

  function buildSnapshot(): RequirementsDocument {
    return {
      itemTypes: itemTypeOrder
        .toArray()
        .map((id) => {
          const t = itemTypes.get(id);
          return t ? itemTypeMapToPlain(id, t) : null;
        })
        .filter((t): t is RequirementItemType => t !== null),
      categories: categoryOrder
        .toArray()
        .map((id) => categories.get(id))
        .filter((c): c is RequirementCategory => c !== undefined),
      items: itemOrder
        .toArray()
        .map((id) => {
          const i = items.get(id);
          return i ? itemMapToPlain(id, i) : null;
        })
        .filter((i): i is RequirementItem => i !== null),
      relationshipTypes: Array.from(relationshipTypes.values()),
      relationships: Array.from(relationships.values()),
      nextSequence: Object.fromEntries(nextSequence.entries()),
    };
  }

  let cached = buildSnapshot();
  const listeners = new Set<() => void>();
  const recomputeAndNotify = () => {
    cached = buildSnapshot();
    for (const listener of listeners) listener();
  };

  itemTypeOrder.observeDeep(recomputeAndNotify);
  itemTypes.observeDeep(recomputeAndNotify);
  categoryOrder.observeDeep(recomputeAndNotify);
  categories.observeDeep(recomputeAndNotify);
  itemOrder.observeDeep(recomputeAndNotify);
  items.observeDeep(recomputeAndNotify);
  relationshipTypes.observeDeep(recomputeAndNotify);
  relationships.observeDeep(recomputeAndNotify);
  nextSequence.observeDeep(recomputeAndNotify);

  return {
    getSnapshot: () => cached,

    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    // KNOWN LIMITATION, deliberately not solved here: this reads the
    // current counter, increments, and writes back - the exact same
    // "read-modify-write" shape as the app's existing (single-user)
    // generateItemId. Under normal, connected collaboration this is
    // fine (Yjs's own causal ordering means one peer's write is visible
    // to the next before it acts), but if two peers each create an item
    // of the SAME type while disconnected from each other, both will
    // independently compute the same candidate id (e.g. both produce
    // "REQ-6") before either has seen the other's change. Confirmed
    // empirically (see requirementsStore.verify.ts) rather than assumed:
    // after sync, this does NOT silently lose one item as might be
    // guessed - instead, the id appears TWICE in the item list, both
    // entries showing identical (merged) content. The underlying data
    // itself merges to one winner (items is a Y.Map, last-write-wins
    // per key), but itemOrder is a Y.Array - a sequence type - so each
    // peer's own push of the same id string survives as its own
    // distinct element; nothing deduplicates them. The visible symptom
    // is a duplicate row, not a missing one. Category and
    // custom-item-type ids share the same underlying weakness (a "scan
    // for the smallest unused number" pattern, in requirementsStore.ts
    // and RequirementsView.tsx respectively) but are far lower-risk in
    // practice, since those are created rarely compared to items.
    // Fixing this properly means either disambiguating ids with
    // something unique per peer (at the cost of changing the visible id
    // format, e.g. "REQ-6" always being exactly that today) or
    // detecting and deterministically resolving a collision after the
    // fact - a real, separate piece of design and work, not something
    // to fold into this pass silently.
    addItem: (typeId) => {
      const sequence = (nextSequence.get(typeId) as number | undefined) ?? 1;
      const typeMap = itemTypes.get(typeId);
      const type = typeMap ? itemTypeMapToPlain(typeId, typeMap) : undefined;
      const id = `${type?.prefix ?? typeId}-${sequence}`;
      doc.transact(() => {
        const m = new Y.Map<unknown>();
        m.set("typeId", typeId);
        m.set("title", "");
        m.set("body", "");
        m.set("status", defaultStatusForType(cached, typeId));
        items.set(id, m);
        itemOrder.push([id]);
        nextSequence.set(typeId, sequence + 1);
      });
      return id;
    },

    updateItem: (id, patch) => {
      const m = items.get(id);
      if (!m) return;
      doc.transact(() => {
        for (const [key, value] of Object.entries(patch)) {
          m.set(key, value);
        }
      });
    },

    deleteItem: (id) => {
      doc.transact(() => {
        items.delete(id);
        const idx = itemOrder.toArray().indexOf(id);
        if (idx !== -1) itemOrder.delete(idx, 1);
        for (const [relId, rel] of relationships.entries()) {
          if (rel.fromItemId === id || rel.toItemId === id) relationships.delete(relId);
        }
      });
    },

    // Same category-id caveat as addItem (see the doc comment there),
    // via the same "scan for the smallest unused number" shape as
    // RequirementsView.tsx's own nextCategoryId.
    createAndAssignCategory: (itemId, label) => {
      const trimmed = label.trim();
      const existing = Array.from(categories.values()).find((c) => c.label.toLowerCase() === trimmed.toLowerCase());
      doc.transact(() => {
        let categoryId: string;
        if (existing) {
          categoryId = existing.id;
        } else {
          let n = 1;
          while (categories.has(`category-${n}`)) n++;
          categoryId = `category-${n}`;
          const palette = ["#5b7cfa", "#9061f9", "#22B8CF", "#F2994A", "#eb5286", "#38bd7d"];
          categories.set(categoryId, { id: categoryId, label: trimmed, color: palette[categoryOrder.length % palette.length] });
          categoryOrder.push([categoryId]);
        }
        const m = items.get(itemId);
        if (m) m.set("categoryId", categoryId);
      });
    },

    // Same id-collision caveat as addItem, via the same "scan for the
    // smallest unused number" shape as RequirementsView.tsx's own
    // nextCustomTypeId - lower risk in practice since custom types are
    // created far less often than items.
    addCustomType: (label, prefix, color, isWorkable) => {
      if (isPrefixTaken(cached, prefix)) return false;
      let n = 1;
      while (itemTypes.has(`custom-${n}`)) n++;
      const id = `custom-${n}`;
      doc.transact(() => {
        const m = new Y.Map<unknown>();
        m.set("label", label);
        m.set("prefix", prefix.toUpperCase());
        m.set("color", color);
        m.set("isBuiltIn", false);
        m.set("isWorkable", isWorkable);
        itemTypes.set(id, m);
        itemTypeOrder.push([id]);
      });
      return true;
    },

    updateType: (typeId, patch) => {
      const m = itemTypes.get(typeId);
      if (!m) return;
      doc.transact(() => {
        for (const [key, value] of Object.entries(patch)) {
          m.set(key, value);
        }
      });
    },

    deleteCustomType: (typeId) => {
      doc.transact(() => {
        const removedIds = new Set(
          itemOrder.toArray().filter((id) => (items.get(id)?.get("typeId") as string | undefined) === typeId)
        );
        itemTypes.delete(typeId);
        const typeIdx = itemTypeOrder.toArray().indexOf(typeId);
        if (typeIdx !== -1) itemTypeOrder.delete(typeIdx, 1);
        for (const id of removedIds) {
          items.delete(id);
          const idx = itemOrder.toArray().indexOf(id);
          if (idx !== -1) itemOrder.delete(idx, 1);
        }
        for (const [relId, rel] of relationships.entries()) {
          if (removedIds.has(rel.fromItemId) || removedIds.has(rel.toItemId)) relationships.delete(relId);
        }
      });
    },

    addCustomRelationshipType: (label, inverseLabel, color, isBlocking) => {
      const id = `rel-type-${Date.now().toString(36)}`;
      relationshipTypes.set(id, { id, label, inverseLabel, color, isBuiltIn: false, isBlocking });
    },

    deleteCustomRelationshipType: (typeId) => {
      doc.transact(() => {
        relationshipTypes.delete(typeId);
        for (const [relId, rel] of relationships.entries()) {
          if (rel.typeId === typeId) relationships.delete(relId);
        }
      });
    },

    // Validation (duplicate check, cycle prevention) and relationship-id
    // generation both reuse the exact same pure helper the local store
    // and the rest of the app already use, run against `cached` - this
    // peer's own current view. Worth being explicit about the
    // distributed-safety caveat this implies, in the same spirit as
    // addItem/createAndAssignCategory above: two peers concurrently
    // adding relationships that are each individually fine against what
    // THEY can see, but which together would form a cycle neither peer
    // could have detected before syncing, is a real possibility this
    // doesn't defend against. Relationship ids themselves
    // (timestamp+random, from the same helper) won't collide; it's the
    // GRAPH invariant (acyclic for blocking types) that isn't
    // distributed-safe yet.
    addRelationship: (typeId, fromItemId, toItemId) => {
      const result = addRelationshipPure(cached, typeId, fromItemId, toItemId);
      if (result.error) return result.error;
      const added = result.relationships.find(
        (r) => !cached.relationships.some((existing) => existing.id === r.id)
      );
      if (added) relationships.set(added.id, added);
      return null;
    },

    deleteRelationship: (relationshipId) => {
      relationships.delete(relationshipId);
    },

    unassignItemsFromSprints: (sprintIds) => {
      const sprintIdSet = new Set(sprintIds);
      doc.transact(() => {
        for (const id of itemOrder.toArray()) {
          const m = items.get(id);
          const currentSprintId = m?.get("sprintId") as string | undefined;
          if (m && currentSprintId && sprintIdSet.has(currentSprintId)) {
            m.set("sprintId", undefined);
          }
        }
      });
    },
  };
}
