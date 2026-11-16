/**
 * What the store administration page shows, worked out from what the store
 * already reports: for each workspace its members, mapped groups and
 * documents. Kept apart from the page so it can be checked without a
 * browser.
 *
 * The page asks for these per workspace. That is two requests a workspace,
 * a few at a time, which is fine for the tens of workspaces a store has; a
 * store with thousands would want the counts from the server instead.
 */
import type {
  TrustedDocument,
  TrustedGroupMapping,
  TrustedMember,
  TrustedWorkspace,
  WorkspaceRole,
} from './trustedStoreClient.ts';

/** Everything known about one workspace. */
export interface WorkspaceDetail {
  workspace: TrustedWorkspace;
  members: TrustedMember[];
  groups: TrustedGroupMapping[];
  /** Live and deleted documents alike. */
  documents: TrustedDocument[];
}

export interface WorkspaceRow {
  workspaceId: string;
  name: string;
  archived: boolean;
  /** People added by name. People who come through a group are not
   * countable: the store only knows a group by its name. */
  memberCount: number;
  groupCount: number;
  documentCount: number;
  deletedCount: number;
  /** The latest change to any of its documents, or its creation. */
  lastActivity: string;
}

const latest = (a: string, b: string) => (Date.parse(b) > Date.parse(a) ? b : a);

export function summarizeWorkspace(detail: WorkspaceDetail): WorkspaceRow {
  const { workspace, members, groups, documents } = detail;
  const live = documents.filter((d) => d.deletedAt === null);
  return {
    workspaceId: workspace.workspaceId,
    name: workspace.name,
    archived: workspace.archivedAt !== null,
    memberCount: members.length,
    groupCount: groups.length,
    documentCount: live.length,
    deletedCount: documents.length - live.length,
    lastActivity: documents.reduce(
      (when, d) => latest(when, d.deletedAt ?? d.updatedAt),
      workspace.archivedAt ?? workspace.createdAt,
    ),
  };
}

/** Active workspaces by name, then archived ones by name. */
export function sortWorkspaceRows(rows: readonly WorkspaceRow[]): WorkspaceRow[] {
  return [...rows].sort(
    (a, b) => Number(a.archived) - Number(b.archived) || a.name.localeCompare(b.name),
  );
}

/** "12 people, 2 groups" - what the Members column says. */
export function describeMembership(row: Pick<WorkspaceRow, 'memberCount' | 'groupCount'>): string {
  const people = `${row.memberCount} ${row.memberCount === 1 ? 'person' : 'people'}`;
  if (row.groupCount === 0) return people;
  const groups = `${row.groupCount} ${row.groupCount === 1 ? 'group' : 'groups'}`;
  return row.memberCount === 0 ? groups : `${people}, ${groups}`;
}

export interface Grant {
  workspaceId: string;
  workspaceName: string;
  role: WorkspaceRole;
}

export interface PersonRow {
  userId: string;
  displayName: string | null;
  grants: Grant[];
}

export interface GroupRow {
  group: string;
  grants: Grant[];
}

const byWorkspaceName = (a: Grant, b: Grant) => a.workspaceName.localeCompare(b.workspaceName);

/** Everyone added to a workspace by name, with where and as what. Archived
 * workspaces are left out: nobody has access through them. */
export function peopleAcross(details: readonly WorkspaceDetail[]): PersonRow[] {
  const people = new Map<string, PersonRow>();
  for (const { workspace, members } of details) {
    if (workspace.archivedAt !== null) continue;
    for (const member of members) {
      const row = people.get(member.userId) ?? {
        userId: member.userId,
        displayName: member.displayName,
        grants: [],
      };
      row.grants.push({
        workspaceId: workspace.workspaceId,
        workspaceName: workspace.name,
        role: member.role,
      });
      people.set(member.userId, row);
    }
  }
  return [...people.values()]
    .map((row) => ({ ...row, grants: row.grants.sort(byWorkspaceName) }))
    .sort((a, b) =>
      (a.displayName ?? a.userId).localeCompare(b.displayName ?? b.userId, undefined, {
        sensitivity: 'base',
      }),
    );
}

/** Every identity-provider group a workspace gives a role to. */
export function groupsAcross(details: readonly WorkspaceDetail[]): GroupRow[] {
  const groups = new Map<string, GroupRow>();
  for (const { workspace, groups: mappings } of details) {
    if (workspace.archivedAt !== null) continue;
    for (const mapping of mappings) {
      const row = groups.get(mapping.group) ?? { group: mapping.group, grants: [] };
      row.grants.push({
        workspaceId: workspace.workspaceId,
        workspaceName: workspace.name,
        role: mapping.role,
      });
      groups.set(mapping.group, row);
    }
  }
  return [...groups.values()]
    .map((row) => ({ ...row, grants: row.grants.sort(byWorkspaceName) }))
    .sort((a, b) => a.group.localeCompare(b.group));
}

/** "2 minutes ago", "Yesterday", "3 weeks ago" - for a column of dates
 * where the order of magnitude is what matters. */
export function describeWhen(iso: string, now: Date): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';
  const minutes = Math.max(0, Math.round((now.getTime() - then) / 60000));
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'Yesterday';
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.round(days / 7)} weeks ago`;
  if (days < 730) return `${Math.round(days / 30)} months ago`;
  return `${Math.round(days / 365)} years ago`;
}

/** Runs `task` over `items`, at most `limit` at a time, keeping order. */
export async function inBatches<T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await task(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
