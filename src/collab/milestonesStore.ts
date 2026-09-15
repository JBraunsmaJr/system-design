import type { Milestone } from "../domain/milestones";
import { sanitizeRelatedItemIds } from "../domain/milestones";

export interface MilestonesStore {
  /**
   * Detaches every observer this store attached to the document (WS1 Step 1).
   *
   * The Yjs implementations register observeDeep handlers at construction and
   * previously had no way to remove them. That was survivable while a store
   * was built once per session, but the unified document model builds one per
   * DOCUMENT - so opening and closing documents would accumulate live
   * observers on documents still in memory, each rebuilding a snapshot on
   * every change.
   *
   * Safe to call more than once. Implementations that hold no document
   * resources may no-op.
   */
  destroy(): void;

  getSnapshot(): Milestone[];
  subscribe(listener: () => void): () => void;

  /**
   * Adds a new milestone (release or other type) and returns its stable unique id.
   */
  addMilestone(milestone: Omit<Milestone, "id" | "createdAt" | "updatedAt">): string;

  /**
   * Updates an existing milestone's metadata (name, date, version, description, color, etc.).
   */
  updateMilestone(id: string, patch: Partial<Omit<Milestone, "id">>): void;

  /**
   * Deletes a milestone. Preserves all related workable items (FR-006, DR-006, AC-005).
   */
  deleteMilestone(id: string): void;

  /**
   * Associates an item with a milestone (FR-005).
   */
  addRelatedItem(milestoneId: string, itemId: string): void;

  /**
   * Disassociates an item from a milestone.
   */
  removeRelatedItem(milestoneId: string, itemId: string): void;

  /**
   * Replaces all related item associations for a milestone.
   */
  setRelatedItems(milestoneId: string, itemIds: string[]): void;

  /**
   * Associates a workable item with a milestone (FR-007, AC-007, alias for addRelatedItem).
   */
  addRelatedWorkableItem(milestoneId: string, workableItemId: string): void;

  /**
   * Disassociates a workable item from a milestone.
   */
  removeRelatedWorkableItem(milestoneId: string, workableItemId: string): void;

  /**
   * Replaces all related workable item associations for a milestone.
   */
  setRelatedWorkableItems(milestoneId: string, workableItemIds: string[]): void;
}

let idCounter = 0;
function nextMilestoneId(prefix = "milestone"): string {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}-${idCounter}`;
}

export function createLocalMilestonesStore(initial: Milestone[] = []): MilestonesStore {
  let milestones: Milestone[] = initial;
  const listeners = new Set<() => void>();

  const notify = () => {
    for (const listener of listeners) listener();
  };

  const store: MilestonesStore = {
    getSnapshot: () => milestones,

    /** Holds no document resources, so there is nothing to detach. Present so
     * every implementation of the seam has the same shape. */
    destroy: () => {},
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    addMilestone: (milestone) => {
      const now = new Date().toISOString();
      const sanitized = sanitizeRelatedItemIds(milestone.relatedItemIds ?? milestone.relatedWorkableItemIds);
      const newMilestone: Milestone = {
        ...milestone,
        id: nextMilestoneId(milestone.type || "milestone"),
        type: milestone.type || "release",
        name: milestone.name.trim(),
        scheduledAt: milestone.scheduledAt,
        relatedItemIds: sanitized,
        relatedWorkableItemIds: sanitized,
        createdAt: now,
        updatedAt: now,
      };
      milestones = [...milestones, newMilestone];
      notify();
      return newMilestone.id;
    },

    updateMilestone: (id, patch) => {
      const now = new Date().toISOString();
      milestones = milestones.map((m) => {
        if (m.id !== id) return m;
        const hasNewRelated = patch.relatedItemIds !== undefined || patch.relatedWorkableItemIds !== undefined;
        const sanitized = hasNewRelated
          ? sanitizeRelatedItemIds(patch.relatedItemIds ?? patch.relatedWorkableItemIds)
          : (m.relatedItemIds ?? m.relatedWorkableItemIds);
        return {
          ...m,
          ...patch,
          name: patch.name !== undefined ? patch.name.trim() : m.name,
          relatedItemIds: sanitized,
          relatedWorkableItemIds: sanitized,
          updatedAt: now,
        };
      });
      notify();
    },

    deleteMilestone: (id) => {
      milestones = milestones.filter((m) => m.id !== id);
      notify();
    },

    addRelatedItem: (milestoneId, itemId) => {
      milestones = milestones.map((m) => {
        if (m.id !== milestoneId) return m;
        const current = m.relatedItemIds ?? m.relatedWorkableItemIds ?? [];
        if (current.includes(itemId)) return m;
        const updated = [...current, itemId];
        return {
          ...m,
          relatedItemIds: updated,
          relatedWorkableItemIds: updated,
          updatedAt: new Date().toISOString(),
        };
      });
      notify();
    },

    removeRelatedItem: (milestoneId, itemId) => {
      milestones = milestones.map((m) => {
        if (m.id !== milestoneId) return m;
        const current = m.relatedItemIds ?? m.relatedWorkableItemIds ?? [];
        if (!current.includes(itemId)) return m;
        const updated = current.filter((id) => id !== itemId);
        return {
          ...m,
          relatedItemIds: updated,
          relatedWorkableItemIds: updated,
          updatedAt: new Date().toISOString(),
        };
      });
      notify();
    },

    setRelatedItems: (milestoneId, itemIds) => {
      const sanitized = sanitizeRelatedItemIds(itemIds);
      milestones = milestones.map((m) => {
        if (m.id !== milestoneId) return m;
        return {
          ...m,
          relatedItemIds: sanitized,
          relatedWorkableItemIds: sanitized,
          updatedAt: new Date().toISOString(),
        };
      });
      notify();
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

/**
 * Adapter over external React state updater (e.g. useUndoableState DiagramSnapshot).
 */
export function createAdapterMilestonesStore(
  getMilestones: () => Milestone[],
  setMilestones: (updater: (prev: Milestone[]) => Milestone[]) => void
): MilestonesStore {
  // Listeners are informed whenever React state changes
  const listeners = new Set<() => void>();

  const store: MilestonesStore = {
    getSnapshot: () => getMilestones(),

    /** Holds no document resources, so there is nothing to detach. Present so
     * every implementation of the seam has the same shape. */
    destroy: () => {},
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    addMilestone: (milestone) => {
      const now = new Date().toISOString();
      const sanitized = sanitizeRelatedItemIds(milestone.relatedItemIds ?? milestone.relatedWorkableItemIds);
      const newMilestone: Milestone = {
        ...milestone,
        id: nextMilestoneId(milestone.type || "milestone"),
        type: milestone.type || "release",
        name: milestone.name.trim(),
        scheduledAt: milestone.scheduledAt,
        relatedItemIds: sanitized,
        relatedWorkableItemIds: sanitized,
        createdAt: now,
        updatedAt: now,
      };
      setMilestones((prev) => [...(prev ?? []), newMilestone]);
      return newMilestone.id;
    },

    updateMilestone: (id, patch) => {
      const now = new Date().toISOString();
      setMilestones((prev) =>
        (prev ?? []).map((m) => {
          if (m.id !== id) return m;
          const hasNewRelated = patch.relatedItemIds !== undefined || patch.relatedWorkableItemIds !== undefined;
          const sanitized = hasNewRelated
            ? sanitizeRelatedItemIds(patch.relatedItemIds ?? patch.relatedWorkableItemIds)
            : (m.relatedItemIds ?? m.relatedWorkableItemIds);
          return {
            ...m,
            ...patch,
            name: patch.name !== undefined ? patch.name.trim() : m.name,
            relatedItemIds: sanitized,
            relatedWorkableItemIds: sanitized,
            updatedAt: now,
          };
        })
      );
    },

    deleteMilestone: (id) => {
      setMilestones((prev) => (prev ?? []).filter((m) => m.id !== id));
    },

    addRelatedItem: (milestoneId, itemId) => {
      const now = new Date().toISOString();
      setMilestones((prev) =>
        (prev ?? []).map((m) => {
          if (m.id !== milestoneId) return m;
          const current = m.relatedItemIds ?? m.relatedWorkableItemIds ?? [];
          if (current.includes(itemId)) return m;
          const updated = [...current, itemId];
          return {
            ...m,
            relatedItemIds: updated,
            relatedWorkableItemIds: updated,
            updatedAt: now,
          };
        })
      );
    },

    removeRelatedItem: (milestoneId, itemId) => {
      const now = new Date().toISOString();
      setMilestones((prev) =>
        (prev ?? []).map((m) => {
          if (m.id !== milestoneId) return m;
          const current = m.relatedItemIds ?? m.relatedWorkableItemIds ?? [];
          if (!current.includes(itemId)) return m;
          const updated = current.filter((id) => id !== itemId);
          return {
            ...m,
            relatedItemIds: updated,
            relatedWorkableItemIds: updated,
            updatedAt: now,
          };
        })
      );
    },

    setRelatedItems: (milestoneId, itemIds) => {
      const sanitized = sanitizeRelatedItemIds(itemIds);
      const now = new Date().toISOString();
      setMilestones((prev) =>
        (prev ?? []).map((m) => {
          if (m.id !== milestoneId) return m;
          return {
            ...m,
            relatedItemIds: sanitized,
            relatedWorkableItemIds: sanitized,
            updatedAt: now,
          };
        })
      );
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
