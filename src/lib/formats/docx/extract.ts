import "server-only";
import mammoth from "mammoth";
import { groupIntoSections, splitParagraphs } from "../sections";
import type { FormatExtractor } from "../types";
import { docxMeta } from "./meta";

export const docxExtractor: FormatExtractor = {
  meta: docxMeta,

  // .docx is a ZIP archive ("PK\x03\x04"); mammoth rejects ZIPs that aren't Word files.
  sniff: (bytes) => bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04,

  async extract(bytes) {
    const { value } = await mammoth.extractRawText({ buffer: Buffer.from(bytes) }).catch(() => {
      throw new Error("This file couldn't be read as a Word document. It may be damaged or password-protected.");
    });
    // Word has no fixed pages, so citations point at sections ("§ 3").
    return { parts: groupIntoSections(splitParagraphs(value)) };
  },
};
