import type { Milestone } from "../domain/milestones";
import { sanitizeRelatedItemIds } from "../domain/milestones";

export interface MilestonesStore {
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
   * Associates a workable item with a milestone (FR-007, AC-007).
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

  return {
    getSnapshot: () => milestones,

    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    addMilestone: (milestone) => {
      const now = new Date().toISOString();
      const newMilestone: Milestone = {
        ...milestone,
        id: nextMilestoneId(milestone.type || "milestone"),
        type: milestone.type || "release",
        name: milestone.name.trim(),
        scheduledAt: milestone.scheduledAt,
        relatedWorkableItemIds: sanitizeRelatedItemIds(milestone.relatedWorkableItemIds),
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
        return {
          ...m,
          ...patch,
          name: patch.name !== undefined ? patch.name.trim() : m.name,
          relatedWorkableItemIds:
            patch.relatedWorkableItemIds !== undefined
              ? sanitizeRelatedItemIds(patch.relatedWorkableItemIds)
              : m.relatedWorkableItemIds,
          updatedAt: now,
        };
      });
      notify();
    },

    deleteMilestone: (id) => {
      milestones = milestones.filter((m) => m.id !== id);
      notify();
    },

    addRelatedWorkableItem: (milestoneId, workableItemId) => {
      milestones = milestones.map((m) => {
        if (m.id !== milestoneId) return m;
        const current = m.relatedWorkableItemIds ?? [];
        if (current.includes(workableItemId)) return m;
        return {
          ...m,
          relatedWorkableItemIds: [...current, workableItemId],
          updatedAt: new Date().toISOString(),
        };
      });
      notify();
    },

    removeRelatedWorkableItem: (milestoneId, workableItemId) => {
      milestones = milestones.map((m) => {
        if (m.id !== milestoneId) return m;
        const current = m.relatedWorkableItemIds ?? [];
        if (!current.includes(workableItemId)) return m;
        return {
          ...m,
          relatedWorkableItemIds: current.filter((id) => id !== workableItemId),
          updatedAt: new Date().toISOString(),
        };
      });
      notify();
    },

    setRelatedWorkableItems: (milestoneId, workableItemIds) => {
      const sanitized = sanitizeRelatedItemIds(workableItemIds);
      milestones = milestones.map((m) => {
        if (m.id !== milestoneId) return m;
        return {
          ...m,
          relatedWorkableItemIds: sanitized,
          updatedAt: new Date().toISOString(),
        };
      });
      notify();
    },
  };
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

  return {
    getSnapshot: () => getMilestones(),

    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    addMilestone: (milestone) => {
      const now = new Date().toISOString();
      const newMilestone: Milestone = {
        ...milestone,
        id: nextMilestoneId(milestone.type || "milestone"),
        type: milestone.type || "release",
        name: milestone.name.trim(),
        scheduledAt: milestone.scheduledAt,
        relatedWorkableItemIds: sanitizeRelatedItemIds(milestone.relatedWorkableItemIds),
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
          return {
            ...m,
            ...patch,
            name: patch.name !== undefined ? patch.name.trim() : m.name,
            relatedWorkableItemIds:
              patch.relatedWorkableItemIds !== undefined
                ? sanitizeRelatedItemIds(patch.relatedWorkableItemIds)
                : m.relatedWorkableItemIds,
            updatedAt: now,
          };
        })
      );
    },

    deleteMilestone: (id) => {
      setMilestones((prev) => (prev ?? []).filter((m) => m.id !== id));
    },

    addRelatedWorkableItem: (milestoneId, workableItemId) => {
      const now = new Date().toISOString();
      setMilestones((prev) =>
        (prev ?? []).map((m) => {
          if (m.id !== milestoneId) return m;
          const current = m.relatedWorkableItemIds ?? [];
          if (current.includes(workableItemId)) return m;
          return {
            ...m,
            relatedWorkableItemIds: [...current, workableItemId],
            updatedAt: now,
          };
        })
      );
    },

    removeRelatedWorkableItem: (milestoneId, workableItemId) => {
      const now = new Date().toISOString();
      setMilestones((prev) =>
        (prev ?? []).map((m) => {
          if (m.id !== milestoneId) return m;
          const current = m.relatedWorkableItemIds ?? [];
          if (!current.includes(workableItemId)) return m;
          return {
            ...m,
            relatedWorkableItemIds: current.filter((id) => id !== workableItemId),
            updatedAt: now,
          };
        })
      );
    },

    setRelatedWorkableItems: (milestoneId, workableItemIds) => {
      const sanitized = sanitizeRelatedItemIds(workableItemIds);
      const now = new Date().toISOString();
      setMilestones((prev) =>
        (prev ?? []).map((m) => {
          if (m.id !== milestoneId) return m;
          return {
            ...m,
            relatedWorkableItemIds: sanitized,
            updatedAt: now,
          };
        })
      );
    },
  };
}
