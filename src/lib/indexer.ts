import "server-only";
import fs from "node:fs/promises";
import { db, filePath, getDocument } from "./db";
import { chunkParts } from "./chunk";
import { embed, toBlob } from "./embeddings";
import { extractorFor } from "./formats/registry";
import { errorMessage } from "./utils";

// A single in-process queue: documents are indexed one at a time in the background
// so uploads return immediately and the embedding model is never loaded twice.
const globalForQueue = globalThis as unknown as { contextaQueue?: { pending: string[]; running: boolean } };
const queue = (globalForQueue.contextaQueue ??= { pending: [], running: false });

export function enqueue(documentId: string) {
  if (!queue.pending.includes(documentId)) queue.pending.push(documentId);
  void drain();
}

/** Re-queues documents left unindexed by a previous run. Called once at server start. */
export function resumeQueue() {
  const rows = db().prepare("SELECT id FROM documents WHERE status = 'queued' ORDER BY created_at").all() as { id: string }[];
  rows.forEach((r) => enqueue(r.id));
}

async function drain() {
  if (queue.running) return;
  queue.running = true;
  try {
    let id: string | undefined;
    while ((id = queue.pending.shift())) await indexDocument(id);
  } finally {
    queue.running = false;
  }
}

const exists = (id: string) => Boolean(db().prepare("SELECT 1 FROM documents WHERE id = ?").get(id));

async function indexDocument(id: string) {
  const conn = db();
  const doc = getDocument(id);
  if (!doc) return; // deleted while waiting in the queue

  const setStatus = conn.prepare("UPDATE documents SET status = ?, error = ? WHERE id = ?");
  setStatus.run("processing", null, id);
  try {
    const extractor = extractorFor(doc.kind);
    const bytes = new Uint8Array(await fs.readFile(filePath(id, doc.kind)));
    const { parts } = await extractor.extract(bytes);

    const chunks = chunkParts(parts);
    // An empty note is a draft, not a failure: it's simply ready with nothing to search.
    if (chunks.length === 0 && !extractor.meta.editable) {
      throw new Error(
        doc.kind === "pdf"
          ? "No extractable text found. Scanned PDFs need OCR, which isn't supported yet."
          : `No text found in this ${extractor.meta.label} file.`,
      );
    }

    const vectors = chunks.length ? await embed(chunks.map((c) => c.text)) : [];
    if (!exists(id)) return; // deleted while it was being embedded

    const insert = conn.prepare("INSERT INTO chunks (document_id, page, idx, text, embedding) VALUES (?, ?, ?, ?, ?)");
    conn.exec("BEGIN");
    try {
      conn.prepare("DELETE FROM chunks WHERE document_id = ?").run(id);
      chunks.forEach((c, i) => insert.run(id, c.page, c.idx, c.text, toBlob(vectors[i])));
      conn
        .prepare("UPDATE documents SET status = 'ready', error = NULL, page_count = ?, chunk_count = ? WHERE id = ?")
        .run(parts.length, chunks.length, id);
      conn.exec("COMMIT");
    } catch (err) {
      conn.exec("ROLLBACK");
      throw err;
    }
  } catch (err) {
    console.error(`[indexer] ${id} failed:`, err);
    if (exists(id)) setStatus.run("error", errorMessage(err, String(err)), id);
  }
}
