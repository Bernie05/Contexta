import type { FormatMeta } from "../types";

export const MAX_NOTE_CHARS = 500_000;

/** Notes written in the app (Markdown). Uploaded .md and .txt files become editable notes too. */
export const noteMeta: FormatMeta = {
  kind: "note",
  label: "Note",
  extensions: [".md", ".txt"],
  mimeTypes: ["text/markdown", "text/plain"],
  contentType: "text/markdown; charset=utf-8",
  part: { singular: "section", plural: "sections", short: "§" },
  previewInline: false, // opened in the note editor instead
  editable: true,
};
