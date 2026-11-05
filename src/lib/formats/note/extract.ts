import "server-only";
import { groupIntoSections, splitParagraphs } from "../sections";
import type { FormatExtractor } from "../types";
import { noteMeta } from "./meta";

const SNIFF_BYTES = 4096;

export const noteExtractor: FormatExtractor = {
  meta: noteMeta,

  // A note's title is its name, so only the text goes in the file.
  write: async ({ subtitle, markdown }) => new TextEncoder().encode(`_${subtitle}_\n\n${markdown}`),

  // Plain text: valid UTF-8 with no NUL bytes, so binaries renamed to .txt are rejected.
  sniff(bytes) {
    const head = bytes.subarray(0, SNIFF_BYTES);
    if (head.includes(0)) return false;
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(head, { stream: true });
      return true;
    } catch {
      return false;
    }
  },

  async extract(bytes) {
    const text = new TextDecoder().decode(bytes);
    // Each Markdown heading starts a new citable section.
    return { parts: groupIntoSections(splitParagraphs(text), { breakBefore: (p) => /^#{1,6}\s/.test(p) }) };
  },
};
