/**
 * /v2/workspaces: workspaces, their members and their group mappings.
 *
 *   GET    /v2/workspaces                          the caller's workspaces
 *   POST   /v2/workspaces                          create one
 *   GET    /v2/workspaces/:id                      one workspace
 *   PATCH  /v2/workspaces/:id                      rename it
 *   POST   /v2/workspaces/:id/archive              (administrators)
 *   POST   /v2/workspaces/:id/restore              (administrators)
 *   GET    /v2/workspaces/:id/members              members and group mappings
 *   PUT    /v2/workspaces/:id/members/:userId      add someone or change their role
 *   DELETE /v2/workspaces/:id/members/:userId
 *   PUT    /v2/workspaces/:id/groups/:group        map a group or change its role
 *   DELETE /v2/workspaces/:id/groups/:group
 *   GET    /v2/workspaces/:id/people?query=        find people to add
 *
 * Documents inside a workspace are in documentRoutes.ts.
 */
import { canCreateWorkspace } from '../permissions.ts';
import { requireRole } from '../workspaces.ts';
import {
  fail,
  methodNotAllowed,
  requireAdmin,
  segment,
  translating,
  workspaceFor,
  workspaceJson,
  type V2Context,
} from './context.ts';
import { workspaceDocuments } from './documentRoutes.ts';

/** How many people a search returns at most. */
const PEOPLE_LIMIT = 20;

export async function workspaceRoutes(context: V2Context): Promise<void> {
  const { deps, caller, method } = context;
  const { principal } = caller;
  const audit = (operation: string, detail: Record<string, unknown>) =>
    context.record({ operation, outcome: 'ok', subject: caller.subject, docId: null, detail });

  // /v2/workspaces
  if (context.parts.length === 1) {
    if (method === 'GET') {
      context.describeForAudit('workspace.list');
      const includeArchived = context.url.searchParams.get('archived') === 'true';
      const accessible = await deps.workspaces.listAccessible(principal, { includeArchived });
      return context.send(200, { workspaces: accessible.map(workspaceJson) });
    }
    if (method === 'POST') {
      context.describeForAudit('workspace.create');
      if (!canCreateWorkspace(principal, deps.workspaceCreation)) {
        fail(403, 'forbidden', 'Only store administrators can create workspaces here.');
      }
      const body = await context.readJson();
      const workspace = await translating(() =>
        deps.workspaces.createWorkspace({
          name: body.name as string,
          createdBy: principal.userId,
        }),
      );
      await audit('workspace.create', { workspaceId: workspace.workspaceId, name: workspace.name });
      return context.send(201, {
        workspace: workspaceJson({ workspace, role: 'owner', source: { kind: 'member' } }),
      });
    }
    methodNotAllowed(context);
  }

  const workspaceId = segment(context, 1);
  const section = context.parts[2];

  // /v2/workspaces/:id
  if (section === undefined) {
    if (method === 'GET') {
      context.describeForAudit('workspace.read');
      return context.send(200, {
        workspace: workspaceJson(await workspaceFor(context, workspaceId, 'workspace.read')),
      });
    }
    if (method === 'PATCH') {
      context.describeForAudit('workspace.rename');
      const access = await workspaceFor(context, workspaceId, 'workspace.manage');
      const body = await context.readJson();
      const workspace = await translating(() =>
        deps.workspaces.renameWorkspace(workspaceId, body.name as string),
      );
      await audit('workspace.rename', { workspaceId, name: workspace.name });
      return context.send(200, { workspace: workspaceJson({ ...access, workspace }) });
    }
    methodNotAllowed(context);
  }

  if ((section === 'archive' || section === 'restore') && context.parts.length === 3) {
    if (method !== 'POST') methodNotAllowed(context);
    context.describeForAudit(`workspace.${section}`);
    requireAdmin(context);
    const workspace = await translating(() =>
      deps.workspaces.setArchived(workspaceId, section === 'archive'),
    );
    await audit(`workspace.${section}`, { workspaceId });
    return context.send(200, {
      workspace: workspaceJson({ workspace, role: 'owner', source: { kind: 'admin' } }),
    });
  }

  if (section === 'members') {
    // /v2/workspaces/:id/members
    if (context.parts.length === 3) {
      if (method !== 'GET') methodNotAllowed(context);
      context.describeForAudit('workspace.members');
      await workspaceFor(context, workspaceId, 'workspace.read');
      const [members, groups] = await Promise.all([
        deps.workspaces.listMembers(workspaceId),
        deps.workspaces.listGroupMappings(workspaceId),
      ]);
      return context.send(200, {
        members: await Promise.all(
          members.map(async (member) => ({
            userId: member.userId,
            displayName: await displayNameOf(context, member.userId),
            role: member.role,
            addedAt: member.addedAt,
          })),
        ),
        groups: groups.map((mapping) => ({
          group: mapping.group,
          role: mapping.role,
          addedAt: mapping.addedAt,
        })),
      });
    }
    // /v2/workspaces/:id/members/:userId
    if (context.parts.length === 4) {
      const userId = segment(context, 3);
      if (method === 'PUT') {
        context.describeForAudit('workspace.member.put');
        await workspaceFor(context, workspaceId, 'workspace.manage');
        const body = await context.readJson();
        const member = await translating(async () =>
          deps.workspaces.putMember({
            workspaceId,
            userId,
            role: requireRole(body.role),
            addedBy: principal.userId,
          }),
        );
        await audit('workspace.member.put', { workspaceId, userId, role: member.role });
        return context.send(200, {
          member: {
            userId: member.userId,
            displayName: await displayNameOf(context, member.userId),
            role: member.role,
            addedAt: member.addedAt,
          },
        });
      }
      if (method === 'DELETE') {
        context.describeForAudit('workspace.member.remove');
        await workspaceFor(context, workspaceId, 'workspace.manage');
        const removed = await translating(() => deps.workspaces.removeMember(workspaceId, userId));
        if (!removed) fail(404, 'not-found', 'That person was not added to this workspace.');
        await audit('workspace.member.remove', { workspaceId, userId });
        return context.send(200, { removed: true });
      }
      methodNotAllowed(context);
    }
  }

  // /v2/workspaces/:id/groups/:group
  if (section === 'groups' && context.parts.length === 4) {
    const group = segment(context, 3);
    if (method === 'PUT') {
      context.describeForAudit('workspace.group.put');
      await workspaceFor(context, workspaceId, 'workspace.manage');
      const body = await context.readJson();
      const mapping = await translating(async () =>
        deps.workspaces.putGroupMapping({
          workspaceId,
          group,
          role: requireRole(body.role),
          addedBy: principal.userId,
        }),
      );
      await audit('workspace.group.put', { workspaceId, group: mapping.group, role: mapping.role });
      return context.send(200, {
        group: { group: mapping.group, role: mapping.role, addedAt: mapping.addedAt },
      });
    }
    if (method === 'DELETE') {
      context.describeForAudit('workspace.group.remove');
      await workspaceFor(context, workspaceId, 'workspace.manage');
      const removed = await translating(() =>
        deps.workspaces.removeGroupMapping(workspaceId, group),
      );
      if (!removed) fail(404, 'not-found', 'That group is not mapped in this workspace.');
      await audit('workspace.group.remove', { workspaceId, group });
      return context.send(200, { removed: true });
    }
    methodNotAllowed(context);
  }

  // /v2/workspaces/:id/people?query=
  // The store's user list is not public: only someone who can add members
  // here may search it, and only by name.
  if (section === 'people' && context.parts.length === 3) {
    if (method !== 'GET') methodNotAllowed(context);
    context.describeForAudit('workspace.people');
    await workspaceFor(context, workspaceId, 'workspace.manage');
    const query = (context.url.searchParams.get('query') ?? '').trim().toLowerCase();
    if (query.length < 2) {
      fail(400, 'bad-request', 'Search for at least two characters of a name.');
    }
    const people = (await deps.directory.listUsers())
      .filter((user) => (user.displayName ?? '').toLowerCase().includes(query))
      .sort((a, b) => (a.displayName ?? '').localeCompare(b.displayName ?? ''))
      .slice(0, PEOPLE_LIMIT)
      .map((user) => ({ userId: user.userId, displayName: user.displayName ?? null }));
    return context.send(200, { people });
  }

  // /v2/workspaces/:id/documents
  if (section === 'documents' && context.parts.length === 3) {
    return workspaceDocuments(context, workspaceId);
  }

  fail(404, 'unsupported', `No route for ${context.url.pathname}.`);
}

/** A person's name for a list. Someone whose account is gone has none. */
async function displayNameOf(context: V2Context, userId: string): Promise<string | null> {
  try {
    return (await context.deps.directory.getUser(userId)).displayName ?? null;
  } catch {
    return null;
  }
}
