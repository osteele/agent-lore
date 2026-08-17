/**
 * Extract wikilink targets from markdown content.
 * Syntax: [[path/to/topic]] — resolves relative to repo root with .md implied.
 * Returns deduplicated targets in the order first seen.
 */
export function extractWikilinks(content: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const target of iterWikilinks(content)) {
    if (!seen.has(target)) {
      seen.add(target);
      result.push(target);
    }
  }
  return result;
}

export function* iterWikilinks(content: string): Generator<string> {
  const re = /\[\[([^\]\n]+?)\]\]/g;
  for (const match of content.matchAll(re)) {
    const raw = match[1].trim();
    // Wikilinks may contain a display alias after a pipe: [[target|display]]
    const target = raw.split("|", 2)[0].trim();
    if (target === "") continue;
    yield target;
  }
}
