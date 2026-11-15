/**
 * /v2 documents.
 *
 *   GET    /v2/workspaces/:id/documents            list (?deleted=true for retained ones)
 *   POST   /v2/workspaces/:id/documents            create
 *   GET    /v2/documents/:docId                    the document and every update
 *   PATCH  /v2/documents/:docId                    retitle, or move to another workspace
 *   DELETE /v2/documents/:docId                    soft-delete
 *   POST   /v2/documents/:docId/restore
 *   GET    /v2/documents/:docId/updates?since=     updates after a version
 *   POST   /v2/documents/:docId/updates            append one
 *   POST   /v2/documents/:docId/compact            replace the log with a snapshot
 *   PUT    /v2/documents/:docId/hold               (administrators)
 *   DELETE /v2/documents/:docId/hold               (administrators)
 *   POST   /v2/documents/:docId/purge              (administrators)
 *
 * A document is addressed by its id alone. The workspace it is in comes
 * from the catalog, never from the request, so a caller cannot claim a
 * document belongs to a workspace they happen to have a role in.
 *
 * Update bytes are opaque here, as they are to the document service: the
 * store keeps what the editor sends and does not parse it.
 */
import type { DocumentRecord } from '../documentService.ts';
import { fromBase64, positiveInt, positiveIntHeader, toBase64 } from '../httpService.ts';
import { canMoveDocument } from '../permissions.ts';
import { requireDocId, type CatalogEntry } from '../documentCatalog.ts';
import {
  documentFor,
  fail,
  methodNotAllowed,
  requireAdmin,
  segment,
  translating,
  workspaceFor,
  type V2Context,
} from './context.ts';

/** How a document is described: where it is and what it is called, from
 * the catalog; its version and lifecycle, from the document service. */
function documentJson(entry: CatalogEntry, record: DocumentRecord) {
  return {
    docId: entry.docId,
    workspaceId: entry.workspaceId,
    title: entry.title,
    createdAt: entry.createdAt,
    version: record.version,
    updatedAt: record.updatedAt,
    deletedAt: record.deletedAt,
    purgeAfter: record.purgeAfter,
    legalHold: record.legalHold
      ? { reason: record.legalHold.reason, placedAt: record.legalHold.placedAt }
      : null,
  };
}

const blobsJson = (blobs: { meta: unknown; bytes: Uint8Array }[]) =>
  blobs.map((blob) => ({ ...(blob.meta as object), bytes: toBase64(blob.bytes) }));

/** GET and POST /v2/workspaces/:id/documents. */
export async function workspaceDocuments(context: V2Context, workspaceId: string): Promise<void> {
  const { deps, caller, method } = context;

  if (method === 'GET') {
    context.describeForAudit('document.list');
    const includeDeleted = context.url.searchParams.get('deleted') === 'true';
    // Deleted documents are shown to the people who could restore them.
    await workspaceFor(context, workspaceId, includeDeleted ? 'document.delete' : 'document.read');
    const documents = [];
    for (const entry of await deps.catalog.listByWorkspace(workspaceId)) {
      let record: DocumentRecord;
      try {
        record = (await deps.documents.head(entry.docId, {
          includeDeleted: true,
        })) as DocumentRecord;
      } catch {
        // Purged by the retention sweep since it was catalogued.
        await deps.catalog.remove(entry.docId);
        continue;
      }
      if (record.deletedAt && !includeDeleted) continue;
      documents.push(documentJson(entry, record));
    }
    return context.send(200, { documents });
  }

  if (method === 'POST') {
    context.describeForAudit('document.create');
    await workspaceFor(context, workspaceId, 'document.write');
    const body = await context.readJson();
    const docId = await translating(async () => requireDocId(body.docId));
    context.describeForAudit('document.create', docId);
    // Content first: the catalog row points at it. Until that row exists
    // the document is unreachable, so a failure in between leaves nothing
    // anyone can see - and it is cleared away below.
    const record = (await deps.documents.create({
      docId,
      keys: { wrappedForWorkspace: '' },
    })) as DocumentRecord;
    let entry: CatalogEntry;
    try {
      entry = await translating(() =>
        deps.catalog.add({
          docId,
          workspaceId,
          title: body.title as string,
          createdBy: caller.principal.userId,
        }),
      );
    } catch (error) {
      await deps.documents.purge?.(docId).catch(() => {});
      throw error;
    }
    await context.record({
      operation: 'document.create',
      outcome: 'ok',
      subject: caller.subject,
      docId,
      detail: { workspaceId },
    });
    return context.send(201, { document: documentJson(entry, record) }, record.version);
  }

  methodNotAllowed(context);
}

/** Everything under /v2/documents/:docId. */
export async function documentRoutes(context: V2Context): Promise<void> {
  const { deps, caller, method } = context;
  const docId = segment(context, 1);
  if (!docId) fail(404, 'unsupported', `No route for ${context.url.pathname}.`);
  const tail = context.parts[2];
  if (context.parts.length > 3) fail(404, 'unsupported', `No route for ${context.url.pathname}.`);
  const seenVersion = positiveIntHeader(context.request, 'if-document-version');
  const audit = (operation: string, detail?: Record<string, unknown>) =>
    context.record({ operation, outcome: 'ok', subject: caller.subject, docId, detail });

  if (tail === undefined) {
    if (method === 'GET') {
      context.describeForAudit('document.read', docId);
      const { entry } = await documentFor(context, docId, 'document.read');
      const result = await deps.documents.read(docId, { seenVersion });
      const record = result.record as DocumentRecord;
      await audit('document.read');
      return context.send(
        200,
        { document: documentJson(entry, record), blobs: blobsJson(result.blobs) },
        record.version,
      );
    }

    if (method === 'PATCH') {
      const body = await context.readJson();
      const moving = body.workspaceId !== undefined;
      const retitling = body.title !== undefined;
      if (moving === retitling) {
        fail(400, 'bad-request', 'Send either a title or a workspaceId, not both and not neither.');
      }
      if (retitling) {
        context.describeForAudit('document.retitle', docId);
        await documentFor(context, docId, 'document.write');
        const entry = await translating(() => deps.catalog.setTitle(docId, body.title as string));
        const record = (await deps.documents.head(docId, {
          includeDeleted: true,
        })) as DocumentRecord;
        await audit('document.retitle');
        return context.send(200, { document: documentJson(entry, record) }, record.version);
      }

      context.describeForAudit('document.move', docId);
      if (typeof body.workspaceId !== 'string' || body.workspaceId === '') {
        fail(400, 'bad-request', 'workspaceId must name the workspace to move the document to.');
      }
      const destinationId = body.workspaceId;
      // The source is checked first: someone who may not take the document
      // out of its workspace is refused before the destination is looked
      // at, so the reply says nothing about a workspace they may not see.
      const from = await documentFor(context, docId, 'document.delete');
      const to = await workspaceFor(context, destinationId, 'document.write');
      // The same rule again, stated once in permissions.ts. The two checks
      // above already imply it; this keeps the route honest if they change.
      const allowed = canMoveDocument(
        caller.principal,
        {
          grants: from.access.grants,
          workspace: { archived: !!from.access.workspace.archivedAt },
        },
        { grants: to.grants, workspace: { archived: !!to.workspace.archivedAt } },
      );
      if (!allowed) {
        fail(
          403,
          'forbidden',
          'Moving a document needs the right to delete it where it is and to add documents where it is going.',
        );
      }
      const entry = await translating(() => deps.catalog.move(docId, destinationId));
      const record = (await deps.documents.head(docId, { includeDeleted: true })) as DocumentRecord;
      await audit('document.move', { from: from.entry.workspaceId, to: destinationId });
      return context.send(200, { document: documentJson(entry, record) }, record.version);
    }

    if (method === 'DELETE') {
      context.describeForAudit('document.delete', docId);
      const { entry } = await documentFor(context, docId, 'document.delete');
      const record = (await deps.documents.softDelete(docId)) as DocumentRecord;
      await audit('document.delete');
      return context.send(200, { document: documentJson(entry, record) }, record.version);
    }

    methodNotAllowed(context);
  }

  if (tail === 'restore') {
    if (method !== 'POST') methodNotAllowed(context);
    context.describeForAudit('document.restore', docId);
    const { entry } = await documentFor(context, docId, 'document.delete');
    const record = (await deps.documents.restore(docId)) as DocumentRecord;
    await audit('document.restore');
    return context.send(200, { document: documentJson(entry, record) }, record.version);
  }

  if (tail === 'updates') {
    if (method === 'GET') {
      context.describeForAudit('document.updates', docId);
      const { entry } = await documentFor(context, docId, 'document.read');
      const since = positiveInt(context.url.searchParams.get('since'), 'since') ?? 0;
      const result = await deps.documents.updatesSince(docId, since, { seenVersion });
      const record = result.record as DocumentRecord;
      return context.send(
        200,
        { document: documentJson(entry, record), blobs: blobsJson(result.blobs) },
        record.version,
      );
    }
    if (method === 'POST') {
      context.describeForAudit('document.append', docId);
      await documentFor(context, docId, 'document.write');
      const body = await context.readJson();
      const appended = await deps.documents.append({
        docId,
        kind: typeof body.kind === 'string' ? body.kind : 'update',
        bytes: fromBase64(body.bytes, 'bytes'),
        expectedVersion:
          typeof body.expectedVersion === 'number' ? body.expectedVersion : undefined,
      });
      await audit('document.append');
      return context.send(201, { document: appended }, appended.version);
    }
    methodNotAllowed(context);
  }

  if (tail === 'compact') {
    if (method !== 'POST') methodNotAllowed(context);
    context.describeForAudit('document.compact', docId);
    await documentFor(context, docId, 'document.write');
    const body = await context.readJson();
    const compacted = await deps.documents.compact(docId, {
      kind: typeof body.kind === 'string' ? body.kind : 'snapshot',
      bytes: fromBase64(body.bytes, 'bytes'),
      // Without this a snapshot made a moment ago would erase an update
      // someone else appended since.
      expectedVersion: typeof body.expectedVersion === 'number' ? body.expectedVersion : undefined,
    });
    await audit('document.compact');
    return context.send(200, { document: compacted }, compacted.version);
  }

  if (tail === 'hold') {
    if (method !== 'PUT' && method !== 'DELETE') methodNotAllowed(context);
    context.describeForAudit(method === 'PUT' ? 'document.hold' : 'document.release', docId);
    requireAdmin(context);
    const { entry } = await documentFor(context, docId, 'document.read');
    if (!deps.documents.setLegalHold) {
      fail(404, 'unsupported', 'This store does not support legal holds.');
    }
    if (method === 'PUT') {
      const body = await context.readJson();
      if (typeof body.reason !== 'string' || body.reason.trim() === '') {
        fail(400, 'bad-request', 'Say why the hold is being placed.');
      }
      const reason = body.reason.trim();
      const record = (await deps.documents.setLegalHold(docId, {
        reason,
        placedBy: caller.subject,
      })) as DocumentRecord;
      await audit('document.hold', { reason });
      return context.send(200, { document: documentJson(entry, record) }, record.version);
    }
    const record = (await deps.documents.setLegalHold(docId, null)) as DocumentRecord;
    await audit('document.release');
    return context.send(200, { document: documentJson(entry, record) }, record.version);
  }

  if (tail === 'purge') {
    if (method !== 'POST') methodNotAllowed(context);
    context.describeForAudit('document.purge', docId);
    requireAdmin(context);
    await documentFor(context, docId, 'document.read');
    if (!deps.documents.purge) fail(404, 'unsupported', 'This store does not support purging.');
    await deps.documents.purge(docId);
    // PostgreSQL removes the catalog row with the document; in memory it is
    // removed here. Either way it is gone afterwards.
    await deps.catalog.remove(docId);
    await audit('document.purge');
    return context.send(200, { purged: true });
  }

  fail(404, 'unsupported', `No route for ${context.url.pathname}.`);
}
