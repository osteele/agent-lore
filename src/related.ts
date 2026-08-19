const STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "of",
  "for",
  "to",
  "in",
  "on",
  "with",
]);

export interface RelatedFinding {
  kind: "namespace-prefix" | "directory-shadows-page" | "similar-topic";
  message: string; // one line, ready to show an agent
  paths: string[]; // existing pages the finding points at
}

function firstSegment(p: string): string {
  return p.split("/")[0].toLowerCase();
}

function stem(basename: string): string {
  return basename.replace(/\.md$/i, "").toLowerCase();
}

function tokenize(text: string): string[] {
  // Whitespace splits too: a title is words, and leaving "entity graph" as one
  // token would make it match nothing, since page tokens come from paths.
  return text
    .toLowerCase()
    .split(/[\/\-_\s]+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

function levenshtein(a: string, b: string): number {
  if (a.length < b.length) return levenshtein(b, a);
  if (b.length === 0) return a.length;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 0; i < a.length; i++) {
    const curr = [i + 1];
    for (let j = 0; j < b.length; j++) {
      curr.push(
        Math.min(
          curr[curr.length - 1] + 1,
          prev[j + 1] + 1,
          prev[j] + (a[i] === b[j] ? 0 : 1),
        ),
      );
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }
  return prev[b.length];
}

function commonPrefixLength(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

function resemblesNamespace(a: string, b: string): boolean {
  const la = a.toLowerCase();
  const lb = b.toLowerCase();
  if (la === lb) return false;
  if (la.startsWith(lb) || lb.startsWith(la)) return true;
  if (`${la}s` === lb || `${lb}s` === la) return true;
  // The Levenshtein threshold is 3 (with a shared root of at least 3 chars)
  // so that `tools` matches `tooling`, the real case that motivated the
  // feature (distance 3). The shared-root guard prevents unrelated short
  // words such as `notes` from matching `tools`.
  if (commonPrefixLength(la, lb) < 3) return false;
  return levenshtein(la, lb) <= 3;
}

function dirPages(existingPaths: string[], dir: string): string[] {
  const d = dir.toLowerCase();
  return existingPaths.filter((p) => firstSegment(p) === d).sort();
}

function basenameOf(p: string): string {
  return p.split("/").pop() ?? p;
}

export function findRelated(
  newPath: string,
  existingPaths: string[],
  title?: string,
): RelatedFinding[] {
  const findings: RelatedFinding[] = [];
  const named = new Set<string>();

  const newFirst = firstSegment(newPath);

  // 1. namespace-prefix: a new nested top-level directory resembles an existing
  //    top-level directory. Only applies to nested new paths — a top-level file
  //    name that happens to contain a directory name is a different case.
  if (newPath.includes("/")) {
    const dirCounts = new Map<string, number>();
    for (const p of existingPaths) {
      const dir = firstSegment(p);
      dirCounts.set(dir, (dirCounts.get(dir) ?? 0) + 1);
    }
    for (const [dir, count] of dirCounts) {
      if (dir === newFirst) continue;
      if (!resemblesNamespace(newFirst, dir)) continue;
      const pages = dirPages(existingPaths, dir);
      for (const p of pages) named.add(p);
      findings.push({
        kind: "namespace-prefix",
        message: `Directory \`${newFirst}\` resembles existing \`${dir}/\` (${count} page${count === 1 ? "" : "s"}).`,
        paths: pages,
      });
    }
  }

  // 2. directory-shadows-page: a new nested directory matches an existing page stem.
  if (newPath.includes("/")) {
    for (const p of existingPaths) {
      const base = stem(basenameOf(p));
      if (base === newFirst) {
        named.add(p);
        findings.push({
          kind: "directory-shadows-page",
          message: `Directory \`${newFirst}\` shadows existing page \`${p}\`.`,
          paths: [p],
        });
      }
    }
  }

  // 3. similar-topic: token overlap between the new page/title and existing pages.
  const newTokens = new Set([
    ...tokenize(stem(newPath)),
    ...(title ? tokenize(title) : []),
  ]);
  if (newTokens.size > 0) {
    const tokenDocFreq = new Map<string, number>();
    const pageTokens = new Map<string, Set<string>>();
    for (const p of existingPaths) {
      const tokens = new Set(tokenize(stem(p)));
      pageTokens.set(p, tokens);
      for (const t of tokens) {
        tokenDocFreq.set(t, (tokenDocFreq.get(t) ?? 0) + 1);
      }
    }

    const scored: { path: string; overlap: number }[] = [];
    for (const [p, tokens] of pageTokens) {
      if (named.has(p)) continue;
      const shared: string[] = [];
      for (const t of newTokens) {
        if (tokens.has(t)) shared.push(t);
      }
      if (shared.length >= 2) {
        scored.push({ path: p, overlap: shared.length });
      } else if (shared.length === 1) {
        const freq = tokenDocFreq.get(shared[0]) ?? 0;
        if (freq < 4) {
          scored.push({ path: p, overlap: shared.length });
        }
      }
    }

    scored.sort((a, b) => {
      if (b.overlap !== a.overlap) return b.overlap - a.overlap;
      return a.path.localeCompare(b.path);
    });

    const top = scored.slice(0, 5);
    if (top.length > 0) {
      const paths = top.map((s) => s.path);
      for (const p of paths) named.add(p);
      const terms = [...newTokens].sort().join(", ");
      findings.push({
        kind: "similar-topic",
        message: `Similar topic to "${terms}": ${paths.join(", ")}`,
        paths,
      });
    }
  }

  return findings;
}
