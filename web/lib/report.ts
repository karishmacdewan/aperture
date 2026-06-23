// Extracts a single section from the engine's Markdown report so the
// dashboard can show the recommendation without reimplementing the
// recommendation logic that already lives in reporting/report_builder.py.
export function extractMarkdownSection(markdown: string, heading: string): string | null {
  const lines = markdown.split("\n");
  const startIndex = lines.findIndex((line) => line.trim() === heading);
  if (startIndex === -1) return null;

  const sectionLines: string[] = [];
  for (let i = startIndex + 1; i < lines.length; i++) {
    if (lines[i].startsWith("## ")) break;
    sectionLines.push(lines[i]);
  }
  return sectionLines.join("\n").trim();
}
