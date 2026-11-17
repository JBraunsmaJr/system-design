/**
 * The workspace API, served under /v2 (docs/trusted-store.md).
 *
 * In this API the server decides access. Every route resolves who is
 * asking, then asks permissions.ts - through `workspaceFor` and
 * `documentFor` in context.ts - whether their role allows it. Nothing here
 * handles keys, and nothing is encrypted by the editor before it arrives.
 *
 *   GET /v2/health        what kind of store this is (no sign-in needed)
 *   GET /v2/me            the caller, and what they may do store-wide
 *   /v2/workspaces/...    workspaceRoutes.ts
 *   /v2/documents/...     documentRoutes.ts
 *
 * It shares the existing service's sign-in routes (/v1/auth/...), sessions,
 * CORS handling, audit trail and error replies; see `v2` in
 * HttpServiceOptions.
 */
import type { V2Handler } from '../httpService.ts';
import { canCreateWorkspace } from '../permissions.ts';
import {
  assertSameSiteWrite,
  fail,
  methodNotAllowed,
  resolveCaller,
  type V2Context,
  type V2Dependencies,
} from './context.ts';
import { documentRoutes } from './documentRoutes.ts';
import { workspaceRoutes } from './workspaceRoutes.ts';

export type { V2Dependencies } from './context.ts';

export function createV2Api(deps: V2Dependencies): V2Handler {
  return async (request) => {
    const [area] = request.parts;

    if (area === 'health' && request.parts.length === 1) {
      if (request.method !== 'GET') methodNotAllowed(request);
      return request.send(200, {
        status: 'ok',
        // The server can read documents. The editor shows this.
        mode: 'trusted',
        authentication: deps.allowUnauthenticated ? 'none' : 'required',
        workspaceCreation: deps.workspaceCreation,
      });
    }

    // Before anything is read or changed: where the request came from, then
    // who sent it.
    assertSameSiteWrite(request, deps);
    const caller = await resolveCaller(request, deps);
    const context: V2Context = { ...request, deps, caller };

    if (area === 'me' && request.parts.length === 1) {
      if (request.method !== 'GET') methodNotAllowed(request);
      return request.send(200, {
        user: { userId: caller.principal.userId, displayName: caller.displayName },
        groups: caller.principal.groups,
        isAdmin: caller.principal.isAdmin,
        canCreateWorkspaces: canCreateWorkspace(caller.principal, deps.workspaceCreation),
      });
    }

    if (area === 'workspaces') return workspaceRoutes(context);
    if (area === 'documents') return documentRoutes(context);

    fail(404, 'unsupported', `No route for ${request.url.pathname}.`);
  };
}
