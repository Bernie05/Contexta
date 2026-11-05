import "server-only";
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import { parseMarkdown, type Block } from "../markdown";
import type { WrittenDocument } from "../types";

function toParagraph(block: Block): Paragraph {
  const children = block.runs.map((run) => new TextRun({ text: run.text, bold: run.bold }));
  if (block.type === "heading") return new Paragraph({ heading: HeadingLevel.HEADING_1, children });
  if (block.type === "bullet") return new Paragraph({ bullet: { level: 0 }, children });
  return new Paragraph({ spacing: { after: 160 }, children });
}

export async function writeDocx({ title, subtitle, markdown }: WrittenDocument): Promise<Uint8Array> {
  const doc = new Document({
    title,
    sections: [
      {
        children: [
          new Paragraph({ heading: HeadingLevel.TITLE, text: title }),
          new Paragraph({ spacing: { after: 240 }, children: [new TextRun({ text: subtitle, italics: true })] }),
          ...parseMarkdown(markdown).map(toParagraph),
        ],
      },
    ],
  });
  return new Uint8Array(await Packer.toBuffer(doc));
}
