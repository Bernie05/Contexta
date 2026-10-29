export interface Chunk {
  page: number; // 1-based part number: a page (PDF) or section (Word)
  idx: number;
  text: string;
}

const CHUNK_CHARS = 1000;
const OVERLAP_CHARS = 200;
const MIN_CUT = CHUNK_CHARS / 2;

/**
 * Splits each extracted part into overlapping chunks. Chunks never cross a part,
 * so every chunk can cite the page or section it came from.
 */
export function chunkParts(parts: string[]): Chunk[] {
  const chunks: Chunk[] = [];
  let idx = 0;
  parts.forEach((raw, i) => {
    const text = raw.replace(/\s+/g, " ").trim();
    let start = 0;
    while (start < text.length) {
      let end = Math.min(start + CHUNK_CHARS, text.length);
      // Prefer to break at a sentence, then a word, in the second half of the window.
      if (end < text.length) {
        const window = text.slice(start + MIN_CUT, end);
        const sentence = window.lastIndexOf(". ");
        const cut = sentence >= 0 ? sentence + 1 : window.lastIndexOf(" ");
        if (cut >= 0) end = start + MIN_CUT + cut;
      }
      chunks.push({ page: i + 1, idx: idx++, text: text.slice(start, end).trim() });
      if (end >= text.length) break;
      start = Math.max(end - OVERLAP_CHARS, start + 1);
    }
  });
  return chunks;
}
