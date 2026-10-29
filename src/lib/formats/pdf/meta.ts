import type { FormatMeta } from "../types";

export const pdfMeta: FormatMeta = {
  kind: "pdf",
  label: "PDF",
  extensions: [".pdf"],
  mimeTypes: ["application/pdf"],
  contentType: "application/pdf",
  part: { singular: "page", plural: "pages", short: "p." },
  previewInline: true,
};
