// Shared by formats without fixed pages (Word, notes): group paragraphs into
// citable sections of roughly `maxChars`, optionally starting a new section
// at certain paragraphs (e.g. Markdown headings).

export function splitParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

export function groupIntoSections(
  paragraphs: string[],
  { maxChars = 3000, breakBefore }: { maxChars?: number; breakBefore?: (paragraph: string) => boolean } = {},
): string[] {
  const sections: string[] = [];
  let current = "";
  for (const p of paragraphs) {
    if (current && (current.length + p.length > maxChars || breakBefore?.(p))) {
      sections.push(current);
      current = "";
    }
    current = current ? `${current}\n\n${p}` : p;
  }
  if (current) sections.push(current);
  return sections;
}
