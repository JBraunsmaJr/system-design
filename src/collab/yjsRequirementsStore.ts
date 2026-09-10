import * as Y from "yjs";
import type {
  RequirementsDocument,
  RequirementItem,
  RequirementItemType,
  RequirementCategory,
  RelationshipType,
  RequirementRelationship,
} from "../domain/requirementsTypes";
import {
  defaultStatusForType,
  isPrefixTaken,
  addRelationship as addRelationshipPure,
  updateItemReferencesInText,
  BUILT_IN_ITEM_TYPES,
  BUILT_IN_RELATIONSHIP_TYPES,
} from "../domain/requirementsRegistry";
import type { RequirementsStore } from "./requirementsStore";

/** Item storage keys are purely internal - never displayed, never
 * referenced by anything outside this file (see this file's top doc
 * comment on the storage-key/display-id split) - so, same reasoning as
 * program increments' and the diagram's own ids, there's no reason not
 * to make them fully collision-resistant from the start. */
function collisionResistantId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Populates a Y.Doc directly from an existing, already-populated
 * RequirementsDocument - the inverse of this file's own buildSnapshot.
 * Unlike every public RequirementsStore operation (addItem,
 * addCustomType, createAndAssignCategory, etc.), which always generate
 * a fresh id for whatever's being created, this preserves every
 * existing id EXACTLY as it already is - essential, since items
 * reference categories, relationships reference items, and so on
 * throughout the whole document; regenerating any of those ids during
 * seeding would silently break those references.
 *
 * Meant to be called on a brand-new, empty Y.Doc, BEFORE
 * createYjsRequirementsStore(doc) is ever constructed against it - that
 * constructor's own "seed built-in types if empty" check will correctly
 * see the doc is no longer empty and skip injecting its own defaults,
 * since this function's own item type seeding already covers built-ins
 * (they're just regular entries in `initial.itemTypes`, same as any
 * custom type).
 *
 * Items still get the same collision-resistant internal storage key
 * every item created through the normal addItem path gets (see this
 * file's own top-level doc comment for why that split exists) - only
 * the human-readable "id" field is preserved from the original data,
 * which is the only part anything else in the app actually references.
 */
export function seedYjsRequirementsDoc(doc: Y.Doc, initial: RequirementsDocument): void {
  const itemTypeOrder = doc.getArray<string>("itemTypeOrder");
  const itemTypesMap = doc.getMap<Y.Map<unknown>>("itemTypes");
  const categoryOrder = doc.getArray<string>("categoryOrder");
  const categoriesMap = doc.getMap<RequirementCategory>("categories");
  const itemOrder = doc.getArray<string>("itemOrder");
  const itemsMap = doc.getMap<Y.Map<unknown>>("items");
  const relationshipTypesMap = doc.getMap<RelationshipType>("relationshipTypes");
  const relationshipsMap = doc.getMap<RequirementRelationship>("relationships");
  const nextSequenceMap = doc.getMap<number>("nextSequence");

  doc.transact(() => {
    for (const t of initial.itemTypes) {
      const m = new Y.Map<unknown>();
      m.set("label", t.label);
      m.set("prefix", t.prefix);
      m.set("color", t.color);
      m.set("isBuiltIn", t.isBuiltIn);
      m.set("isWorkable", t.isWorkable);
      itemTypesMap.set(t.id, m);
      itemTypeOrder.push([t.id]);
    }
    for (const c of initial.categories) {
      categoriesMap.set(c.id, c);
      categoryOrder.push([c.id]);
    }
    for (const item of initial.items) {
      const storageKey = collisionResistantId("item");
      const m = new Y.Map<unknown>();
      m.set("id", item.id);
      m.set("typeId", item.typeId);
      m.set("title", item.title);
      m.set("body", item.body);
      m.set("categoryId", item.categoryId);
      m.set("sprintId", item.sprintId);
      m.set("assigneeId", item.assigneeId);
      m.set("points", item.points);
      m.set("status", item.status);
      itemsMap.set(storageKey, m);
      itemOrder.push([storageKey]);
    }
    for (const t of initial.relationshipTypes) {
      relationshipTypesMap.set(t.id, t);
    }
    for (const r of initial.relationships) {
      relationshipsMap.set(r.id, r);
    }
    for (const [typeId, seq] of Object.entries(initial.nextSequence)) {
      nextSequenceMap.set(typeId, seq);
    }
  });
}

/**
 * Seeds built-in item/relationship types into `doc`, but only if it's
 * genuinely, entirely empty of them already - matching how a fresh
 * RequirementsDocument always starts with these (see
 * EMPTY_REQUIREMENTS_DOCUMENT / withMissingBuiltInTypes).
 *
 * Deliberately NOT called automatically by createYjsRequirementsStore
 * itself anymore - it used to be, guarded by this same "is it actually
 * empty" check, based on the assumption that construction-time
 * emptiness meant "a genuinely new, never-used document." That's true
 * for real standalone/test use, but false for joinSession: it
 * constructs this store on a deliberately empty Y.Doc BEFORE the
 * WebRTC sync with the host has any chance to run, so the check would
 * pass and this would fire - seeding local built-ins that then conflict
 * with the host's own once CRDT sync actually happens (Y.Arrays don't
 * deduplicate by value, so itemTypeOrder would end up with duplicate
 * entries; Y.Map key collisions on the nested type objects
 * non-deterministically discard whichever side's write didn't "win").
 * Neither of the app's own two session-starting paths need this call at
 * all: startNewSession already seeds built-ins as part of seeding the
 * full local requirements state via seedYjsRequirementsDoc (which
 * always includes them, since a real RequirementsDocument always does),
 * and joinSession must never seed anything locally in the first place.
 */
export function seedBuiltInTypesIfEmpty(doc: Y.Doc): void {
  const itemTypeOrder = doc.getArray<string>("itemTypeOrder");
  const itemTypes = doc.getMap<Y.Map<unknown>>("itemTypes");
  const relationshipTypes = doc.getMap<RelationshipType>("relationshipTypes");
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
}


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
  /**
   * Definitions of custom item types that have been deleted, kept so a
   * type can be restored faithfully if a concurrent edit turns out to
   * have been using it - see repairOrphanedReferences. Written by
   * deleteCustomType, consumed (and cleared) by the repair, and cleared
   * again by addCustomType in case an id is later reused.
   *
   * A deleted type's definition is genuinely unrecoverable from the Yjs
   * doc otherwise: deleting the map entry discards label, color and
   * isWorkable, and isWorkable in particular decides whether the type's
   * items can go into a sprint at all. Reconstructing that from a
   * display-id prefix would be a guess.
   */
  const deletedItemTypes = doc.getMap<Y.Map<unknown>>("deletedItemTypes");

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

  /**
   * Maps an item's display id to its internal storage key. Rebuilt every
   * time buildSnapshot runs - cheap, since that already walks every item
   * once, and it's what lets updateItem/deleteItem/createAndAssignCategory
   * (all of which receive a display id from their caller, per the public
   * RequirementsStore contract) find the right underlying entry in O(1)
   * instead of a linear scan on every call - including every keystroke
   * while editing a title.
   */
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

    /**
     * Every currently-used display id, kept up to date as this pass
     * hands out new ones - checked against so a freshly reassigned id
     * can never collide with either an existing item OR another loser
     * reassigned earlier in this SAME pass (which byDisplayId alone
     * wouldn't catch, since it reflects the state from before this pass
     * started, not what's being assigned as it runs).
     */
    const usedDisplayIds = new Set(byDisplayId.keys());

    doc.transact(() => {
      for (const storageKeys of collisions) {
        const [, ...losers] = [...storageKeys].sort();
        for (const loserKey of losers) {
          const m = items.get(loserKey);
          if (!m) continue;
          const typeId = m.get("typeId") as string;
          const typeMap = itemTypes.get(typeId);
          const type = typeMap ? itemTypeMapToPlain(typeId, typeMap) : undefined;
          const prefix = type?.prefix ?? typeId;
          /**
           * Keep advancing past any id that's already taken, rather than
           * assigning nextSequence's value outright and hoping it
           * doesn't collide - see this function's own doc comment above
           * for why that assumption doesn't always hold.
           */
          let seq = (nextSequence.get(typeId) as number | undefined) ?? 1;
          let candidate = `${prefix}-${seq}`;
          while (usedDisplayIds.has(candidate)) {
            seq += 1;
            candidate = `${prefix}-${seq}`;
          }
          m.set("id", candidate);
          usedDisplayIds.add(candidate);
          nextSequence.set(typeId, seq + 1);
        }
      }
    });
    return true;
  }

  /**
   * Clears or restores references that point at something no longer in
   * the document, and returns whether it changed anything.
   *
   * These dangling references are only ever produced by a MERGE, never
   * by a local edit: deleteCategory and deleteCustomType both leave the
   * document consistent when they run. The damage comes from two edits
   * that were each valid against the state their own peer could see -
   *
   *   - one peer assigns an item to a category while another deletes
   *     that category, and
   *   - one peer creates an item under a custom type while another
   *     deletes that type, its in-use guard correctly seeing no items.
   *
   * Yjs merges both, since the assignment and the deletion touch
   * different maps and neither is a conflicting write. So the repair
   * cannot live inside those mutators - by the time the conflicting
   * edit arrives they have long since run. It belongs here, on the path
   * that runs after every document change including a remote one,
   * exactly like repairDuplicateDisplayIds above.
   *
   * Every peer runs the same deterministic repair over the same merged
   * state and therefore writes the same values, so this converges
   * rather than fighting itself. It also terminates: once the reference
   * resolves, the repair no longer fires for it.
   *
   * The two cases are repaired in opposite directions on purpose.
   *
   * A dangling categoryId is CLEARED. A category is an optional label,
   * so dropping it leaves the item intact and merely uncategorized -
   * which is exactly what deleteCategory's own contract promises, and
   * what "group by category" already displays for such items anyway.
   *
   * A missing item type is RESTORED, not reassigned. An item's whole
   * identity derives from its type: the display id ("WID-1") carries
   * the type's prefix, relationships reference items by that display
   * id, and #WID-1 references in other items' bodies resolve through
   * it. Reassigning the item to some fallback type would either break
   * all of that or silently change what the item means. Restoring is
   * also what deleteCustomType's own invariant asks for - a type with
   * items is not deletable, and the merge is what reveals this one had
   * items after all, so the deletion was never legal. Without this the
   * item vanishes outright from the requirements list, since "group by
   * type" (the default) builds its groups by iterating the types that
   * exist and collecting their items - an item whose type is gone lands
   * in no group at all.
   */
  function repairOrphanedReferences(): boolean {
    const danglingCategoryKeys: string[] = [];
    const missingTypeIds = new Map<string, string>(); // typeId -> a display id using it

    for (const storageKey of itemOrder.toArray()) {
      const m = items.get(storageKey);
      if (!m) continue;

      const categoryId = m.get("categoryId") as string | undefined;
      if (categoryId !== undefined && !categories.has(categoryId)) danglingCategoryKeys.push(storageKey);

      const typeId = m.get("typeId") as string;
      if (typeId !== undefined && !itemTypes.has(typeId) && !missingTypeIds.has(typeId)) {
        missingTypeIds.set(typeId, m.get("id") as string);
      }
    }

    if (danglingCategoryKeys.length === 0 && missingTypeIds.size === 0) return false;

    doc.transact(() => {
      for (const storageKey of danglingCategoryKeys) {
        items.get(storageKey)?.set("categoryId", undefined);
      }

      for (const [typeId, sampleDisplayId] of missingTypeIds) {
        const restored = new Y.Map<unknown>();
        const tombstone = deletedItemTypes.get(typeId);
        if (tombstone) {
          for (const [key, value] of tombstone.entries()) restored.set(key, value);
        } else {
          /**
           * No tombstone: the type was dropped by a client that predates
           * deleteCustomType recording one, or by some other path. Fall
           * back to reconstructing just enough for the item to be
           * visible and editable again, derived from the prefix already
           * baked into its own display id. The label is marked so it's
           * obvious this was recovered rather than authored, and
           * isWorkable defaults to false because guessing it true would
           * silently make these items sprint-eligible - the more
           * damaging direction to be wrong in.
           */
          const prefix = /^([A-Za-z][A-Za-z0-9]*)-\d+$/.exec(sampleDisplayId)?.[1] ?? typeId.toUpperCase();
          restored.set("label", `${prefix} (recovered)`);
          restored.set("prefix", prefix);
          restored.set("color", "#98a2b3");
          restored.set("isWorkable", false);
        }
        restored.set("isBuiltIn", false);
        itemTypes.set(typeId, restored);
        if (!itemTypeOrder.toArray().includes(typeId)) itemTypeOrder.push([typeId]);
        deletedItemTypes.delete(typeId);
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

  /*
   * Run once up front, before the first snapshot is cached - a collision
   * could already be baked into the doc if it was inherited from a prior
   * session's sync, before this particular store instance existed to
   * observe anything.
   */
  repairDuplicateDisplayIds();
  repairOrphanedReferences();

  let cached = buildSnapshot();
  const listeners = new Set<() => void>();
  const recomputeAndNotify = () => {
    if (repairDuplicateDisplayIds()) return; // its own transact() triggers another observeDeep round, which will rebuild `cached` correctly
    if (repairOrphanedReferences()) return; // same - its writes re-enter here with the document already consistent
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

    /**
     * The display id ("REQ-6") is generated as a per-type sequence counter,
     * read-incremented-written-back. Two disconnected peers creating an item of the same
     * type can still end up computing the same candidate id before either has seen the
     * other's change; under normal, connected collaboration this never happens (Yj's
     * casual ordering means one peer's write is visible to the next before it acts)
     * @param typeId
     */
    addItem: (typeId) => {
      const typeMap = itemTypes.get(typeId);
      const type = typeMap ? itemTypeMapToPlain(typeId, typeMap) : undefined;
      const prefix = type?.prefix ?? typeId;
      const usedIds = new Set<string>();
      for (const storageKey of itemOrder.toArray()) {
        const itemMap = items.get(storageKey);
        if (itemMap) {
          const itId = itemMap.get("id") as string;
          if (itId) usedIds.add(itId);
        }
      }
      let sequence = 1;
      while (usedIds.has(`${prefix}-${sequence}`)) {
        sequence++;
      }
      const displayId = `${prefix}-${sequence}`;
      const storageKey = collisionResistantId("item");
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

    convertItemType: (id, newTypeId) => {
      const storageKey = displayIdToStorageKey.get(id);
      const m = storageKey ? items.get(storageKey) : undefined;
      if (!m) return undefined;
      const currentTypeId = m.get("typeId") as string;
      if (currentTypeId === newTypeId) return id;

      const targetTypeMap = itemTypes.get(newTypeId);
      if (!targetTypeMap) return undefined;
      const isWorkable = (targetTypeMap.get("isWorkable") as boolean) ?? false;
      const targetPrefix = (targetTypeMap.get("prefix") as string) ?? newTypeId;

      const usedIds = new Set<string>();
      for (const key of itemOrder.toArray()) {
        const itemMap = items.get(key);
        if (itemMap) {
          const itId = itemMap.get("id") as string;
          if (itId) usedIds.add(itId);
        }
      }
      let sequence = 1;
      while (usedIds.has(`${targetPrefix}-${sequence}`)) {
        sequence++;
      }
      const newId = `${targetPrefix}-${sequence}`;

      doc.transact(() => {
        m.set("id", newId);
        m.set("typeId", newTypeId);
        if (isWorkable) {
          if (!m.get("status")) m.set("status", "todo");
        } else {
          m.set("status", undefined);
          m.set("points", undefined);
          m.set("assigneeId", undefined);
          m.set("sprintId", undefined);
        }

        // Update relationships
        for (const [relId, rel] of relationships.entries()) {
          if (rel.fromItemId === id || rel.toItemId === id) {
            relationships.set(relId, {
              ...rel,
              fromItemId: rel.fromItemId === id ? newId : rel.fromItemId,
              toItemId: rel.toItemId === id ? newId : rel.toItemId,
            });
          }
        }

        // Update references in body of all items
        for (const key of itemOrder.toArray()) {
          const itemMap = items.get(key);
          if (itemMap) {
            const body = itemMap.get("body") as string | undefined;
            if (body && (body.includes(`#${id}`) || body.includes(`#ref:${id}`))) {
              itemMap.set("body", updateItemReferencesInText(body, id, newId));
            }
          }
        }

        nextSequence.set(newTypeId, sequence + 1);
      });
      return newId;
    },

    convertAllItemsOfType: (fromTypeId, toTypeId) => {
      if (fromTypeId === toTypeId) return 0;
      const targetTypeMap = itemTypes.get(toTypeId);
      if (!targetTypeMap) return 0;
      const isWorkable = (targetTypeMap.get("isWorkable") as boolean) ?? false;
      const targetPrefix = (targetTypeMap.get("prefix") as string) ?? toTypeId;

      const usedIds = new Set<string>();
      for (const key of itemOrder.toArray()) {
        const itemMap = items.get(key);
        if (itemMap) {
          const itId = itemMap.get("id") as string;
          if (itId) usedIds.add(itId);
        }
      }

      const conversions: { oldId: string; newId: string; storageKey: string }[] = [];
      let sequence = 1;

      for (const storageKey of itemOrder.toArray()) {
        const m = items.get(storageKey);
        if (m && m.get("typeId") === fromTypeId) {
          const oldId = m.get("id") as string;
          while (usedIds.has(`${targetPrefix}-${sequence}`)) {
            sequence++;
          }
          const newId = `${targetPrefix}-${sequence}`;
          usedIds.add(newId);
          conversions.push({ oldId, newId, storageKey });
          sequence++;
        }
      }

      if (conversions.length === 0) return 0;

      doc.transact(() => {
        for (const { newId, storageKey } of conversions) {
          const m = items.get(storageKey);
          if (m) {
            m.set("id", newId);
            m.set("typeId", toTypeId);
            if (isWorkable) {
              if (!m.get("status")) m.set("status", "todo");
            } else {
              m.set("status", undefined);
              m.set("points", undefined);
              m.set("assigneeId", undefined);
              m.set("sprintId", undefined);
            }
          }
        }

        // Update relationships
        for (const { oldId, newId } of conversions) {
          for (const [relId, rel] of relationships.entries()) {
            if (rel.fromItemId === oldId || rel.toItemId === oldId) {
              relationships.set(relId, {
                ...rel,
                fromItemId: rel.fromItemId === oldId ? newId : rel.fromItemId,
                toItemId: rel.toItemId === oldId ? newId : rel.toItemId,
              });
            }
          }
        }

        // Update references in body of all items
        for (const key of itemOrder.toArray()) {
          const itemMap = items.get(key);
          if (itemMap) {
            let body = itemMap.get("body") as string | undefined;
            if (body) {
              let updated = body;
              for (const { oldId, newId } of conversions) {
                if (updated.includes(`#${oldId}`) || updated.includes(`#ref:${oldId}`)) {
                  updated = updateItemReferencesInText(updated, oldId, newId);
                }
              }
              if (updated !== body) {
                itemMap.set("body", updated);
              }
            }
          }
        }

        nextSequence.set(toTypeId, sequence);
      });
      return conversions.length;
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

    /**
     * Same category-id caveat as addItem's display id (see its doc
     * comment) - lower risk in practice since categories are created far
     * less often than items, and not given the same storage-key
     * treatment here since categories aren't nested maps to begin with
     * (see this file's top doc comment).
     * @param itemId
     * @param label
     */
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

    deleteCategory: (categoryId) => {
      doc.transact(() => {
        categories.delete(categoryId);
        const idx = categoryOrder.toArray().indexOf(categoryId);
        if (idx !== -1) categoryOrder.delete(idx, 1);
        // Clearing the reference matters more here than in the local
        // store: a peer could be holding an item open with this category
        // selected right now, and leaving a dangling categoryId would
        // render as a silently blank chip rather than as uncategorized.
        for (const storageKey of itemOrder.toArray()) {
          const m = items.get(storageKey);
          if (m?.get("categoryId") === categoryId) m.set("categoryId", undefined);
        }
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
        // custom-N ids are reused once freed (the scan above picks the
        // smallest unused number), so an old tombstone under this id
        // would describe a completely unrelated type.
        deletedItemTypes.delete(id);
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

    // The usage check reads the live Y.Maps rather than the cached
    // snapshot, and sits INSIDE the transaction: in a session the whole
    // point of this guard is the item a collaborator added since this
    // client last rendered, which is exactly what a cached read would
    // miss. It still can't close the window entirely - two peers can
    // concurrently delete a type and add an item under it, and Yjs will
    // merge both - but refusing on the freshest state available makes
    // that a narrow race rather than the default outcome.
    deleteCustomType: (typeId) => {
      let deleted = false;
      doc.transact(() => {
        for (const storageKey of itemOrder.toArray()) {
          if (items.get(storageKey)?.get("typeId") === typeId) return;
        }
        const existing = itemTypes.get(typeId);
        if (!existing) return;
        // Snapshot the definition before dropping it. If a peer created
        // an item under this type concurrently, the merged document will
        // contain that item and no type for it, and repairOrphanedReferences
        // restores the type from here rather than guessing at it.
        const tombstone = new Y.Map<unknown>();
        for (const [key, value] of existing.entries()) tombstone.set(key, value);
        deletedItemTypes.set(typeId, tombstone);
        itemTypes.delete(typeId);
        const typeIdx = itemTypeOrder.toArray().indexOf(typeId);
        if (typeIdx !== -1) itemTypeOrder.delete(typeIdx, 1);
        deleted = true;
      });
      return deleted;
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
