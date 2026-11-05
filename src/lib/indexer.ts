import "server-only";
import fs from "node:fs/promises";
import { filePath, getDocument, query, queryOne, transaction } from "./db";
import { chunkParts } from "./chunk";
import { embed, toVectorLiteral } from "./embeddings";
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
export async function resumeQueue() {
  const rows = await query<{ id: string }>("SELECT id FROM documents WHERE status = 'queued' ORDER BY created_at");
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

const exists = async (id: string) => Boolean(await queryOne("SELECT 1 FROM documents WHERE id = $1", [id]));
const setStatus = (id: string, status: string, error: string | null) =>
  query("UPDATE documents SET status = $1, error = $2 WHERE id = $3", [status, error, id]);

async function indexDocument(id: string) {
  const doc = await getDocument(id);
  if (!doc) return; // deleted while waiting in the queue

  await setStatus(id, "processing", null);
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
    if (!(await exists(id))) return; // deleted while it was being embedded

    await transaction(async (tx) => {
      await tx.query("DELETE FROM chunks WHERE document_id = $1", [id]);
      for (const [i, c] of chunks.entries()) {
        await tx.query("INSERT INTO chunks (document_id, chunk_index, page, content, embedding) VALUES ($1, $2, $3, $4, $5)", [
          id,
          c.idx,
          c.page,
          c.text,
          toVectorLiteral(vectors[i]),
        ]);
      }
      await tx.query("UPDATE documents SET status = 'ready', error = NULL, page_count = $1, chunk_count = $2 WHERE id = $3", [
        parts.length,
        chunks.length,
        id,
      ]);
    });
  } catch (err) {
    console.error(`[indexer] ${id} failed:`, err);
    if (await exists(id)) await setStatus(id, "error", errorMessage(err, String(err)));
  }
}
