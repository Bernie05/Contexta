import "server-only";
import path from "node:path";
import PDFDocument from "pdfkit";
import { parseMarkdown, type TextRun } from "../markdown";
import type { WrittenDocument } from "../types";

// PDF's built-in fonts can't show characters such as ₱, so a font is embedded.
const fontFile = (name: string) => path.join(process.cwd(), "node_modules/dejavu-fonts-ttf/ttf", `${name}.ttf`);
const REGULAR = fontFile("DejaVuSans");
const BOLD = fontFile("DejaVuSans-Bold");
const ITALIC = fontFile("DejaVuSans-Oblique");

const MARGIN = 72;
const BODY_SIZE = 11;
const BULLET_INDENT = 14;
const LINE_GAP = 3;

// A few undrawable characters, such as emoji, are dropped. More than this means
// the text is in a language the font doesn't cover.
const MAX_MISSING_SHARE = 0.01;

/** The characters the embedded font can't draw, which would otherwise print as empty boxes. */
function missingCharacters(doc: PDFKit.PDFDocument, text: string): { characters: Set<string>; share: number } {
  doc.font(REGULAR);
  // pdfkit's types don't include the font it has loaded.
  const { font } = (doc as unknown as { _font: { font: { hasGlyphForCodePoint(codePoint: number): boolean } } })._font;
  const all = [...text.replace(/\s/g, "")];
  const missing = all.filter((c) => !font.hasGlyphForCodePoint(c.codePointAt(0)!));
  return { characters: new Set(missing), share: missing.length / Math.max(all.length, 1) };
}

function writeRuns(doc: PDFKit.PDFDocument, runs: TextRun[], x: number, width: number) {
  doc.x = x;
  runs.forEach((run, i) => {
    doc.font(run.bold ? BOLD : REGULAR).text(run.text, { width, lineGap: LINE_GAP, continued: i < runs.length - 1 });
  });
  doc.x = MARGIN;
}

/** Writes a PDF, or returns null when the font can't show the text. */
export async function writePdf(input: WrittenDocument): Promise<Uint8Array | null> {
  const doc = new PDFDocument({ size: "A4", margin: MARGIN, info: { Title: input.title } });
  const finished = new Promise<Uint8Array>((resolve, reject) => {
    const pages: Buffer[] = [];
    doc.on("data", (page: Buffer) => pages.push(page));
    doc.on("end", () => resolve(new Uint8Array(Buffer.concat(pages))));
    doc.on("error", reject);
  });

  const missing = missingCharacters(doc, `${input.title}${input.subtitle}${input.markdown}`);
  if (missing.share > MAX_MISSING_SHARE) {
    doc.end();
    await finished;
    return null;
  }
  const drawable = (text: string) => [...text].filter((c) => !missing.characters.has(c)).join("");
  const [title, subtitle, markdown] = [input.title, input.subtitle, input.markdown].map(drawable);

  const width = doc.page.width - MARGIN * 2;
  doc.font(BOLD).fontSize(20).text(title, { width });
  doc.moveDown(0.3).font(ITALIC).fontSize(10).fillColor("#666666").text(subtitle, { width });
  doc.fillColor("#000000").moveDown(1.2);

  for (const block of parseMarkdown(markdown)) {
    if (block.type === "heading") {
      doc.moveDown(0.6).fontSize(14);
      writeRuns(doc, block.runs, MARGIN, width);
      doc.moveDown(0.4);
    } else if (block.type === "bullet") {
      doc.fontSize(BODY_SIZE);
      // Start a new page first, so a bullet point can't be separated from its text.
      if (doc.y + doc.currentLineHeight(true) > doc.page.height - MARGIN) doc.addPage();
      const y = doc.y;
      doc.font(REGULAR).text("•", MARGIN, y, { lineBreak: false });
      doc.y = y;
      writeRuns(doc, block.runs, MARGIN + BULLET_INDENT, width - BULLET_INDENT);
      doc.moveDown(0.2);
    } else {
      doc.fontSize(BODY_SIZE);
      writeRuns(doc, block.runs, MARGIN, width);
      doc.moveDown(0.6);
    }
  }

  doc.end();
  return finished;
}
