import "server-only";
import { db, folderSubtree, placeholders } from "./db";
import { dot, embed, fromBlob } from "./embeddings";
import { stripExtension, type DocKind } from "./formats/catalog";
import type { RoutedDoc } from "./types";

export interface Source {
  n: number;
  documentId: string;
  documentName: string;
  documentKind: DocKind;
  page: number;
  text: string;
  score: number;
}

/** Light per-chunk row: no text, no vector. */
interface ChunkMeta {
  id: number;
  document_id: string;
  document_name: string;
  kind: DocKind;
  folder_id: string | null;
}

// Auto routing: how many documents may answer, and how close to the best one they must score.
const MAX_ROUTED_DOCS = 3;
const ROUTE_MARGIN = 0.12;
const MIN_DOC_SCORE = 0.2;
const NAME_BOOST = 0.15;
const FOLDER_BOOST = 0.05;
// Weight of the previous question when embedding a follow-up ("and the battery?").
const PREVIOUS_QUESTION_WEIGHT = 0.4;
const SQL_BATCH = 500;

// Decoded vectors by chunk id, kept across questions. Chunk ids are never reused
// (AUTOINCREMENT), so a cached vector can't go stale; deleted chunks are pruned.
const globalForCache = globalThis as unknown as { contextaVectors?: Map<number, Float32Array> };
const vectors = (globalForCache.contextaVectors ??= new Map());

/**
 * Finds the chunks that best answer `question` across the whole library: it first
 * predicts which documents are needed, then searches only those. `contextFolderId`
 * is the folder the user has open, used as a small hint. Brute-force cosine search
 * over cached vectors, which is fine for a personal library.
 */
export async function retrieve(
  question: string,
  contextFolderId: string | null,
  previousQuestion?: string,
  k = 6,
): Promise<{ documents: RoutedDoc[]; sources: Source[] }> {
  const rows = db()
    .prepare(
      `SELECT c.id, c.document_id, d.name AS document_name, d.kind, d.folder_id
       FROM chunks c JOIN documents d ON d.id = c.document_id
       WHERE d.status = 'ready'`,
    )
    .all() as unknown as ChunkMeta[];
  if (rows.length === 0) return { documents: [], sources: [] };

  syncVectors(rows);
  const q = await queryVector(question, previousQuestion);
  const scored = rows.map((row) => ({ row, score: dot(q, vectors.get(row.id)!) }));

  const documents = routeDocuments(scored, question, contextFolderId);
  const picked = new Set(documents.map((d) => d.id));
  const top = scored
    .filter((s) => picked.has(s.row.document_id))
    .sort((a, b) => b.score - a.score)
    .slice(0, k);

  // Only the winning chunks need their text.
  const details = new Map(
    (db()
      .prepare(`SELECT id, page, text FROM chunks WHERE id IN (${placeholders(top)})`)
      .all(...top.map((t) => t.row.id)) as { id: number; page: number; text: string }[]).map((r) => [r.id, r]),
  );

  const sources = top.map(({ row, score }, i) => ({
    n: i + 1,
    documentId: row.document_id,
    documentName: row.document_name,
    documentKind: row.kind,
    page: details.get(row.id)!.page,
    text: details.get(row.id)!.text,
    score,
  }));

  return { documents, sources };
}

/** Loads vectors for chunks not yet cached and drops ones whose chunks are gone. */
function syncVectors(rows: ChunkMeta[]) {
  const missing = rows.filter((r) => !vectors.has(r.id)).map((r) => r.id);
  for (let i = 0; i < missing.length; i += SQL_BATCH) {
    const batch = missing.slice(i, i + SQL_BATCH);
    const loaded = db()
      .prepare(`SELECT id, embedding FROM chunks WHERE id IN (${placeholders(batch)})`)
      .all(...batch) as { id: number; embedding: Uint8Array }[];
    for (const r of loaded) vectors.set(r.id, fromBlob(r.embedding));
  }
  if (vectors.size > rows.length) {
    const live = new Set(rows.map((r) => r.id));
    for (const id of vectors.keys()) if (!live.has(id)) vectors.delete(id);
  }
}

async function queryVector(question: string, previousQuestion?: string): Promise<Float32Array> {
  if (!previousQuestion) return (await embed([question]))[0];
  const [cur, prev] = await embed([question, previousQuestion]);
  const mixed = cur.map((v, i) => v + PREVIOUS_QUESTION_WEIGHT * prev[i]);
  const norm = Math.sqrt(dot(mixed, mixed)) || 1;
  return mixed.map((v) => v / norm);
}

/**
 * Predicts which documents the question needs: each document is scored by its
 * best matching chunks, with small boosts when the question names the file or
 * the file sits in the folder the user has open.
 */
function routeDocuments(
  scored: { row: ChunkMeta; score: number }[],
  question: string,
  contextFolderId: string | null,
): RoutedDoc[] {
  // Track the two best chunk scores per document; no need to keep or sort them all.
  const byDoc = new Map<string, { name: string; folderId: string | null; top1: number; top2: number }>();
  for (const { row, score } of scored) {
    const d = byDoc.get(row.document_id);
    if (!d) byDoc.set(row.document_id, { name: row.document_name, folderId: row.folder_id, top1: score, top2: -Infinity });
    else if (score > d.top1) [d.top2, d.top1] = [d.top1, score];
    else if (score > d.top2) d.top2 = score;
  }

  const contextFolders = new Set(contextFolderId ? folderSubtree(contextFolderId) : []);
  const words = tokenize(question);

  const ranked = [...byDoc.entries()].map(([id, d]) => {
    const top2 = d.top2 === -Infinity ? d.top1 : d.top2;
    let score = 0.7 * d.top1 + 0.3 * top2;
    const reasons: RoutedDoc["reasons"] = ["content"];

    const nameWords = new Set(tokenize(stripExtension(d.name)));
    const hits = words.filter((w) => nameWords.has(w)).length;
    if (hits > 0) {
      score += NAME_BOOST * Math.min(1, hits / Math.max(1, nameWords.size));
      reasons.push("name");
    }
    if (d.folderId && contextFolders.has(d.folderId)) {
      score += FOLDER_BOOST;
      reasons.push("folder");
    }
    return { id, name: d.name, score, reasons };
  });

  ranked.sort((a, b) => b.score - a.score);
  const best = ranked[0].score;
  return ranked
    .filter((d, i) => i === 0 || (d.score >= best - ROUTE_MARGIN && d.score >= MIN_DOC_SCORE))
    .slice(0, MAX_ROUTED_DOCS);
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 3);
}
