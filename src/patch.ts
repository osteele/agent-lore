export interface EditPatch {
  path: string;
  old_string: string;
  new_string: string;
  replace_all?: boolean;
}

export interface PatchFailure {
  path: string;
  old_string: string;
  reason: "empty_old_string" | "missing" | "multiple";
  closest?: string;
}

export interface PatchResult {
  ok: boolean;
  applied: Map<string, string>;
  failures: PatchFailure[];
}

/**
 * Validate and apply a set of patches without writing anything to disk.
 * Edits apply sequentially — a later edit sees the content produced by an
 * earlier edit to the same file, matching harness multi-edit semantics.
 * If any anchor fails, the result is `ok: false` and no content is changed.
 */
export function applyPatchSet(
  current: Map<string, string>,
  edits: EditPatch[],
): PatchResult {
  const working = new Map(current);
  const edited = new Set<string>();
  const failures: PatchFailure[] = [];

  for (const edit of edits) {
    const content = working.get(edit.path);
    if (content === undefined) {
      failures.push({
        path: edit.path,
        old_string: edit.old_string,
        reason: "missing",
        closest: undefined,
      });
      continue;
    }

    if (edit.old_string === "") {
      failures.push({
        path: edit.path,
        old_string: "",
        reason: "empty_old_string",
        closest: undefined,
      });
      continue;
    }

    const occurrences = countOccurrences(content, edit.old_string);
    if (occurrences === 0) {
      failures.push({
        path: edit.path,
        old_string: edit.old_string,
        reason: "missing",
        closest: closestRegion(content, edit.old_string),
      });
      continue;
    }
    if (!edit.replace_all && occurrences > 1) {
      failures.push({
        path: edit.path,
        old_string: edit.old_string,
        reason: "multiple",
        closest: closestRegion(content, edit.old_string),
      });
      continue;
    }

    const replacement = edit.replace_all
      ? content.split(edit.old_string).join(edit.new_string)
      : replaceOnceLiteral(content, edit.old_string, edit.new_string);
    working.set(edit.path, replacement);
    edited.add(edit.path);
  }

  if (failures.length > 0) {
    return { ok: false, applied: new Map(), failures };
  }

  const applied = new Map<string, string>();
  for (const path of edited) {
    const content = working.get(path);
    if (content === undefined) {
      throw new Error(`Patch apply race: ${path} disappeared after validation`);
    }
    applied.set(path, content);
  }

  return { ok: true, applied, failures };
}

/**
 * Replace the first occurrence of `needle` with `replacement`, treating the
 * replacement as a literal string. String.prototype.replace would interpret
 * `$&`, `` $` `` and friends inside the replacement.
 */
function replaceOnceLiteral(
  content: string,
  needle: string,
  replacement: string,
): string {
  const idx = content.indexOf(needle);
  if (idx === -1) {
    throw new Error("replaceOnceLiteral called with absent needle");
  }
  return (
    content.slice(0, idx) + replacement + content.slice(idx + needle.length)
  );
}

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let from = 0;
  while (true) {
    const idx = haystack.indexOf(needle, from);
    if (idx === -1) break;
    count++;
    from = idx + needle.length;
  }
  return count;
}

/**
 * Return a window of the current content that is closest to the requested
 * old_string. Uses a simple longest-common-substring heuristic.
 */
function closestRegion(content: string, target: string): string {
  const windowSize = Math.max(target.length, 80);
  let best = "";
  let bestScore = 0;
  for (let i = 0; i <= content.length - windowSize; i++) {
    const window = content.slice(i, i + windowSize);
    const score = lcsLength(window, target);
    if (score > bestScore) {
      bestScore = score;
      best = window;
    }
  }
  if (best === "" && content.length > 0) {
    return content.slice(0, Math.min(content.length, windowSize));
  }
  return best;
}

function lcsLength(a: string, b: string): number {
  if (a.length === 0 || b.length === 0) return 0;
  const prev = new Array(a.length + 1).fill(0);
  const curr = new Array(a.length + 1).fill(0);
  let best = 0;
  for (let j = 1; j <= b.length; j++) {
    for (let i = 1; i <= a.length; i++) {
      if (a[i - 1] === b[j - 1]) {
        curr[i] = prev[i - 1] + 1;
        if (curr[i] > best) best = curr[i];
      } else {
        curr[i] = 0;
      }
    }
    for (let i = 0; i <= a.length; i++) {
      prev[i] = curr[i];
      curr[i] = 0;
    }
  }
  return best;
}
