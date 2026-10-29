import "server-only";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import type { DocKind } from "./formats/types";
import type { Document, Folder } from "./types";

export type { DocStatus, Document, Folder } from "./types";

// Runtime data lives outside the build; tell Turbopack not to trace it.
export const DATA_DIR = path.resolve(/*turbopackIgnore: true*/ process.env.CONTEXTA_DATA_DIR ?? "./data");
export const FILES_DIR = path.join(DATA_DIR, "files");

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS folders (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  parent_id  TEXT REFERENCES folders(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS documents (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL DEFAULT 'pdf',
  folder_id   TEXT REFERENCES folders(id) ON DELETE CASCADE,
  size        INTEGER NOT NULL,
  page_count  INTEGER, -- number of citable parts: pages (PDF) or sections (Word)
  chunk_count INTEGER NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'queued',
  error       TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_documents_folder ON documents(folder_id);

CREATE TABLE IF NOT EXISTS chunks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  page        INTEGER NOT NULL,
  idx         INTEGER NOT NULL,
  text        TEXT NOT NULL,
  embedding   BLOB NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chunks_document ON chunks(document_id);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

/** Brings databases created by earlier versions up to the current schema. */
function migrate(conn: DatabaseSync) {
  const cols = conn.prepare("PRAGMA table_info(documents)").all() as { name: string }[];
  if (!cols.some((c) => c.name === "kind")) {
    conn.exec("ALTER TABLE documents ADD COLUMN kind TEXT NOT NULL DEFAULT 'pdf'");
  }
}

function applySchema(conn: DatabaseSync) {
  conn.exec(SCHEMA);
  migrate(conn);
}

// Reuse one connection across hot reloads in dev.
const globalForDb = globalThis as unknown as { contextaDb?: DatabaseSync };
// Module-scoped so a hot reload re-applies the (idempotent) schema to the reused connection.
let schemaApplied = false;

export function db(): DatabaseSync {
  if (!globalForDb.contextaDb) {
    fs.mkdirSync(FILES_DIR, { recursive: true });
    const conn = new DatabaseSync(path.join(DATA_DIR, "contexta.db"));
    applySchema(conn);
    schemaApplied = true;
    // Documents interrupted mid-index by a restart are re-queued by the indexer.
    conn.exec("UPDATE documents SET status = 'queued' WHERE status = 'processing'");
    globalForDb.contextaDb = conn;
  }
  if (!schemaApplied) {
    applySchema(globalForDb.contextaDb);
    schemaApplied = true;
  }
  return globalForDb.contextaDb;
}

/** "?,?,?" for a SQL IN (...) list of the given values. */
export function placeholders(values: readonly unknown[]): string {
  return values.map(() => "?").join(",");
}

/** Stored files are named <id>.<kind>, e.g. "3f2a….docx". */
export function filePath(documentId: string, kind: DocKind): string {
  return path.join(FILES_DIR, `${documentId}.${kind}`);
}

export function listFolders(): Folder[] {
  return db().prepare("SELECT * FROM folders ORDER BY name COLLATE NOCASE").all() as unknown as Folder[];
}

export function listDocuments(): Document[] {
  return db()
    .prepare(
      `SELECT id, name, kind, folder_id, size, page_count, chunk_count, status, error, created_at
       FROM documents ORDER BY created_at DESC`,
    )
    .all() as unknown as Document[];
}

export function getDocument(id: string): Document | undefined {
  return db().prepare("SELECT * FROM documents WHERE id = ?").get(id) as unknown as Document | undefined;
}

export function getFolder(id: string): Folder | undefined {
  return db().prepare("SELECT * FROM folders WHERE id = ?").get(id) as unknown as Folder | undefined;
}

/** All folder ids in the subtree rooted at `folderId` (inclusive). */
export function folderSubtree(folderId: string): string[] {
  const rows = db()
    .prepare(
      `WITH RECURSIVE tree(id) AS (
         SELECT id FROM folders WHERE id = ?
         UNION ALL
         SELECT f.id FROM folders f JOIN tree t ON f.parent_id = t.id
       ) SELECT id FROM tree`,
    )
    .all(folderId) as { id: string }[];
  return rows.map((r) => r.id);
}

/** Documents in the given folders, used before a delete so their files can be removed too. */
export function documentsInFolders(folderIds: string[]): { id: string; kind: DocKind }[] {
  if (folderIds.length === 0) return [];
  return db()
    .prepare(`SELECT id, kind FROM documents WHERE folder_id IN (${placeholders(folderIds)})`)
    .all(...folderIds) as unknown as { id: string; kind: DocKind }[];
}
