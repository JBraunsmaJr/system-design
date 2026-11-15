/**
 * The document catalog in PostgreSQL. The same contract as the in-memory
 * catalog in documentCatalog.ts; scripts/verify-workspaces-contract.ts runs
 * one suite against both.
 *
 * `workspace_documents.doc_id` references `documents`, so a row can only be
 * added for a document the document service has already created, and
 * purging a document removes its catalog row with it.
 */
import pg from 'pg';
import {
  CatalogError,
  byCreation,
  normalizeTitle,
  requireDocId,
  type CatalogEntry,
  type DocumentCatalog,
} from './documentCatalog.ts';

interface EntryRow {
  doc_id: string;
  workspace_id: string;
  title: string;
  created_by: string | null;
  created_at: Date;
}

const toEntry = (row: EntryRow): CatalogEntry => ({
  docId: row.doc_id,
  workspaceId: row.workspace_id,
  title: row.title,
  createdBy: row.created_by,
  createdAt: row.created_at.toISOString(),
});

const COLUMNS = 'doc_id, workspace_id, title, created_by, created_at';
const UNIQUE_VIOLATION = '23505';
const FOREIGN_KEY_VIOLATION = '23503';

const field = (error: unknown, name: 'code' | 'constraint'): string =>
  typeof error === 'object' && error !== null && name in error
    ? String((error as Record<string, unknown>)[name])
    : '';

export function createPostgresDocumentCatalog(
  pool: pg.Pool,
  options: { now?: () => Date } = {},
): DocumentCatalog {
  const now = options.now ?? (() => new Date());

  /** A foreign key on the workspace column is "no such workspace"; on the
   * document column it is a document the document service does not have. */
  function translate(error: unknown, context: { docId: string; workspaceId?: string }): never {
    const code = field(error, 'code');
    if (code === UNIQUE_VIOLATION) {
      throw new CatalogError(`There is already a document ${context.docId}.`, 'conflict');
    }
    if (code === FOREIGN_KEY_VIOLATION) {
      if (field(error, 'constraint').includes('workspace_id')) {
        throw new CatalogError(`No workspace ${context.workspaceId ?? ''}.`.trim(), 'not-found');
      }
      if (field(error, 'constraint').includes('doc_id')) {
        throw new CatalogError(`No document ${context.docId}.`, 'not-found');
      }
      throw new CatalogError('That user does not exist.', 'not-found');
    }
    throw error;
  }

  return {
    async add({ docId, workspaceId, title, createdBy }) {
      const id = requireDocId(docId);
      const normalized = normalizeTitle(title);
      try {
        const result = await pool.query<EntryRow>(
          `INSERT INTO workspace_documents (doc_id, workspace_id, title, created_by, created_at)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING ${COLUMNS}`,
          [id, workspaceId, normalized, createdBy, now()],
        );
        return toEntry(result.rows[0]);
      } catch (error) {
        return translate(error, { docId: id, workspaceId });
      }
    },

    async get(docId) {
      const result = await pool.query<EntryRow>(
        `SELECT ${COLUMNS} FROM workspace_documents WHERE doc_id = $1`,
        [docId],
      );
      return result.rowCount === 0 ? null : toEntry(result.rows[0]);
    },

    async listByWorkspace(workspaceId) {
      const result = await pool.query<EntryRow>(
        `SELECT ${COLUMNS} FROM workspace_documents WHERE workspace_id = $1`,
        [workspaceId],
      );
      return result.rows.map(toEntry).sort(byCreation);
    },

    async setTitle(docId, title) {
      const normalized = normalizeTitle(title);
      const result = await pool.query<EntryRow>(
        `UPDATE workspace_documents SET title = $2 WHERE doc_id = $1 RETURNING ${COLUMNS}`,
        [docId, normalized],
      );
      if (result.rowCount === 0) throw new CatalogError(`No document ${docId}.`, 'not-found');
      return toEntry(result.rows[0]);
    },

    async move(docId, workspaceId) {
      try {
        const result = await pool.query<EntryRow>(
          `UPDATE workspace_documents SET workspace_id = $2 WHERE doc_id = $1
           RETURNING ${COLUMNS}`,
          [docId, workspaceId],
        );
        if (result.rowCount === 0) throw new CatalogError(`No document ${docId}.`, 'not-found');
        return toEntry(result.rows[0]);
      } catch (error) {
        if (error instanceof CatalogError) throw error;
        return translate(error, { docId, workspaceId });
      }
    },

    async remove(docId) {
      const result = await pool.query(`DELETE FROM workspace_documents WHERE doc_id = $1`, [docId]);
      return (result.rowCount ?? 0) > 0;
    },
  };
}
