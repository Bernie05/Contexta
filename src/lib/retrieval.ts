import "server-only";
import { folderSubtree, query, queryOne } from "./db";
import { dot, embed, toVectorLiteral } from "./embeddings";
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

/** A chunk found by vector or keyword search. `score` is always its cosine similarity. */
interface Candidate {
  document_id: string;
  document_name: string;
  kind: DocKind;
  folder_id: string | null;
  page: number;
  content: string;
  score: number;
  keyword_rank: number | null; // 1 is the best keyword match, null means no keyword match
}

// Auto routing: how many documents may answer, and how close to the best one they must score.
const MAX_ROUTED_DOCS = 3;
const ROUTE_MARGIN = 0.12;
const MIN_DOC_SCORE = 0.2;
const NAME_BOOST = 0.15;
const FOLDER_BOOST = 0.05;
// Added to a document's score, divided by its best keyword rank, so exact terms can pick it.
const KEYWORD_BOOST = 0.15;
// Weight of the previous question when embedding a follow-up ("and the battery?").
const PREVIOUS_QUESTION_WEIGHT = 0.4;
// Per search. pgvector's HNSW index returns at most 40 rows unless hnsw.ef_search is raised.
const CANDIDATES = 40;
// Reciprocal rank fusion constant: the usual default, which keeps one list from dominating.
const RRF_K = 60;

/**
 * Finds the chunks that best answer `question` across the whole library: it first
 * predicts which documents are needed, then keeps only their chunks. `contextFolderId`
 * is the folder the user has open, used as a small hint.
 */
export async function retrieve(
  question: string,
  contextFolderId: string | null,
  previousQuestion?: string,
  k = 6,
): Promise<{ documents: RoutedDoc[]; sources: Source[] }> {
  // Checked first so an empty library never loads the embedding model.
  const hasChunks = await queryOne(
    "SELECT 1 FROM chunks c JOIN documents d ON d.id = c.document_id WHERE d.status = 'ready' LIMIT 1",
  );
  if (!hasChunks) return { documents: [], sources: [] };

  const candidates = await searchChunks(question, await queryVector(question, previousQuestion));
  if (candidates.length === 0) return { documents: [], sources: [] };

  const documents = await routeDocuments(candidates, question, contextFolderId);
  const picked = new Set(documents.map((d) => d.id));
  const sources = fuse(candidates)
    .filter((c) => picked.has(c.document_id))
    .slice(0, k)
    .map((c, i) => ({
      n: i + 1,
      documentId: c.document_id,
      documentName: c.document_name,
      documentKind: c.kind,
      page: c.page,
      text: c.content,
      score: c.score,
    }));

  return { documents, sources };
}

/**
 * Hybrid search: the nearest chunks by meaning plus the best keyword matches,
 * best cosine first. Question words are OR-ed because a chunk rarely holds them all.
 */
function searchChunks(question: string, vector: Float32Array): Promise<Candidate[]> {
  return query<Candidate & { [key: string]: unknown }>(
    `WITH semantic AS (
       SELECT id FROM chunks ORDER BY embedding <=> $1::vector LIMIT $3
     ),
     keyword AS (
       SELECT id, row_number() OVER (ORDER BY ts_rank_cd(fts, search.q) DESC, id)::int AS rank
       FROM chunks
       CROSS JOIN (SELECT replace(plainto_tsquery('english', $2)::text, '&', '|')::tsquery AS q) AS search
       WHERE fts @@ search.q
       ORDER BY rank LIMIT $3
     )
     SELECT c.document_id, d.name AS document_name, d.kind, d.folder_id, c.page, c.content,
            1 - (c.embedding <=> $1::vector) AS score, k.rank AS keyword_rank
     FROM chunks c
     JOIN documents d ON d.id = c.document_id
     LEFT JOIN keyword k ON k.id = c.id
     WHERE d.status = 'ready' AND (k.id IS NOT NULL OR c.id IN (SELECT id FROM semantic))
     ORDER BY score DESC`,
    [toVectorLiteral(vector), question, CANDIDATES],
  );
}

/** Orders candidates by reciprocal rank fusion of their vector and keyword ranks. */
function fuse(candidates: Candidate[]): Candidate[] {
  const fused = candidates.map((c, i) => ({
    c,
    rank: 1 / (RRF_K + i + 1) + (c.keyword_rank ? 1 / (RRF_K + c.keyword_rank) : 0),
  }));
  return fused.sort((a, b) => b.rank - a.rank).map(({ c }) => c);
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
 * best matching chunks, with small boosts when its text has the question's words,
 * the question names the file, or the file sits in the folder the user has open.
 */
async function routeDocuments(
  candidates: Candidate[],
  question: string,
  contextFolderId: string | null,
): Promise<RoutedDoc[]> {
  // Track the two best chunk scores per document; no need to keep or sort them all.
  const byDoc = new Map<
    string,
    { name: string; folderId: string | null; top1: number; top2: number; keywordRank: number | null }
  >();
  for (const { document_id, document_name, folder_id, score, keyword_rank } of candidates) {
    const d = byDoc.get(document_id);
    if (!d) {
      byDoc.set(document_id, { name: document_name, folderId: folder_id, top1: score, top2: -Infinity, keywordRank: keyword_rank });
      continue;
    }
    if (score > d.top1) [d.top2, d.top1] = [d.top1, score];
    else if (score > d.top2) d.top2 = score;
    if (keyword_rank && (!d.keywordRank || keyword_rank < d.keywordRank)) d.keywordRank = keyword_rank;
  }

  const contextFolders = new Set(contextFolderId ? await folderSubtree(contextFolderId) : []);
  const words = tokenize(question);

  const ranked = [...byDoc.entries()].map(([id, d]) => {
    const top2 = d.top2 === -Infinity ? d.top1 : d.top2;
    let score = 0.7 * d.top1 + 0.3 * top2;
    const reasons: RoutedDoc["reasons"] = ["content"];

    if (d.keywordRank) {
      score += KEYWORD_BOOST / d.keywordRank;
      reasons.push("keyword");
    }
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
