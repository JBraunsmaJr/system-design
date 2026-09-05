import type { TeamDocument, TeamMember, PtoSpan, ExtraDayOff, TeamSettings } from "../domain/teamTypes";
import { EMPTY_TEAM_DOCUMENT } from "../domain/teamTypes";

/**
 * TeamStore is the seam between "how the team document is stored" and
 * everything in the app that reads or mutates it. There are two
 * implementations: createLocalTeamStore (this file - plain in-memory
 * state, functionally identical to the useState-based approach the app
 * uses today) and createYjsTeamStore (yjsTeamStore.ts - Yjs-backed, for
 * collaborative sessions). Every component and domain function should be
 * able to work against this interface without knowing or caring which
 * implementation is behind it.
 *
 * The operations here are deliberately narrow and named, mirroring every
 * mutation TeamView.tsx currently performs via its single generic
 * onUpdateTeam((prev) => newDoc) callback - add/update/delete member,
 * add/delete PTO span, add/delete extra day off, update the two scalar
 * settings fields. This is not an arbitrary API design choice: a
 * "replace the whole document" callback is exactly the pattern a CRDT
 * cannot merge correctly under. If two people concurrently called
 * onUpdateTeam with two different whole-document replacements, one would
 * silently overwrite the other - indistinguishable from naive
 * last-write-wins, which defeats the reason for using a CRDT at all.
 * Named, narrow operations are what let the Yjs implementation translate
 * each one into a targeted change to a specific shared-type key, which
 * Yjs can then merge correctly against a concurrent, different targeted
 * change from another peer.
 *
 * getSnapshot/subscribe deliberately match the shape React's
 * useSyncExternalStore expects, so either implementation can be wired
 * into a component with that hook directly - the right, built-in way to
 * bridge a mutable external store (this one, or a Yjs doc) into React
 * without stale-closure bugs.
 */
export interface TeamStore {
  getSnapshot(): TeamDocument;
  subscribe(listener: () => void): () => void;

  addMember(member: TeamMember): void;
  updateMember(memberId: string, patch: Partial<Omit<TeamMember, "id" | "ptoSpans">>): void;
  deleteMember(memberId: string): void;

  addPtoSpan(memberId: string, span: PtoSpan): void;
  deletePtoSpan(memberId: string, ptoId: string): void;

  addExtraDayOff(extra: ExtraDayOff): void;
  deleteExtraDayOff(extraId: string): void;

  /** extraDaysOff is intentionally excluded here - it has its own
   * add/delete operations above precisely because two different paths
   * that could both touch the same array is a footgun, especially once
   * a Yjs-backed implementation is involved. */
  updateSettings(patch: Partial<Pick<TeamSettings, "defaultPointsPerDay" | "excludeUsHolidays">>): void;
}

export function createLocalTeamStore(initial: TeamDocument = EMPTY_TEAM_DOCUMENT): TeamStore {
  let doc: TeamDocument = initial;
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

    addMember: (member) => {
      doc = { ...doc, members: [...doc.members, member] };
      notify();
    },

    updateMember: (memberId, patch) => {
      doc = {
        ...doc,
        members: doc.members.map((m) => (m.id === memberId ? { ...m, ...patch } : m)),
      };
      notify();
    },

    deleteMember: (memberId) => {
      doc = { ...doc, members: doc.members.filter((m) => m.id !== memberId) };
      notify();
    },

    addPtoSpan: (memberId, span) => {
      doc = {
        ...doc,
        members: doc.members.map((m) => (m.id === memberId ? { ...m, ptoSpans: [...m.ptoSpans, span] } : m)),
      };
      notify();
    },

    deletePtoSpan: (memberId, ptoId) => {
      doc = {
        ...doc,
        members: doc.members.map((m) =>
          m.id === memberId ? { ...m, ptoSpans: m.ptoSpans.filter((p) => p.id !== ptoId) } : m
        ),
      };
      notify();
    },

    addExtraDayOff: (extra) => {
      doc = { ...doc, settings: { ...doc.settings, extraDaysOff: [...doc.settings.extraDaysOff, extra] } };
      notify();
    },

    deleteExtraDayOff: (extraId) => {
      doc = {
        ...doc,
        settings: { ...doc.settings, extraDaysOff: doc.settings.extraDaysOff.filter((e) => e.id !== extraId) },
      };
      notify();
    },

    updateSettings: (patch) => {
      doc = { ...doc, settings: { ...doc.settings, ...patch } };
      notify();
    },
  };
}
