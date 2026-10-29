import "server-only";
import { extractText, getDocumentProxy } from "unpdf";
import type { FormatExtractor } from "../types";
import { pdfMeta } from "./meta";

export const pdfExtractor: FormatExtractor = {
  meta: pdfMeta,

  sniff: (bytes) => String.fromCharCode(...bytes.subarray(0, 5)) === "%PDF-",

  async extract(bytes) {
    const pdf = await getDocumentProxy(bytes);
    try {
      const { text } = await extractText(pdf, { mergePages: false });
      return { parts: text };
    } finally {
      await pdf.loadingTask.destroy(); // free the parsed document right away
    }
  },
};
