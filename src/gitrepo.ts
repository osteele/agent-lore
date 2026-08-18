import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Identity } from "./identity.ts";
import { type LedgerInfo, formatLedger } from "./ledger.ts";
import { type EditPatch, applyPatchSet } from "./patch.ts";
import {
  assertNotSessions,
  isSessionsPath,
  normalizeRepoPath,
  resolveRepoPath,
} from "./paths.ts";
import { headingForLine, parseSections } from "./sections.ts";
import { formatTalkPage } from "./talk.ts";
import { extractWikilinks } from "./wikilinks.ts";

export interface CommitResult {
  hash: string;
  dangling: string[];
}

export interface LedgerEnsureArgs {
  identity: Identity;
  clientName?: string;
  clientVersion?: string;
  protocolVersion?: string;
  roots?: string[];
  cwd?: string;
  user?: string;
  hostname?: string;
  osVersion?: string;
  parent?: LedgerInfo["parent"];
  env?: Record<string, string>;
  loreVersion: string;
}

const LOCK_DIR = ".lore-lock";
const LOCK_OWNER = "owner";
const MAX_LOCK_ATTEMPTS = 120;
const LOCK_BACKOFF_MS = 50;
const LOCK_STALE_MS = 60_000;

export async function initRepo(kb: string): Promise<void> {
  fs.mkdirSync(kb, { recursive: true });
  const gitDir = path.join(kb, ".git");
  if (!fs.existsSync(gitDir)) {
    await git(kb, ["init", "-b", "main"]);
  }
  const gitignore = path.join(kb, ".gitignore");
  if (!fs.existsSync(gitignore)) {
    fs.writeFileSync(gitignore, ".lore-lock\n", "utf-8");
  }
  const readme = path.join(kb, "README.md");
  if (!fs.existsSync(readme)) {
    const stub =
      "# Agent Lore\n\nMachine-local, agent-written knowledge base.\n";
    fs.writeFileSync(readme, stub, "utf-8");
    await stageAndCommit(
      kb,
      "initial commit",
      "unattributed",
      "unattributed@agent-lore",
      undefined,
    );
  }
}

export async function readRepoFile(
  kb: string,
  input: string,
): Promise<string | undefined> {
  const { abs } = resolveRepoPath(input, kb);
  if (!fs.existsSync(abs)) return undefined;
  return fs.readFileSync(abs, "utf-8");
}

export async function globRepo(
  kb: string,
  pattern: string,
  includeTalk = false,
  includeSessions = false,
): Promise<string[]> {
  const glob = new Bun.Glob(pattern);
  const matches: { rel: string; mtime: number }[] = [];
  for await (const file of glob.scan({
    cwd: kb,
    absolute: false,
    onlyFiles: true,
  })) {
    const rel = normalizeRepoPath(file);
    if (!includeTalk && rel.endsWith(".talk.md")) continue;
    if (!includeSessions && isSessionsPath(rel)) continue;
    const abs = path.join(kb, rel);
    const stat = fs.statSync(abs);
    matches.push({ rel, mtime: stat.mtimeMs });
  }
  matches.sort((a, b) => b.mtime - a.mtime);
  return matches.map((m) => m.rel);
}

export async function searchRepo(
  kb: string,
  pattern: string,
  globFilter?: string,
  includeTalk = false,
  includeSessions = false,
  limit = 200,
): Promise<{ lines: string[]; capped: boolean }> {
  const files = await globRepo(
    kb,
    globFilter ?? "**/*.md",
    includeTalk,
    includeSessions,
  );
  const re = new RegExp(pattern);
  const lines: string[] = [];
  let capped = false;
  for (const rel of files) {
    const content = fs.readFileSync(path.join(kb, rel), "utf-8");
    const fileLines = content.split("\n");
    const sections = parseSections(content);
    for (let i = 0; i < fileLines.length; i++) {
      if (re.test(fileLines[i])) {
        // The enclosing heading is the anchor the caller can pass back as
        // lore_read's `section`, so search → section read is one hop.
        const heading = headingForLine(sections, i + 1);
        const suffix = heading ? `  [§ ${heading}]` : "";
        lines.push(`${rel}:${i + 1} ${fileLines[i]}${suffix}`);
        if (lines.length >= limit) {
          capped = true;
          break;
        }
      }
    }
    if (capped) break;
  }
  return { lines, capped };
}

export async function logRepo(
  kb: string,
  filePath?: string,
  limit = 20,
): Promise<string[]> {
  const args = ["log", `--max-count=${limit}`, "--pretty=format:%h %aI %an %s"];
  if (filePath) args.push("--", filePath);
  const output = await git(kb, args);
  return output === "" ? [] : output.split("\n");
}

export interface WriteArgs {
  rel: string;
  content: string;
  identity: Identity;
  clientName?: string;
  clientVersion?: string;
  cwd?: string;
}

export async function writeRepoFile(
  kb: string,
  args: WriteArgs,
): Promise<CommitResult> {
  assertNotSessions(args.rel, args.rel);
  const { abs } = resolveRepoPath(args.rel, kb);
  return runWritePipeline(kb, {
    identity: args.identity,
    clientName: args.clientName,
    clientVersion: args.clientVersion,
    cwd: args.cwd,
    toolName: "lore_write",
    subject: `write ${args.rel}`,
    async validate() {
      return { ok: true as const, failures: [] };
    },
    async apply() {
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, args.content, "utf-8");
      return [args.rel];
    },
  });
}

export interface EditArgs {
  edits: EditPatch[];
  identity: Identity;
  clientName?: string;
  clientVersion?: string;
  cwd?: string;
}

export async function editRepoFiles(
  kb: string,
  args: EditArgs,
): Promise<CommitResult> {
  // Normalize every path up front so the sessions/ guard, patch keys, and
  // commit subjects all operate on the canonical repo-relative path — a raw
  // spelling like "./sessions/x.md" must not bypass the guard, and two
  // spellings of one file must patch the same content.
  const resolved = new Map<string, { rel: string; abs: string }>();
  const normEdits: EditPatch[] = args.edits.map((edit) => {
    const r = resolveRepoPath(edit.path, kb);
    assertNotSessions(r.rel, edit.path);
    resolved.set(r.rel, r);
    return { ...edit, path: r.rel };
  });

  function readCurrent():
    | { ok: true; current: Map<string, string> }
    | { ok: false; failure: { path: string; old_string: string } } {
    const current = new Map<string, string>();
    for (const edit of normEdits) {
      const resolvedPath = resolved.get(edit.path);
      if (!resolvedPath) {
        throw new Error(`Missing resolved path for ${edit.path}`);
      }
      if (!fs.existsSync(resolvedPath.abs)) {
        return {
          ok: false,
          failure: { path: edit.path, old_string: edit.old_string },
        };
      }
      current.set(edit.path, fs.readFileSync(resolvedPath.abs, "utf-8"));
    }
    return { ok: true, current };
  }

  return runWritePipeline(kb, {
    identity: args.identity,
    clientName: args.clientName,
    clientVersion: args.clientVersion,
    cwd: args.cwd,
    toolName: "lore_edit",
    subject: `edit ${[...resolved.keys()].join(", ")}`,
    async validate() {
      const read = readCurrent();
      if (!read.ok) {
        return {
          ok: false as const,
          failures: [
            {
              path: read.failure.path,
              old_string: read.failure.old_string,
              reason: "missing",
              closest: undefined,
            },
          ],
        };
      }
      const result = applyPatchSet(read.current, normEdits);
      return result.ok
        ? { ok: true as const, failures: [] }
        : { ok: false as const, failures: result.failures };
    },
    async apply() {
      const read = readCurrent();
      if (!read.ok) {
        throw new Error(
          `Patch validation race: ${read.failure.path} disappeared during locking`,
        );
      }
      const result = applyPatchSet(read.current, normEdits);
      if (!result.ok) {
        throw new Error(
          "Patch validation race: anchors changed during locking",
        );
      }
      const changed: string[] = [];
      for (const [rel, content] of result.applied) {
        const resolvedPath = resolved.get(rel);
        if (!resolvedPath) {
          throw new Error(`Missing resolved path for ${rel}`);
        }
        fs.mkdirSync(path.dirname(resolvedPath.abs), { recursive: true });
        fs.writeFileSync(resolvedPath.abs, content, "utf-8");
        changed.push(rel);
      }
      return changed;
    },
  });
}

export interface TalkArgs {
  topic: string;
  message: string;
  entry: string;
  identity: Identity;
  clientName?: string;
  clientVersion?: string;
  cwd?: string;
}

export async function appendTalk(
  kb: string,
  args: TalkArgs,
): Promise<CommitResult> {
  assertNotSessions(args.topic, args.topic);
  const rel = normalizeRepoPath(`${args.topic}.talk.md`);
  assertNotSessions(rel, args.topic);
  const { abs } = resolveRepoPath(rel, kb);

  return runWritePipeline(kb, {
    identity: args.identity,
    clientName: args.clientName,
    clientVersion: args.clientVersion,
    cwd: args.cwd,
    toolName: "lore_talk",
    subject: `talk ${args.topic}`,
    async validate() {
      return { ok: true as const, failures: [] };
    },
    async apply() {
      const exists = fs.existsSync(abs);
      if (!exists) {
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, formatTalkPage(args.topic), "utf-8");
      }
      const current = fs.readFileSync(abs, "utf-8");
      fs.writeFileSync(abs, current + args.entry, "utf-8");
      return [rel];
    },
  });
}

const ledgerMutex = new Map<string, Promise<void>>();

export async function ensureLedger(
  kb: string,
  args: LedgerEnsureArgs,
): Promise<void> {
  const ledgerRel = normalizeRepoPath(`sessions/${args.identity.name}.md`);
  const { abs } = resolveRepoPath(ledgerRel, kb);

  if (fs.existsSync(abs)) return;

  // Serialize concurrent ledger creation for the same repo.
  let pending = ledgerMutex.get(kb);
  if (!pending) {
    pending = (async () => {
      if (fs.existsSync(abs)) return;
      const info: LedgerInfo = {
        sessionId: args.identity.sessionId,
        idSource: args.identity.idSource,
        ...(args.identity.minted ? { minted: true } : {}),
        ...(args.clientName
          ? {
              client: {
                name: args.clientName,
                version: args.clientVersion ?? "",
              },
            }
          : {}),
        ...(args.protocolVersion
          ? { protocolVersion: args.protocolVersion }
          : {}),
        ...(args.roots && args.roots.length > 0 ? { roots: args.roots } : {}),
        ...(args.cwd ? { cwd: args.cwd } : {}),
        ...(args.user ? { user: args.user } : {}),
        ...(args.hostname ? { hostname: args.hostname } : {}),
        ...(args.osVersion ? { osVersion: args.osVersion } : {}),
        ...(args.parent ? { parent: args.parent } : {}),
        ...(args.env && Object.keys(args.env).length > 0
          ? { env: args.env }
          : {}),
        firstObserved: new Date().toISOString(),
        loreVersion: args.loreVersion,
      };
      const content = formatLedger(info);
      await runWritePipeline(kb, {
        identity: args.identity,
        clientName: args.clientName,
        clientVersion: args.clientVersion,
        cwd: args.cwd,
        toolName: "ledger",
        subject: `ledger: first contact from ${args.identity.name}`,
        async validate() {
          return { ok: true as const, failures: [] };
        },
        async apply() {
          if (fs.existsSync(abs)) return [];
          fs.mkdirSync(path.dirname(abs), { recursive: true });
          fs.writeFileSync(abs, content, "utf-8");
          return [ledgerRel];
        },
      });
    })();
    // Clear a failed attempt so a later tool call retries instead of
    // re-awaiting a cached rejection forever.
    pending = pending.catch((err) => {
      ledgerMutex.delete(kb);
      throw err;
    });
    ledgerMutex.set(kb, pending);
  }
  await pending;
}

interface WritePipelineArgs {
  identity: Identity;
  clientName?: string;
  clientVersion?: string;
  cwd?: string;
  toolName: string;
  subject: string;
  validate(): Promise<
    | {
        ok: false;
        failures: {
          path: string;
          old_string: string;
          reason: string;
          closest?: string;
        }[];
      }
    | { ok: true; failures: [] }
  >;
  apply(): Promise<string[]>;
}

async function runWritePipeline(
  kb: string,
  args: WritePipelineArgs,
): Promise<CommitResult> {
  const release = await acquireLock(kb);
  try {
    await sweepForeignDirt(kb, args.identity.name, args.toolName);

    const validation = await args.validate();
    if (!validation.ok) {
      const messages = validation.failures.map((f) => {
        const closest = f.closest ? `\nClosest region:\n${f.closest}` : "";
        return `${f.path}: ${f.reason} for old_string "${f.old_string}"${closest}`;
      });
      throw new PatchAnchorError(messages.join("\n---\n"));
    }

    const changed = await args.apply();
    if (changed.length === 0) {
      // Nothing to record (e.g. a raced ledger creation): committing an empty
      // index would fail, and there is nothing to attribute anyway.
      const hash = (await git(kb, ["rev-parse", "HEAD"])).trim();
      return { hash, dangling: [] };
    }

    for (const rel of changed) {
      await git(kb, ["add", "--", rel]);
    }

    const commitBody = buildTrailers(
      args.identity,
      args.clientName,
      args.clientVersion,
      args.cwd,
    );
    const fullMessage = `${args.subject}\n\n${commitBody}`;
    await git(kb, ["commit", "-m", fullMessage, "--no-verify"], {
      env: gitCommitEnv(args.identity.authorName, args.identity.authorEmail),
    });

    const hash = (await git(kb, ["rev-parse", "HEAD"])).trim();
    const dangling = findDangling(kb, changed);
    return { hash, dangling };
  } finally {
    release();
  }
}

export class PatchAnchorError extends Error {}

function buildTrailers(
  identity: Identity,
  clientName?: string,
  clientVersion?: string,
  cwd?: string,
): string {
  const client = clientName
    ? `${clientName}/${clientVersion ?? ""}`
    : "unknown";
  const lines = [
    `Lore-Session: ${identity.sessionId}`,
    `Lore-Client: ${client}`,
    `Lore-Project: ${cwd ?? "unknown"}`,
  ];
  return lines.join("\n");
}

async function sweepForeignDirt(
  kb: string,
  sessionName: string,
  toolName: string,
): Promise<void> {
  const status = await gitStatus(kb);
  if (status.length === 0) return;

  await git(kb, ["add", "-A"]);
  const subject = `unattributed edit (found before ${toolName} by ${sessionName})`;
  await stageAndCommit(
    kb,
    subject,
    "unattributed",
    "unattributed@agent-lore",
    undefined,
  );
}

async function gitStatus(kb: string): Promise<string[]> {
  const output = await git(kb, ["status", "--porcelain"]);
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

async function stageAndCommit(
  kb: string,
  subject: string,
  authorName: string,
  authorEmail: string,
  trailers?: string,
): Promise<void> {
  await git(kb, ["add", "-A"]);
  const message = trailers ? `${subject}\n\n${trailers}` : subject;
  await git(kb, ["commit", "-m", message, "--no-verify"], {
    env: gitCommitEnv(authorName, authorEmail),
  });
}

function gitCommitEnv(
  authorName: string,
  authorEmail: string,
): Record<string, string> {
  return {
    GIT_AUTHOR_NAME: authorName,
    GIT_AUTHOR_EMAIL: authorEmail,
    GIT_COMMITTER_NAME: authorName,
    GIT_COMMITTER_EMAIL: authorEmail,
  };
}

function findDangling(kb: string, changedRels: string[]): string[] {
  const dangling: string[] = [];
  const seen = new Set<string>();
  for (const rel of changedRels) {
    const abs = path.join(kb, rel);
    if (!fs.existsSync(abs)) continue;
    const content = fs.readFileSync(abs, "utf-8");
    for (const target of extractWikilinks(content)) {
      if (seen.has(target)) continue;
      seen.add(target);
      const targetRel = normalizeRepoPath(`${target}.md`);
      const targetAbs = path.join(kb, targetRel);
      if (!fs.existsSync(targetAbs)) {
        dangling.push(target);
      }
    }
  }
  return dangling;
}

async function acquireLock(kb: string): Promise<() => void> {
  const lockPath = path.join(kb, LOCK_DIR);

  for (let attempt = 0; attempt < MAX_LOCK_ATTEMPTS; attempt++) {
    try {
      fs.mkdirSync(lockPath);
      const ownerPath = path.join(lockPath, LOCK_OWNER);
      fs.writeFileSync(
        ownerPath,
        JSON.stringify({ pid: process.pid, time: Date.now() }),
        "utf-8",
      );
      return () => {
        try {
          fs.rmSync(lockPath, { recursive: true, force: true });
        } catch {
          // Best-effort cleanup; the next lock attempt will handle a stale lock.
        }
      };
    } catch (err) {
      if (err instanceof Error && "code" in err && err.code === "EEXIST") {
        const shouldBreak = await canBreakLock(lockPath);
        if (shouldBreak) {
          try {
            fs.rmSync(lockPath, { recursive: true, force: true });
          } catch {
            // If removal fails, another process broke it first; retry.
          }
          continue;
        }
        await sleep(LOCK_BACKOFF_MS);
        continue;
      }
      throw err;
    }
  }

  throw new Error(`Could not acquire lore lock at ${lockPath}`);
}

async function canBreakLock(lockPath: string): Promise<boolean> {
  const ownerPath = path.join(lockPath, LOCK_OWNER);
  let record: { pid?: number; time?: number } | undefined;
  try {
    const raw = fs.readFileSync(ownerPath, "utf-8");
    record = JSON.parse(raw) as { pid?: number; time?: number };
  } catch {
    // Missing or corrupt owner file: safe to break.
    return true;
  }
  if (record?.pid === undefined || record.time === undefined) return true;
  const age = Date.now() - record.time;
  if (age < LOCK_STALE_MS) return false;
  return !isProcessAlive(record.pid);
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface GitOptions {
  env?: Record<string, string>;
}

// A bare "git" on PATH may be a shadow shim (agent-command-guards) that
// rewrites add/commit into jj operations when a .jj directory sits anywhere
// above the target. This plumbing needs the real binary.
const GIT_BIN =
  process.env.AGENT_LORE_GIT ??
  (fs.existsSync("/usr/bin/git") ? "/usr/bin/git" : "git");

async function git(
  kb: string,
  args: string[],
  options: GitOptions = {},
): Promise<string> {
  const proc = Bun.spawn(
    [GIT_BIN, "-C", kb, "-c", "commit.gpgsign=false", ...args],
    {
      env: { ...process.env, ...options.env },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const [outBuf, errBuf] = await Promise.all([
    Bun.readableStreamToText(proc.stdout),
    Bun.readableStreamToText(proc.stderr),
  ]);
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed (${exitCode}): ${errBuf.trim()}\n${outBuf.trim()}`,
    );
  }
  return outBuf;
}
