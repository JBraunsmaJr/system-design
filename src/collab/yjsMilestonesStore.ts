import * as Y from "yjs";
import type { Milestone } from "../domain/milestones";
import { sanitizeRelatedItemIds } from "../domain/milestones";
import type { MilestonesStore } from "./milestonesStore";

let idCounter = 0;
function nextMilestoneId(prefix = "milestone"): string {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}-${idCounter}`;
}

export function seedYjsMilestonesDoc(doc: Y.Doc, initial: Milestone[]): void {
  const milestoneOrder = doc.getArray<string>("milestoneOrder");
  const milestones = doc.getMap<Y.Map<unknown>>("milestones");

  doc.transact(() => {
    for (const m of initial) {
      const mM = new Y.Map<unknown>();
      mM.set("type", m.type);
      mM.set("name", m.name);
      mM.set("scheduledAt", m.scheduledAt);
      if (m.version !== undefined) mM.set("version", m.version);
      if (m.description !== undefined) mM.set("description", m.description);
      if (m.color !== undefined) mM.set("color", m.color);
      if (m.icon !== undefined) mM.set("icon", m.icon);
      const relArr = new Y.Array<string>();
      const ids = sanitizeRelatedItemIds(m.relatedItemIds ?? m.relatedWorkableItemIds);
      if (ids.length > 0) {
        relArr.push(ids);
      }
      mM.set("relatedItemIds", relArr);
      mM.set("relatedWorkableItemIds", relArr);
      if (m.createdAt) mM.set("createdAt", m.createdAt);
      if (m.updatedAt) mM.set("updatedAt", m.updatedAt);

      milestones.set(m.id, mM);
      milestoneOrder.push([m.id]);
    }
  });
}

export function createYjsMilestonesStore(doc: Y.Doc): MilestonesStore {
  const milestoneOrder = doc.getArray<string>("milestoneOrder");
  const milestones = doc.getMap<Y.Map<unknown>>("milestones");

  function milestoneMapToPlain(id: string, m: Y.Map<unknown>): Milestone {
    const relArr = (m.get("relatedItemIds") ?? m.get("relatedWorkableItemIds")) as Y.Array<string> | undefined;
    const ids = relArr ? relArr.toArray() : [];
    return {
      id,
      type: (m.get("type") as string) || "release",
      name: (m.get("name") as string) || "",
      scheduledAt: (m.get("scheduledAt") as string) || "",
      version: m.get("version") as string | undefined,
      description: m.get("description") as string | undefined,
      color: m.get("color") as string | undefined,
      icon: m.get("icon") as string | undefined,
      relatedItemIds: ids,
      relatedWorkableItemIds: ids,
      createdAt: m.get("createdAt") as string | undefined,
      updatedAt: m.get("updatedAt") as string | undefined,
    };
  }

  function buildSnapshot(): Milestone[] {
    return milestoneOrder
      .toArray()
      .map((id) => {
        const m = milestones.get(id);
        return m ? milestoneMapToPlain(id, m) : null;
      })
      .filter((m): m is Milestone => m !== null);
  }

  let cached = buildSnapshot();
  const listeners = new Set<() => void>();

  const recomputeAndNotify = () => {
    cached = buildSnapshot();
    for (const listener of listeners) listener();
  };

  milestoneOrder.observeDeep(recomputeAndNotify);
  milestones.observeDeep(recomputeAndNotify);

  const store: MilestonesStore = {
    getSnapshot: () => cached,

    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    addMilestone: (milestone) => {
      const now = new Date().toISOString();
      const id = nextMilestoneId(milestone.type || "milestone");
      const name = milestone.name.trim();
      const sanitizedIds = sanitizeRelatedItemIds(milestone.relatedItemIds ?? milestone.relatedWorkableItemIds);

      doc.transact(() => {
        const mM = new Y.Map<unknown>();
        mM.set("type", milestone.type || "release");
        mM.set("name", name);
        mM.set("scheduledAt", milestone.scheduledAt);
        if (milestone.version !== undefined) mM.set("version", milestone.version);
        if (milestone.description !== undefined) mM.set("description", milestone.description);
        if (milestone.color !== undefined) mM.set("color", milestone.color);
        if (milestone.icon !== undefined) mM.set("icon", milestone.icon);
        const relArr = new Y.Array<string>();
        if (sanitizedIds.length > 0) {
          relArr.push(sanitizedIds);
        }
        mM.set("relatedItemIds", relArr);
        mM.set("relatedWorkableItemIds", relArr);
        mM.set("createdAt", now);
        mM.set("updatedAt", now);

        milestones.set(id, mM);
        milestoneOrder.push([id]);
      });

      return id;
    },

    updateMilestone: (id, patch) => {
      const mM = milestones.get(id);
      if (!mM) return;
      const now = new Date().toISOString();

      doc.transact(() => {
        if (patch.name !== undefined) mM.set("name", patch.name.trim());
        if (patch.type !== undefined) mM.set("type", patch.type);
        if (patch.scheduledAt !== undefined) mM.set("scheduledAt", patch.scheduledAt);
        if (patch.version !== undefined) mM.set("version", patch.version);
        if (patch.description !== undefined) mM.set("description", patch.description);
        if (patch.color !== undefined) mM.set("color", patch.color);
        if (patch.icon !== undefined) mM.set("icon", patch.icon);

        if (patch.relatedItemIds !== undefined || patch.relatedWorkableItemIds !== undefined) {
          const sanitized = sanitizeRelatedItemIds(patch.relatedItemIds ?? patch.relatedWorkableItemIds);
          let relArr = (mM.get("relatedItemIds") ?? mM.get("relatedWorkableItemIds")) as Y.Array<string> | undefined;
          if (!relArr) {
            relArr = new Y.Array<string>();
            mM.set("relatedItemIds", relArr);
            mM.set("relatedWorkableItemIds", relArr);
          }
          relArr.delete(0, relArr.length);
          if (sanitized.length > 0) {
            relArr.push(sanitized);
          }
        }
        mM.set("updatedAt", now);
      });
    },

    deleteMilestone: (id) => {
      doc.transact(() => {
        milestones.delete(id);
        const idx = milestoneOrder.toArray().indexOf(id);
        if (idx !== -1) milestoneOrder.delete(idx, 1);
      });
    },

    addRelatedItem: (milestoneId, itemId) => {
      const mM = milestones.get(milestoneId);
      if (!mM) return;

      doc.transact(() => {
        let relArr = (mM.get("relatedItemIds") ?? mM.get("relatedWorkableItemIds")) as Y.Array<string> | undefined;
        if (!relArr) {
          relArr = new Y.Array<string>();
          mM.set("relatedItemIds", relArr);
          mM.set("relatedWorkableItemIds", relArr);
        }
        if (!relArr.toArray().includes(itemId)) {
          relArr.push([itemId]);
          mM.set("updatedAt", new Date().toISOString());
        }
      });
    },

    removeRelatedItem: (milestoneId, itemId) => {
      const mM = milestones.get(milestoneId);
      if (!mM) return;

      doc.transact(() => {
        const relArr = (mM.get("relatedItemIds") ?? mM.get("relatedWorkableItemIds")) as Y.Array<string> | undefined;
        if (!relArr) return;
        const idx = relArr.toArray().indexOf(itemId);
        if (idx !== -1) {
          relArr.delete(idx, 1);
          mM.set("updatedAt", new Date().toISOString());
        }
      });
    },

    setRelatedItems: (milestoneId, itemIds) => {
      const mM = milestones.get(milestoneId);
      if (!mM) return;
      const sanitized = sanitizeRelatedItemIds(itemIds);

      doc.transact(() => {
        let relArr = (mM.get("relatedItemIds") ?? mM.get("relatedWorkableItemIds")) as Y.Array<string> | undefined;
        if (!relArr) {
          relArr = new Y.Array<string>();
          mM.set("relatedItemIds", relArr);
          mM.set("relatedWorkableItemIds", relArr);
        }
        relArr.delete(0, relArr.length);
        if (sanitized.length > 0) {
          relArr.push(sanitized);
        }
        mM.set("updatedAt", new Date().toISOString());
      });
    },

    addRelatedWorkableItem: (milestoneId, workableItemId) => {
      store.addRelatedItem(milestoneId, workableItemId);
    },

    removeRelatedWorkableItem: (milestoneId, workableItemId) => {
      store.removeRelatedItem(milestoneId, workableItemId);
    },

    setRelatedWorkableItems: (milestoneId, workableItemIds) => {
      store.setRelatedItems(milestoneId, workableItemIds);
    },
  };

  return store;
}
