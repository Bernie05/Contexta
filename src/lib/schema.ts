// No imports: scripts/copy-to-postgres.mjs runs this file outside Next.js.

/** Must match the embedding model (all-MiniLM-L6-v2 is 384). Changing it means recreating `chunks` and re-indexing. */
export const EMBEDDING_DIMENSIONS = 384;

export const SCHEMA = `
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS folders (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  parent_id  TEXT REFERENCES folders(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
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
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_documents_folder ON documents(folder_id);

CREATE TABLE IF NOT EXISTS chunks (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  document_id    TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  chunk_index    INTEGER NOT NULL,
  page           INTEGER NOT NULL, -- a real column because every citation needs it
  content        TEXT NOT NULL,
  chunk_metadata JSONB NOT NULL DEFAULT '{}', -- extras such as headers; the file name comes from documents
  embedding      vector(${EMBEDDING_DIMENSIONS}) NOT NULL,
  fts            TSVECTOR GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,
  UNIQUE (document_id, chunk_index)
);
CREATE INDEX IF NOT EXISTS idx_chunks_embedding ON chunks USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_chunks_fts ON chunks USING gin (fts);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;
