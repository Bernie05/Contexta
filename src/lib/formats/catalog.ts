// Browser-safe list of supported formats: upload picker, labels, citations.
import { docxMeta } from "./docx/meta";
import { noteMeta } from "./note/meta";
import { pdfMeta } from "./pdf/meta";
import type { DocKind, FormatMeta } from "./types";
import { plural } from "../utils/text";

export type { DocKind, FormatMeta } from "./types";

export const FORMATS: FormatMeta[] = [pdfMeta, docxMeta, noteMeta];

const byKind = new Map(FORMATS.map((f) => [f.kind, f]));

export function formatOf(kind: DocKind): FormatMeta {
  return byKind.get(kind) ?? pdfMeta;
}

/** Value for <input type="file" accept>. */
export const ACCEPT = FORMATS.flatMap((f) => [...f.extensions, ...f.mimeTypes]).join(",");

/** e.g. "PDF, Word or Note (.pdf, .docx, .md, .txt)" */
export const SUPPORTED_LABEL = `${FORMATS.map((f) => f.label).join(", ").replace(/, ([^,]*)$/, " or $1")} (${FORMATS.flatMap((f) => f.extensions).join(", ")})`;

export function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot >= 0 ? fileName.slice(dot).toLowerCase() : "";
}

export function formatForFileName(fileName: string): FormatMeta | undefined {
  const ext = extensionOf(fileName);
  return FORMATS.find((f) => f.extensions.includes(ext));
}

export function stripExtension(fileName: string): string {
  return formatForFileName(fileName) ? fileName.slice(0, fileName.lastIndexOf(".")) : fileName;
}

/** "p. 3" for a PDF, "§ 3" for Word. */
export function partLabel(kind: DocKind, n: number): string {
  return `${formatOf(kind).part.short} ${n}`;
}

/** "12 pages" / "1 section". */
export function partCount(kind: DocKind, n: number): string {
  const { part } = formatOf(kind);
  return plural(n, part.singular, part.plural);
}
