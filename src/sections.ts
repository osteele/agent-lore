export interface Section {
  heading: string;
  level: number;
  slug: string;
  /** 1-based line of the heading itself. */
  startLine: number;
  /** 1-based inclusive last line of the section, including subsections. */
  endLine: number;
}

/**
 * Parse markdown headings into sections. A section runs until the next
 * heading of the same or shallower level, so a section includes its
 * subsections. Headings inside fenced code blocks are ignored — lore pages
 * quote shell and config snippets whose comments start with `#`.
 */
export function parseSections(content: string): Section[] {
  const lines = content.split("\n");
  const found: Section[] = [];
  let inFence = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s{0,3}(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const match = /^(#{1,6})\s+(.*\S)\s*$/.exec(line);
    if (!match) continue;
    found.push({
      heading: match[2],
      level: match[1].length,
      slug: slugify(match[2]),
      startLine: i + 1,
      endLine: lines.length,
    });
  }

  for (let i = 0; i < found.length; i++) {
    for (let j = i + 1; j < found.length; j++) {
      if (found[j].level <= found[i].level) {
        found[i].endLine = found[j].startLine - 1;
        break;
      }
    }
  }

  return found;
}

export function slugify(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Resolve an agent-supplied section reference against a page's headings.
 * Deliberately forgiving — agents guess at headings — trying exact slug,
 * exact heading, then prefix, then substring.
 */
export function findSection(
  sections: Section[],
  query: string,
): Section | undefined {
  const raw = query.trim().replace(/^#+\s*/, "");
  const lower = raw.toLowerCase();
  const slug = slugify(raw);
  if (lower === "") return undefined;

  return (
    sections.find((s) => s.slug === slug) ??
    sections.find((s) => s.heading.toLowerCase() === lower) ??
    sections.find((s) => s.slug.startsWith(slug)) ??
    sections.find((s) => s.heading.toLowerCase().startsWith(lower)) ??
    sections.find((s) => s.heading.toLowerCase().includes(lower))
  );
}

/** The innermost section containing a 1-based line, if any. */
export function headingForLine(
  sections: Section[],
  line: number,
): string | undefined {
  let best: Section | undefined;
  for (const section of sections) {
    if (line < section.startLine || line > section.endLine) continue;
    if (best === undefined || section.level >= best.level) best = section;
  }
  return best?.heading;
}

/** A table of contents with line ranges, indented by heading level. */
export function renderToc(sections: Section[]): string {
  return sections
    .map((s) => {
      const indent = "  ".repeat(Math.max(0, s.level - 1));
      return `${indent}${"#".repeat(s.level)} ${s.heading} (lines ${s.startLine}-${s.endLine})`;
    })
    .join("\n");
}

/** Render lines [from, to] with their original 1-based line numbers. */
export function numberLines(lines: string[], from: number, to: number): string {
  const out: string[] = [];
  for (let i = from; i <= to && i <= lines.length; i++) {
    out.push(`${i}\t${lines[i - 1]}`);
  }
  return out.join("\n");
}
