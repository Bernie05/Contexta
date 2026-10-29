import type { FormatMeta } from "../types";

export const docxMeta: FormatMeta = {
  kind: "docx",
  label: "Word",
  extensions: [".docx"],
  mimeTypes: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  // Word files have no fixed pages, so text is cited by section.
  part: { singular: "section", plural: "sections", short: "§" },
  previewInline: false,
};
