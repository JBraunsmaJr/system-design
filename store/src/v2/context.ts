/**
 * What every /v2 route shares: who is asking, and the two questions that
 * decide whether they may - "may they do this in this workspace?" and "may
 * they do this to this document?".
 *
 * Route handlers never decide access themselves. They call `workspaceFor`
 * or `documentFor`, which load the grants and ask permissions.ts, and they
 * get back either what they asked for or an error:
 *
 *   - 404 when the person has no role in the workspace at all. It is the
 *     same reply as for a workspace that does not exist, so the API does not
 *     confirm to an outsider that something is there.
 *   - 403 when they are in the workspace but their role is not enough, or
 *     the workspace is archived. They can already see it, so saying why is
 *     more useful than pretending it is missing.
 */
import { HttpError, type StoreBackend, type V2Request } from '../httpService.ts';
import {
  canInWorkspace,
  effectiveRole,
  type EffectiveRole,
  type Principal,
  type WorkspaceAction,
  type WorkspaceCreationPolicy,
  type WorkspaceGrants,
} from '../permissions.ts';
import { WorkspaceError, type Workspace, type WorkspaceStore } from '../workspaces.ts';
import { CatalogError, type CatalogEntry, type DocumentCatalog } from '../documentCatalog.ts';
import { DirectoryError, type UserDirectory } from '../userDirectory.ts';

export interface V2Dependencies {
  workspaces: WorkspaceStore;
  catalog: DocumentCatalog;
  /** Document content: the update log, versions, deletion and retention. */
  documents: StoreBackend;
  directory: UserDirectory;
  /** Whether this sign-in is a store administrator's. */
  isAdmin(identity: { issuer: string; subject: string; groups: readonly string[] }): boolean;
  workspaceCreation: WorkspaceCreationPolicy;
  /**
   * No sign-in required. Development and demonstrations only: every request
   * is then the same local administrator, since without identities there is
   * nobody to tell apart.
   */
  allowUnauthenticated?: boolean;
  /** The store's own address, and the other origins the editor is served
   * from. A request that changes something must come from one of them. */
  publicUrl: () => string;
  allowedOrigins: readonly string[];
  /** Set where the relay only admits people carrying a token from this
   * store (RELAY_TOKEN_SECRET). A document's session then comes with one. */
  relayTokenSecret?: string | null;
}

export interface Caller {
  principal: Principal;
  displayName: string | null;
  /** `issuer#subject`, as the audit trail names people. */
  subject: string;
}

/** One request, with the caller resolved. */
export interface V2Context extends V2Request {
  deps: V2Dependencies;
  caller: Caller;
}

export function fail(status: number, reason: string, message: string): never {
  throw new HttpError(status, reason, message);
}

/**
 * Runs a store call and turns the stores' own errors into HTTP ones. A
 * missing workspace, document or user is 404; a name or id already taken is
 * 409; bad input is 400.
 */
export async function translating<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof WorkspaceError || error instanceof CatalogError) {
      const status = error.reason === 'not-found' ? 404 : error.reason === 'invalid' ? 400 : 409;
      fail(status, error.reason === 'invalid' ? 'bad-request' : error.reason, error.message);
    }
    if (error instanceof DirectoryError && error.reason === 'not-found') {
      fail(404, 'not-found', error.message);
    }
    throw error;
  }
}

const LOCAL_IDENTITY = { issuer: 'local', subject: 'anonymous', displayName: 'Local user' };

/** Who is asking. Refuses (401) a request with no session, unless the store
 * runs without sign-in. */
export async function resolveCaller(request: V2Request, deps: V2Dependencies): Promise<Caller> {
  const { session } = request;
  if (!session) {
    if (!deps.allowUnauthenticated) {
      fail(401, 'unauthenticated', 'Sign in to use this store.');
    }
    const user = await deps.directory.upsertUser(LOCAL_IDENTITY);
    return {
      principal: { userId: user.userId, groups: [], isAdmin: true },
      displayName: LOCAL_IDENTITY.displayName,
      subject: `${LOCAL_IDENTITY.issuer}#${LOCAL_IDENTITY.subject}`,
    };
  }
  const groups = session.groups ?? [];
  // Sign-in records the directory user on the session. A session without
  // one (made before the directory existed) is resolved here instead.
  const userId =
    session.userId ??
    (
      await deps.directory.upsertUser({
        issuer: session.issuer,
        subject: session.subject,
        displayName: session.displayName,
      })
    ).userId;
  return {
    principal: {
      userId,
      groups,
      isAdmin: deps.isAdmin({ issuer: session.issuer, subject: session.subject, groups }),
    },
    displayName: session.displayName ?? null,
    subject: `${session.issuer}#${session.subject}`,
  };
}

/**
 * A request that changes something must come from the editor. Browsers send
 * `Origin` on every cross-site request that can carry a cookie, so a page on
 * another site cannot spend a signed-in person's session; and a body must be
 * JSON, which a cross-site form cannot send without a preflight this store
 * would refuse.
 */
export function assertSameSiteWrite(request: V2Request, deps: V2Dependencies) {
  if (request.method === 'GET' || request.method === 'HEAD') return;
  const origin = request.request.headers.origin;
  if (typeof origin === 'string') {
    const own = new URL(deps.publicUrl()).origin;
    if (origin !== own && !deps.allowedOrigins.includes(origin)) {
      fail(403, 'forbidden-origin', 'This request did not come from the editor.');
    }
  }
  const length = Number(request.request.headers['content-length'] ?? 0);
  const type = String(request.request.headers['content-type'] ?? '');
  if (length > 0 && !/^application\/json\b/i.test(type)) {
    fail(415, 'unsupported-media-type', 'Send the request body as application/json.');
  }
}

export interface WorkspaceAccess extends EffectiveRole {
  workspace: Workspace;
  grants: WorkspaceGrants;
}

const ACTION_WORDS: Record<WorkspaceAction, string> = {
  'workspace.read': 'see this workspace',
  'workspace.manage': 'manage this workspace',
  'document.read': 'open documents in this workspace',
  'document.write': 'change documents in this workspace',
  'document.delete': 'delete or restore documents in this workspace',
};

/**
 * The workspace, if the caller may perform `action` in it. See the top of
 * this file for which refusal is a 404 and which a 403.
 */
export async function workspaceFor(
  context: V2Context,
  workspaceId: string,
  action: WorkspaceAction,
): Promise<WorkspaceAccess> {
  const { principal } = context.caller;
  const found = await context.deps.workspaces.grantsFor(workspaceId, principal.userId);
  const effective = found ? effectiveRole(principal, found.grants) : null;
  const archived = !!found?.workspace.archivedAt;
  // No role, or an archived workspace seen by anyone but an administrator:
  // as far as this person is concerned it does not exist.
  if (!found || !effective || (archived && !principal.isAdmin)) {
    fail(404, 'not-found', 'There is no such workspace, or you are not a member of it.');
  }
  if (!canInWorkspace(principal, found.grants, { archived }, action)) {
    fail(
      403,
      'forbidden',
      archived
        ? 'This workspace is archived. Restore it to change anything in it.'
        : `Your role here is ${effective.role}, which cannot ${ACTION_WORDS[action]}.`,
    );
  }
  return { workspace: found.workspace, grants: found.grants, ...effective };
}

export interface DocumentAccess {
  entry: CatalogEntry;
  access: WorkspaceAccess;
}

/**
 * The document's catalog entry, if the caller may perform `action` on it.
 * A document the caller cannot see is a 404, exactly like one that does not
 * exist; one they can see but not change is a 403.
 */
export async function documentFor(
  context: V2Context,
  docId: string,
  action: WorkspaceAction,
): Promise<DocumentAccess> {
  const entry = await context.deps.catalog.get(docId);
  if (!entry) missingDocument();
  try {
    const access = await workspaceFor(context, entry.workspaceId, action);
    return { entry, access };
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) missingDocument();
    throw error;
  }
}

function missingDocument(): never {
  fail(404, 'not-found', 'There is no such document, or you do not have access to it.');
}

export function requireAdmin(context: V2Context) {
  if (!context.caller.principal.isAdmin) {
    fail(403, 'forbidden', 'This action is for store administrators.');
  }
}

/** A path segment, decoded. A malformed escape is the caller's mistake. */
export function segment(context: V2Request, index: number): string {
  const raw = context.parts[index];
  if (raw === undefined) return '';
  try {
    return decodeURIComponent(raw);
  } catch {
    fail(400, 'bad-request', 'The address contains a malformed escape sequence.');
  }
}

export function methodNotAllowed(context: V2Request): never {
  fail(405, 'unsupported', `${context.method} is not allowed on ${context.url.pathname}.`);
}

/** How a workspace is described to someone who has a role in it. */
export function workspaceJson(access: {
  workspace: Workspace;
  role: EffectiveRole['role'];
  source: EffectiveRole['source'];
}) {
  return {
    workspaceId: access.workspace.workspaceId,
    name: access.workspace.name,
    createdAt: access.workspace.createdAt,
    archivedAt: access.workspace.archivedAt,
    /** The caller's own role, and how they came by it. */
    role: access.role,
    via: access.source,
  };
}
