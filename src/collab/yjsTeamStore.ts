import * as Y from "yjs";
import type { TeamDocument, TeamMember, PtoSpan, ExtraDayOff } from "../domain/teamTypes";
import { DEFAULT_TEAM_SETTINGS } from "../domain/teamTypes";
import type { TeamStore } from "./teamStore";

/**
 * Yjs-backed TeamStore. See teamStore.ts for why the operations are
 * shaped the way they are; this file is about the schema choices that
 * make those operations merge correctly under concurrent, independent
 * edits from different peers.
 *
 * Schema (all held on the given Y.Doc):
 *  - "memberOrder": Y.Array<string> - member ids, in display order. A
 *    separate ordering array (rather than relying on Y.Map iteration
 *    order, which isn't something to depend on) lets concurrent inserts
 *    from different peers merge into one deterministic combined order,
 *    the same way Yjs's array CRDT is designed to handle concurrent
 *    inserts generally.
 *  - "members": Y.Map<string, Y.Map> - keyed by member id. Each value is
 *    itself a Y.Map (NOT a plain object) holding that member's own
 *    scalar fields (name, role, avatarColor, defaultPointsPerDay) plus a
 *    nested Y.Array for ptoSpans. This nesting is the important part:
 *    if a member were stored as a single plain object value, Yjs would
 *    only be able to merge at the granularity of "the whole member
 *    changed" - one peer's edit would overwrite another's, even if they
 *    touched different fields. With each field as its own key on a
 *    nested Y.Map, two peers editing DIFFERENT fields of the SAME
 *    member (e.g. one changes name, another changes role) both survive
 *    the merge, which is the actual point of using a CRDT here.
 *  - "extraDaysOff": Y.Map<string, ExtraDayOff> - keyed by id, plain
 *    object values. No operation ever patches an existing entry's
 *    fields (only add/delete), so there's nothing to gain from nesting
 *    these the way members are nested - a plain value per id, replaced
 *    wholesale on the rare case of a concurrent double-write to the same
 *    id, is sufficient. No separate ordering array either: display order
 *    for these doesn't need to reflect insertion order the way a
 *    member list does.
 *  - "settings": Y.Map - the two scalar settings fields directly as
 *    keys. extraDaysOff is deliberately NOT part of this map (see
 *    TeamStore.updateSettings's doc comment).
 *
 * ptoSpans themselves are a Y.Array of plain objects (not further nested
 * per-span Y.Maps) because, like extraDaysOff, no operation ever patches
 * an existing span's fields - only whole-span add/delete.
 */
export function createYjsTeamStore(doc: Y.Doc): TeamStore {
  const memberOrder = doc.getArray<string>("memberOrder");
  const members = doc.getMap<Y.Map<unknown>>("members");
  const extraDaysOff = doc.getMap<ExtraDayOff>("extraDaysOff");
  const settings = doc.getMap<unknown>("settings");

  // One-time defaults, matching DEFAULT_TEAM_SETTINGS, if this is a
  // brand-new doc with nothing in it yet. Guarded by a key check so
  // joining an ALREADY-populated doc (the normal case - syncing to an
  // existing session) never stomps on real data with defaults.
  if (!settings.has("defaultPointsPerDay")) {
    doc.transact(() => {
      settings.set("defaultPointsPerDay", DEFAULT_TEAM_SETTINGS.defaultPointsPerDay);
      settings.set("excludeUsHolidays", DEFAULT_TEAM_SETTINGS.excludeUsHolidays);
    });
  }

  function memberMapToPlain(id: string, m: Y.Map<unknown>): TeamMember {
    return {
      id,
      name: m.get("name") as string,
      role: m.get("role") as string | undefined,
      avatarColor: m.get("avatarColor") as string | undefined,
      defaultPointsPerDay: m.get("defaultPointsPerDay") as number | undefined,
      ptoSpans: (m.get("ptoSpans") as Y.Array<PtoSpan>).toArray(),
    };
  }

  function buildSnapshot(): TeamDocument {
    return {
      members: memberOrder
        .toArray()
        .map((id) => {
          const m = members.get(id);
          return m ? memberMapToPlain(id, m) : null;
        })
        .filter((m): m is TeamMember => m !== null),
      settings: {
        defaultPointsPerDay: settings.get("defaultPointsPerDay") as number,
        excludeUsHolidays: settings.get("excludeUsHolidays") as boolean,
        extraDaysOff: Array.from(extraDaysOff.values()),
      },
    };
  }

  // Cached so getSnapshot() returns a stable reference between actual
  // changes - required for React's useSyncExternalStore (which this
  // interface is shaped to support) to avoid re-rendering, or looping,
  // when nothing has actually changed.
  let cached = buildSnapshot();
  const listeners = new Set<() => void>();

  const recomputeAndNotify = () => {
    cached = buildSnapshot();
    for (const listener of listeners) listener();
  };

  // observeDeep fires on any change anywhere within the nested structure
  // (a field on a member, a ptoSpans array insert, a settings key, an
  // order change) - covers every mutation path below, and just as
  // importantly, changes that arrive from syncing with a remote peer,
  // not only ones made through this store's own methods.
  memberOrder.observeDeep(recomputeAndNotify);
  members.observeDeep(recomputeAndNotify);
  extraDaysOff.observeDeep(recomputeAndNotify);
  settings.observeDeep(recomputeAndNotify);

  return {
    getSnapshot: () => cached,

    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    addMember: (member) => {
      doc.transact(() => {
        const m = new Y.Map<unknown>();
        m.set("name", member.name);
        m.set("role", member.role);
        m.set("avatarColor", member.avatarColor);
        m.set("defaultPointsPerDay", member.defaultPointsPerDay);
        const ptoArr = new Y.Array<PtoSpan>();
        ptoArr.push(member.ptoSpans);
        m.set("ptoSpans", ptoArr);
        members.set(member.id, m);
        memberOrder.push([member.id]);
      });
    },

    updateMember: (memberId, patch) => {
      const m = members.get(memberId);
      if (!m) return;
      doc.transact(() => {
        for (const [key, value] of Object.entries(patch)) {
          m.set(key, value);
        }
      });
    },

    deleteMember: (memberId) => {
      doc.transact(() => {
        members.delete(memberId);
        const idx = memberOrder.toArray().indexOf(memberId);
        if (idx !== -1) memberOrder.delete(idx, 1);
      });
    },

    addPtoSpan: (memberId, span) => {
      const m = members.get(memberId);
      if (!m) return;
      (m.get("ptoSpans") as Y.Array<PtoSpan>).push([span]);
    },

    deletePtoSpan: (memberId, ptoId) => {
      const m = members.get(memberId);
      if (!m) return;
      const ptoArr = m.get("ptoSpans") as Y.Array<PtoSpan>;
      const idx = ptoArr.toArray().findIndex((p) => p.id === ptoId);
      if (idx !== -1) ptoArr.delete(idx, 1);
    },

    addExtraDayOff: (extra) => {
      extraDaysOff.set(extra.id, extra);
    },

    deleteExtraDayOff: (extraId) => {
      extraDaysOff.delete(extraId);
    },

    updateSettings: (patch) => {
      doc.transact(() => {
        for (const [key, value] of Object.entries(patch)) {
          settings.set(key, value);
        }
      });
    },
  };
}
