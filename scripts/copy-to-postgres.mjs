// Copies the local PGlite database to the Postgres server in DATABASE_URL.
// Stop the app first, then run: npm run db:copy
// Needs Node 22.18+ to load schema.ts. Uploaded files stay in data/files.
import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { SCHEMA } from "../src/lib/schema.ts";
import { dataDir, openPglite } from "./open-pglite.mjs";

const target = process.env.DATABASE_URL;
if (!target) throw new Error("Set DATABASE_URL to the Postgres server to copy to.");

const source = await openPglite();
const client = new pg.Client({ connectionString: target });
await client.connect();

const rowsOf = async (sql) => (await source.query(sql)).rows;
const insert = async (table, columns, rows, cast = {}) => {
  const values = columns.map((c, i) => `$${i + 1}${cast[c] ?? ""}`).join(", ");
  const sql = `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${values})`;
  for (const row of rows) await client.query(sql, columns.map((c) => row[c]));
};

try {
  await client.query(SCHEMA);
  const { rows } = await client.query("SELECT (SELECT count(*) FROM documents) + (SELECT count(*) FROM folders) AS n");
  if (Number(rows[0].n) > 0) throw new Error("The target database already has data, so nothing was copied.");

  await client.query("BEGIN");
  const folders = await rowsOf(`
    WITH RECURSIVE tree AS (
      SELECT *, 0 AS depth FROM folders WHERE parent_id IS NULL
      UNION ALL
      SELECT f.*, t.depth + 1 FROM folders f JOIN tree t ON f.parent_id = t.id
    ) SELECT * FROM tree ORDER BY depth`);
  await insert("folders", ["id", "name", "parent_id", "created_at"], folders); // parents first

  const documents = await rowsOf("SELECT * FROM documents");
  await insert(
    "documents",
    ["id", "name", "kind", "folder_id", "size", "page_count", "chunk_count", "status", "error", "created_at"],
    documents,
  );

  const chunks = await rowsOf(`
    SELECT document_id, chunk_index, page, content, chunk_metadata::text AS chunk_metadata, embedding::text AS embedding
    FROM chunks`);
  await insert("chunks", ["document_id", "chunk_index", "page", "content", "chunk_metadata", "embedding"], chunks, {
    chunk_metadata: "::jsonb",
    embedding: "::vector",
  });

  await insert("settings", ["key", "value"], await rowsOf("SELECT * FROM settings"));
  await client.query("COMMIT");
  console.log(`Copied ${folders.length} folders, ${documents.length} documents and ${chunks.length} chunks.`);
} catch (err) {
  await client.query("ROLLBACK").catch(() => {});
  throw err;
} finally {
  await client.end();
  await source.close();
}

if (!fs.existsSync(path.join(dataDir, "files"))) console.warn("No data/files folder found. Uploaded files must be moved separately.");
