import "server-only";
import fs from "node:fs";
import path from "node:path";
import { Pool, types, type PoolConfig, type QueryResultRow } from "pg";
import type { DocKind } from "./formats/types";
import { SCHEMA } from "./schema";
import type { Document, Folder } from "./types";

export type { DocStatus, Document, Folder } from "./types";

// Runtime data lives outside the build; tell Turbopack not to trace it.
export const DATA_DIR = path.resolve(/*turbopackIgnore: true*/ process.env.CONTEXTA_DATA_DIR ?? "./data");
export const FILES_DIR = path.join(DATA_DIR, "files");
const PGLITE_DIR = path.join(DATA_DIR, "pg");

// Timestamps stay ISO strings, matching Document and Folder.
types.setTypeParser(types.builtins.TIMESTAMPTZ, (value) => new Date(value).toISOString());

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** PGlite lets a second process open its folder, and two writers would corrupt it. */
function claimPgliteDir() {
  const lock = path.join(DATA_DIR, "pg.lock");
  const owner = fs.existsSync(lock) ? Number(fs.readFileSync(lock, "utf8")) : 0;
  if (owner && owner !== process.pid && isRunning(owner)) {
    throw new Error(`The local database is in use by process ${owner}. Stop that app first, or delete ${lock} if it isn't Contexta.`);
  }
  fs.writeFileSync(lock, String(process.pid));
}

/** DATABASE_URL picks a Postgres server; without it the app runs Postgres in-process with PGlite. */
async function poolConfig(): Promise<PoolConfig> {
  if (process.env.DATABASE_URL) return { connectionString: process.env.DATABASE_URL };

  claimPgliteDir();
  const [{ PGlite }, { createPgConfig }, { vector }] = await Promise.all([
    import("@electric-sql/pglite"),
    import("@electric-sql/pglite/node-postgres"),
    import("@electric-sql/pglite-pgvector"),
  ]);
  const lite = await PGlite.create(PGLITE_DIR, { extensions: { vector } });
  return createPgConfig(lite) as PoolConfig;
}

async function connect(): Promise<Pool> {
  fs.mkdirSync(FILES_DIR, { recursive: true });
  const pool = new Pool(await poolConfig());
  pool.on("error", (err) => console.error("[db] idle connection failed:", err));
  await pool.query(SCHEMA);
  // Documents interrupted mid-index by a restart are re-queued by the indexer.
  await pool.query("UPDATE documents SET status = 'queued' WHERE status = 'processing'");
  return pool;
}

// Reuse one connection across hot reloads in dev. A failed connect isn't kept, so the next call retries.
const globalForDb = globalThis as unknown as { contextaDb?: Promise<Pool> };

function pool(): Promise<Pool> {
  globalForDb.contextaDb ??= connect().catch((err) => {
    globalForDb.contextaDb = undefined;
    throw err;
  });
  return globalForDb.contextaDb;
}

export async function query<T extends QueryResultRow>(sql: string, params?: unknown[]): Promise<T[]> {
  return (await (await pool()).query<T>(sql, params)).rows;
}

export async function queryOne<T extends QueryResultRow>(sql: string, params?: unknown[]): Promise<T | undefined> {
  return (await query<T>(sql, params))[0];
}

export interface Transaction {
  query: (sql: string, params?: unknown[]) => Promise<unknown>;
}

/**
 * Runs `work` atomically. Use `tx` for every query inside it: PGlite has a single
 * connection, so a plain query() would wait forever for this transaction to end.
 */
export async function transaction(work: (tx: Transaction) => Promise<void>): Promise<void> {
  const client = await (await pool()).connect();
  try {
    await client.query("BEGIN");
    await work({ query: (sql, params) => client.query(sql, params) });
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/** Stored files are named <id>.<kind>, e.g. "3f2a….docx". */
export function filePath(documentId: string, kind: DocKind): string {
  return path.join(FILES_DIR, `${documentId}.${kind}`);
}

export function listFolders(): Promise<Folder[]> {
  return query<Folder & QueryResultRow>("SELECT * FROM folders ORDER BY lower(name)");
}

export function listDocuments(): Promise<Document[]> {
  return query<Document & QueryResultRow>(
    `SELECT id, name, kind, folder_id, size, page_count, chunk_count, status, error, created_at
     FROM documents ORDER BY created_at DESC`,
  );
}

export function getDocument(id: string): Promise<Document | undefined> {
  return queryOne<Document & QueryResultRow>("SELECT * FROM documents WHERE id = $1", [id]);
}

export function getFolder(id: string): Promise<Folder | undefined> {
  return queryOne<Folder & QueryResultRow>("SELECT * FROM folders WHERE id = $1", [id]);
}

/** All folder ids in the subtree rooted at `folderId` (inclusive). */
export async function folderSubtree(folderId: string): Promise<string[]> {
  const rows = await query<{ id: string }>(
    `WITH RECURSIVE tree(id) AS (
       SELECT id FROM folders WHERE id = $1
       UNION ALL
       SELECT f.id FROM folders f JOIN tree t ON f.parent_id = t.id
     ) SELECT id FROM tree`,
    [folderId],
  );
  return rows.map((r) => r.id);
}

/** Documents in the given folders, used before a delete so their files can be removed too. */
export function documentsInFolders(folderIds: string[]): Promise<{ id: string; kind: DocKind }[]> {
  return query<{ id: string; kind: DocKind }>("SELECT id, kind FROM documents WHERE folder_id = ANY($1)", [folderIds]);
}
