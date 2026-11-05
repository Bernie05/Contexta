// A small Markdown reader for writing generated text into PDF and Word files.
// It covers what summaries use; anything else, such as a table, stays as plain text.

export interface TextRun {
  text: string;
  bold: boolean;
}

export interface Block {
  type: "heading" | "bullet" | "paragraph";
  runs: TextRun[];
}

/** Splits "plain **bold** plain" into runs and drops the other inline markers. */
function parseRuns(line: string): TextRun[] {
  const plain = line.replace(/(^|\s)[*_]([^*_\s][^*_]*)[*_](?=\s|[.,;:]|$)/g, "$1$2").replace(/`/g, "");
  return plain
    .split("**")
    .map((text, i) => ({ text, bold: i % 2 === 1 }))
    .filter((run) => run.text);
}

export function parseMarkdown(markdown: string): Block[] {
  const blocks: Block[] = [];
  for (const raw of markdown.split("\n")) {
    const line = raw.trim();
    if (!line || /^([-*_])\1{2,}$/.test(line)) continue;
    const heading = line.match(/^#{1,6}\s+(.+)/);
    const bullet = line.match(/^[-*•]\s+(.+)/);
    if (heading) blocks.push({ type: "heading", runs: [{ text: heading[1].replace(/[*_`]/g, ""), bold: true }] });
    else if (bullet) blocks.push({ type: "bullet", runs: parseRuns(bullet[1]) });
    else blocks.push({ type: "paragraph", runs: parseRuns(line) });
  }
  return blocks;
}
