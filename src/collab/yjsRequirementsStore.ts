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
 * and id-generation choices that make those operations merge correctly.
 *
 * Schema (all on the given Y.Doc), following the same "Y.Map keyed by
 * id, nested Y.Map per entry only where a field-patch operation exists"
 * pattern established in yjsTeamStore.ts:
 *  - "itemTypeOrder" / "itemTypes": nested (updateType patches
 *    individual fields).
 *  - "categoryOrder" / "categories": plain values - no operation ever
 *    patches an existing category's fields, only create.
 *  - "itemOrder" / "items": nested. IMPORTANT DEPARTURE from the rest of
 *    this file: "items" is keyed by an INTERNAL storage key (generated
 *    with the same collision-resistant timestamp+random scheme
 *    relationships already use), NOT by the item's own "id" field (the
 *    human-readable "REQ-6" style value the rest of the app sees). That
 *    id is stored as an ordinary field on the nested map instead, right
 *    alongside title, body, etc. See the addItem doc comment below for
 *    why this separation exists - in short, it's what makes a
 *    same-display-id collision between two disconnected peers a
 *    cosmetic, automatically-repairable problem instead of a data-loss
 *    one. This is entirely internal to this file: every other
 *    consumer - the local and adapter stores, every UI component - only
 *    ever sees the materialized RequirementItem.id field via
 *    getSnapshot(), exactly as before.
 *  - "relationshipTypes": plain values, no order array - same reasoning
 *    as team's extraDaysOff: no field-patch operation, and no
 *    meaningful order to preserve for a small, rarely-changed set.
 *  - "relationships": plain values, no order array - same reasoning.
 *  - "nextSequence": Y.Map<string, number> keyed by item-type id.
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

  function itemMapToPlain(m: Y.Map<unknown>): RequirementItem {
    return {
      id: m.get("id") as string,
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

  // Maps an item's DISPLAY id (the "REQ-6" style value everything outside
  // this file sees) to its internal storage key. Rebuilt every time
  // buildSnapshot runs - cheap, since that already walks every item once,
  // and it's what lets updateItem/deleteItem/createAndAssignCategory (all
  // of which receive a display id from their caller, per the public
  // RequirementsStore contract) find the right underlying entry in O(1)
  // instead of a linear scan on every call - including every keystroke
  // while editing a title.
  let displayIdToStorageKey = new Map<string, string>();

  /**
   * Detects and deterministically repairs a same-display-id collision
   * between two items that were created by different, disconnected peers
   * (see addItem's doc comment for how this can happen). Because each
   * item lives under its own collision-proof storage key, NEITHER item's
   * data is ever at risk here - this only ever renames the "id" field on
   * the losing entry, never touches or discards anything else.
   *
   * Deterministic by construction, not by luck: every peer sees the same
   * set of storage keys once synced, so sorting them and keeping the
   * lexicographically-first as the winner produces the identical result
   * on every peer independently - no coordination needed, and no
   * "whoever repairs first wins" race, since a peer that repairs
   * redundantly just writes the same values a moment later peer already
   * would have, which Yjs's last-write-wins-per-key semantics make
   * harmless.
   *
   * Returns true if a repair was made. The caller should treat that as
   * "don't trust the snapshot you were about to build" - the transact()
   * below triggers another observeDeep round that rebuilds it correctly.
   *
   * Known, deliberately out of scope: a relationship the LOSING peer
   * created (referencing their own item, by its at-the-time-uncontested
   * display id) before ever syncing will end up pointing at the WINNER's
   * item after repair, since both items shared that display id at the
   * moment the relationship was written and there's no way to know,
   * after the fact, which peer's relationship was "meant for" which
   * item. This requires the collision AND a same-session relationship
   * creation, both before ever syncing - narrower than the item-data-loss
   * problem this fixes, and not solved here.
   */
  function repairDuplicateDisplayIds(): boolean {
    const byDisplayId = new Map<string, string[]>();
    for (const storageKey of itemOrder.toArray()) {
      const m = items.get(storageKey);
      if (!m) continue;
      const displayId = m.get("id") as string;
      const list = byDisplayId.get(displayId);
      if (list) list.push(storageKey);
      else byDisplayId.set(displayId, [storageKey]);
    }

    const collisions = Array.from(byDisplayId.values()).filter((keys) => keys.length > 1);
    if (collisions.length === 0) return false;

    doc.transact(() => {
      for (const storageKeys of collisions) {
        const [, ...losers] = [...storageKeys].sort();
        for (const loserKey of losers) {
          const m = items.get(loserKey);
          if (!m) continue;
          const typeId = m.get("typeId") as string;
          const typeMap = itemTypes.get(typeId);
          const type = typeMap ? itemTypeMapToPlain(typeId, typeMap) : undefined;
          const seq = (nextSequence.get(typeId) as number | undefined) ?? 1;
          m.set("id", `${type?.prefix ?? typeId}-${seq}`);
          nextSequence.set(typeId, seq + 1);
        }
      }
    });
    return true;
  }

  function buildSnapshot(): RequirementsDocument {
    const idIndex = new Map<string, string>();
    const items_ = itemOrder
      .toArray()
      .map((storageKey) => {
        const m = items.get(storageKey);
        if (!m) return null;
        const item = itemMapToPlain(m);
        idIndex.set(item.id, storageKey);
        return item;
      })
      .filter((i): i is RequirementItem => i !== null);
    displayIdToStorageKey = idIndex;

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
      items: items_,
      relationshipTypes: Array.from(relationshipTypes.values()),
      relationships: Array.from(relationships.values()),
      nextSequence: Object.fromEntries(nextSequence.entries()),
    };
  }

  // Run once up front, before the first snapshot is cached - a collision
  // could already be baked into the doc if it was inherited from a prior
  // session's sync, before this particular store instance existed to
  // observe anything.
  repairDuplicateDisplayIds();

  let cached = buildSnapshot();
  const listeners = new Set<() => void>();
  const recomputeAndNotify = () => {
    if (repairDuplicateDisplayIds()) return; // its own transact() triggers another observeDeep round, which will rebuild `cached` correctly
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

    // The display id ("REQ-6") is generated exactly as before - a
    // per-type sequence counter, read-incremented-written-back. Two
    // disconnected peers creating an item of the same type can still end
    // up computing the same candidate display id before either has seen
    // the other's change; under normal, connected collaboration this
    // never happens (Yjs's causal ordering means one peer's write is
    // visible to the next before it acts). What's different from before:
    // this id is used only as the VALUE of an "id" field on the item's
    // own map, never as the map's storage key (see this file's top doc
    // comment) - so a collision here can never cause one peer's item
    // data to be silently discarded. It shows up, briefly, as two items
    // sharing the same display id, and repairDuplicateDisplayIds
    // resolves it automatically and deterministically the next time
    // this store recomputes after a sync (see that function's own doc
    // comment for exactly what it does and doesn't handle).
    addItem: (typeId) => {
      const sequence = (nextSequence.get(typeId) as number | undefined) ?? 1;
      const typeMap = itemTypes.get(typeId);
      const type = typeMap ? itemTypeMapToPlain(typeId, typeMap) : undefined;
      const displayId = `${type?.prefix ?? typeId}-${sequence}`;
      const storageKey = `item-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
      doc.transact(() => {
        const m = new Y.Map<unknown>();
        m.set("id", displayId);
        m.set("typeId", typeId);
        m.set("title", "");
        m.set("body", "");
        m.set("status", defaultStatusForType(cached, typeId));
        items.set(storageKey, m);
        itemOrder.push([storageKey]);
        nextSequence.set(typeId, sequence + 1);
      });
      return displayId;
    },

    updateItem: (id, patch) => {
      const storageKey = displayIdToStorageKey.get(id);
      const m = storageKey ? items.get(storageKey) : undefined;
      if (!m) return;
      doc.transact(() => {
        for (const [key, value] of Object.entries(patch)) {
          m.set(key, value);
        }
      });
    },

    deleteItem: (id) => {
      const storageKey = displayIdToStorageKey.get(id);
      if (!storageKey) return;
      doc.transact(() => {
        items.delete(storageKey);
        const idx = itemOrder.toArray().indexOf(storageKey);
        if (idx !== -1) itemOrder.delete(idx, 1);
        for (const [relId, rel] of relationships.entries()) {
          if (rel.fromItemId === id || rel.toItemId === id) relationships.delete(relId);
        }
      });
    },

    // Same category-id caveat as addItem's display id (see its doc
    // comment) - lower risk in practice since categories are created far
    // less often than items, and not given the same storage-key
    // treatment here since categories aren't nested maps to begin with
    // (see this file's top doc comment).
    createAndAssignCategory: (itemId, label) => {
      const trimmed = label.trim();
      const existing = Array.from(categories.values()).find((c) => c.label.toLowerCase() === trimmed.toLowerCase());
      const storageKey = displayIdToStorageKey.get(itemId);
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
        const m = storageKey ? items.get(storageKey) : undefined;
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
        const removedStorageKeys = new Set<string>();
        const removedDisplayIds = new Set<string>();
        for (const storageKey of itemOrder.toArray()) {
          const m = items.get(storageKey);
          if (m?.get("typeId") === typeId) {
            removedStorageKeys.add(storageKey);
            removedDisplayIds.add(m.get("id") as string);
          }
        }
        itemTypes.delete(typeId);
        const typeIdx = itemTypeOrder.toArray().indexOf(typeId);
        if (typeIdx !== -1) itemTypeOrder.delete(typeIdx, 1);
        for (const storageKey of removedStorageKeys) {
          items.delete(storageKey);
          const idx = itemOrder.toArray().indexOf(storageKey);
          if (idx !== -1) itemOrder.delete(idx, 1);
        }
        for (const [relId, rel] of relationships.entries()) {
          if (removedDisplayIds.has(rel.fromItemId) || removedDisplayIds.has(rel.toItemId)) relationships.delete(relId);
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
        for (const storageKey of itemOrder.toArray()) {
          const m = items.get(storageKey);
          const currentSprintId = m?.get("sprintId") as string | undefined;
          if (m && currentSprintId && sprintIdSet.has(currentSprintId)) {
            m.set("sprintId", undefined);
          }
        }
      });
    },
  };
}
