import "server-only";
import { extensionOf, formatForFileName, SUPPORTED_LABEL } from "./catalog";
import { docxExtractor } from "./docx/extract";
import { noteExtractor } from "./note/extract";
import { pdfExtractor } from "./pdf/extract";
import type { DocKind, FormatExtractor } from "./types";

const EXTRACTORS: Record<DocKind, FormatExtractor> = {
  pdf: pdfExtractor,
  docx: docxExtractor,
  note: noteExtractor,
};

export function extractorFor(kind: DocKind): FormatExtractor {
  return EXTRACTORS[kind];
}

/**
 * Identifies an upload by its extension, then confirms it by its signature bytes.
 * Returns the extractor, or a user-facing reason it was rejected.
 */
export function detectFormat(fileName: string, bytes: Uint8Array): FormatExtractor | { reason: string } {
  const meta = formatForFileName(fileName);
  if (!meta) {
    if (extensionOf(fileName) === ".doc") return { reason: "Old .doc files aren't supported. Save it as .docx in Word." };
    return { reason: `Unsupported file type. Upload ${SUPPORTED_LABEL}.` };
  }
  const extractor = EXTRACTORS[meta.kind];
  if (!extractor.sniff(bytes)) return { reason: `This isn't a valid ${meta.label} file.` };
  return extractor;
}
