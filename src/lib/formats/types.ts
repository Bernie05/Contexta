// Contract for a supported document format. To add a format, create
// formats/<kind>/meta.ts and formats/<kind>/extract.ts, then register both
// in catalog.ts (browser-safe metadata) and registry.ts (server extractor).

export type DocKind = "pdf" | "docx" | "note";

/** Browser-safe description of a format: what it accepts and how it cites locations. */
export interface FormatMeta {
  kind: DocKind;
  label: string; // e.g. "PDF", "Word"
  extensions: string[]; // lower-case, with the dot
  mimeTypes: string[];
  contentType: string; // served Content-Type
  /** What one extracted part is called in citations, e.g. "page" → "p. 3". */
  part: { singular: string; plural: string; short: string };
  /** Whether the browser can show the file itself (PDF viewer), or must download it. */
  previewInline: boolean;
  /** Whether the content can be edited in the app (notes). */
  editable?: boolean;
}

export interface ExtractedText {
  /** Text per citable part (a page for PDF, a section for Word), in order. */
  parts: string[];
}

export interface FormatExtractor {
  meta: FormatMeta;
  /** Checks the file's signature bytes, so a renamed file can't pose as this format. */
  sniff: (bytes: Uint8Array) => boolean;
  extract: (bytes: Uint8Array) => Promise<ExtractedText>;
}
