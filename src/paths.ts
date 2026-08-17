import fs from "node:fs";
import path from "node:path";

const SESSIONS_PREFIX = "sessions/";

export class PathEscapeError extends Error {
  constructor(input: string, reason: string) {
    super(`Path escapes repository: ${input} (${reason})`);
  }
}

export class SessionsWriteError extends Error {
  constructor(input: string) {
    super(`sessions/ is server-owned and cannot be written by tools: ${input}`);
  }
}

/**
 * Normalize a user-supplied repo-root-relative path.
 * - Rejects absolute paths.
 * - Collapses `.` and empty segments.
 * - Rejects `..` that escapes the repo root.
 * - Strips a trailing slash from files.
 * Does NOT touch the filesystem; symlink checks happen in resolveRepoPath.
 */
export function normalizeRepoPath(input: string): string {
  if (input === "" || input === ".") {
    throw new PathEscapeError(input, "empty path");
  }
  if (path.isAbsolute(input)) {
    throw new PathEscapeError(input, "absolute path");
  }

  const parts = input.split(/[\/]+/);
  const stack: string[] = [];
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (stack.length === 0) {
        throw new PathEscapeError(input, "parent directory escape");
      }
      stack.pop();
      continue;
    }
    stack.push(part);
  }

  if (stack.length === 0) {
    throw new PathEscapeError(input, "resolves to repo root");
  }
  return stack.join("/");
}

export function isSessionsPath(rel: string): boolean {
  return rel === "sessions" || rel.startsWith(SESSIONS_PREFIX);
}

export function assertNotSessions(rel: string, input: string): void {
  if (isSessionsPath(rel)) {
    throw new SessionsWriteError(input);
  }
}

export interface ResolvedRepoPath {
  rel: string;
  abs: string;
}

/**
 * Validate a repo-root-relative path and return both the normalized relative
 * path and the real absolute path (symlinks resolved). Throws if the path
 * escapes the repo after normalization/symlink resolution.
 */
export function resolveRepoPath(input: string, kb: string): ResolvedRepoPath {
  const rel = normalizeRepoPath(input);
  const candidate = path.resolve(kb, rel);
  const realKb = fs.realpathSync(kb);

  let realCandidate: string;
  if (fs.existsSync(candidate)) {
    realCandidate = fs.realpathSync(candidate);
  } else {
    // For not-yet-existing files, resolve the parent directory and re-attach
    // the basename so a symlinked parent directory still validates correctly.
    const parent = path.dirname(candidate);
    const base = path.basename(candidate);
    const realParent = fs.existsSync(parent)
      ? fs.realpathSync(parent)
      : path.resolve(realKb, path.relative(kb, parent));
    realCandidate = path.join(realParent, base);
  }

  const withSep = realKb.endsWith(path.sep) ? realKb : realKb + path.sep;
  if (realCandidate !== realKb && !realCandidate.startsWith(withSep)) {
    throw new PathEscapeError(input, "symlink or .. escape");
  }

  return { rel, abs: realCandidate };
}
