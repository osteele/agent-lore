import fs from "node:fs";
import path from "node:path";
import { type AccessEvent, recordAccess } from "./access.ts";
import {
  type CommitResult,
  type EditArgs,
  type LedgerEnsureArgs,
  type TalkArgs,
  type WriteArgs,
  appendTalk,
  editRepoFiles,
  ensureLedger,
  globRepo,
  initRepo,
  logRepo,
  readRepoFile,
  searchRepo,
  writeRepoFile,
} from "./gitrepo.ts";
import type { Identity } from "./identity.ts";
import { isSessionsPath, normalizeRepoPath, resolveRepoPath } from "./paths.ts";
import { findRelated } from "./related.ts";
import {
  findSection,
  numberLines,
  parseSections,
  renderToc,
} from "./sections.ts";
import { formatTalkEntry, normalizeTalkTopic } from "./talk.ts";

function record(
  ctx: ToolContext,
  event: Omit<AccessEvent, "ts" | "session" | "name">,
): void {
  recordAccess(ctx.kb, {
    ts: new Date().toISOString(),
    session: ctx.identity.sessionId,
    name: ctx.identity.name,
    ...event,
  });
}

export const TOOL_SCHEMAS = [
  {
    name: "lore_glob",
    description: "List markdown pages matching a glob pattern.",
    inputSchema: {
      type: "object" as const,
      properties: {
        pattern: {
          type: "string",
          description: "Glob pattern relative to the repo root",
        },
        include_talk: {
          type: "boolean",
          description: "Include *.talk.md pages",
        },
      },
      required: ["pattern"],
    },
  },
  {
    name: "lore_search",
    description: "Search page contents with a regular expression.",
    inputSchema: {
      type: "object" as const,
      properties: {
        pattern: {
          type: "string",
          description: "Regular expression to search for",
        },
        glob: {
          type: "string",
          description: "Optional glob filter for files to search",
        },
        include_talk: {
          type: "boolean",
          description: "Include *.talk.md and sessions/ pages",
        },
      },
      required: ["pattern"],
    },
  },
  {
    name: "lore_read",
    description:
      "Read a page with line numbers. Long pages return a table of contents plus the first section; request another by heading.",
    inputSchema: {
      type: "object" as const,
      properties: {
        path: {
          type: "string",
          description: "Repo-root-relative path to the page",
        },
        section: {
          type: "string",
          description:
            "Heading of the section to read (as shown in a table of contents or a search hit's [§ ...] suffix)",
        },
        offset: { type: "integer", description: "1-based starting line" },
        limit: { type: "integer", description: "Maximum lines to return" },
      },
      required: ["path"],
    },
  },
  {
    name: "lore_write",
    description: "Create or fully replace a page.",
    inputSchema: {
      type: "object" as const,
      properties: {
        path: { type: "string", description: "Repo-root-relative path" },
        content: { type: "string", description: "Full page content" },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "lore_edit",
    description: "Atomically apply a set of anchored edits.",
    inputSchema: {
      type: "object" as const,
      properties: {
        edits: {
          type: "array",
          items: {
            type: "object",
            properties: {
              path: { type: "string" },
              old_string: { type: "string" },
              new_string: { type: "string" },
              replace_all: { type: "boolean" },
            },
            required: ["path", "old_string", "new_string"],
          },
        },
      },
      required: ["edits"],
    },
  },
  {
    name: "lore_talk",
    description: "Append a signed entry to a topic's talk page.",
    inputSchema: {
      type: "object" as const,
      properties: {
        topic: { type: "string", description: "Note path (.md implied)" },
        message: { type: "string", description: "Talk entry body" },
      },
      required: ["topic", "message"],
    },
  },
  {
    name: "lore_log",
    description: "Show recent git history for the repo or a specific path.",
    inputSchema: {
      type: "object" as const,
      properties: {
        path: {
          type: "string",
          description: "Optional repo-root-relative path",
        },
        limit: { type: "integer", description: "Maximum commits (default 20)" },
      },
      required: [],
    },
  },
];

export interface ToolContext {
  kb: string;
  identity: Identity;
  clientName?: string;
  clientVersion?: string;
  protocolVersion?: string;
  roots?: string[];
  cwd?: string;
  user?: string;
  hostname?: string;
  osVersion?: string;
  parent?: LedgerEnsureArgs["parent"];
  envAllowlist?: Record<string, string>;
  loreVersion: string;
}

export async function ensureFirstContact(ctx: ToolContext): Promise<void> {
  await initRepo(ctx.kb);
  await ensureLedger(ctx.kb, {
    identity: ctx.identity,
    clientName: ctx.clientName,
    clientVersion: ctx.clientVersion,
    protocolVersion: ctx.protocolVersion,
    roots: ctx.roots,
    cwd: ctx.cwd,
    user: ctx.user,
    hostname: ctx.hostname,
    osVersion: ctx.osVersion,
    parent: ctx.parent,
    env: ctx.envAllowlist,
    loreVersion: ctx.loreVersion,
  });
}

function sharedWriteArgs(ctx: ToolContext): Pick<
  WriteArgs,
  "identity" | "cwd"
> & {
  clientName?: string;
  clientVersion?: string;
} {
  return {
    identity: ctx.identity,
    clientName: ctx.clientName,
    clientVersion: ctx.clientVersion,
    cwd: ctx.cwd,
  };
}

export async function handleLoreGlob(
  ctx: ToolContext,
  args: { pattern: string; include_talk?: boolean },
): Promise<{ content: { type: "text"; text: string }[] }> {
  await ensureFirstContact(ctx);
  const includeTalk = args.include_talk ?? false;
  const includeSessions = args.pattern.includes("sessions");
  const matches = await globRepo(
    ctx.kb,
    args.pattern,
    includeTalk,
    includeSessions,
  );
  record(ctx, {
    tool: "lore_glob",
    query: args.pattern,
    results: matches.length,
  });
  return { content: [{ type: "text", text: matches.join("\n") }] };
}

export async function handleLoreSearch(
  ctx: ToolContext,
  args: { pattern: string; glob?: string; include_talk?: boolean },
): Promise<{ content: { type: "text"; text: string }[] }> {
  await ensureFirstContact(ctx);
  const includeTalk = args.include_talk ?? false;
  const includeSessions = args.glob ? args.glob.includes("sessions") : false;
  const { lines, capped } = await searchRepo(
    ctx.kb,
    args.pattern,
    args.glob,
    includeTalk,
    includeSessions,
  );
  record(ctx, {
    tool: "lore_search",
    query: args.pattern,
    results: lines.length,
  });
  if (lines.length === 0) {
    const text = await relatedSearchHint(ctx.kb, args.pattern);
    return { content: [{ type: "text", text }] };
  }
  let text = lines.join("\n");
  if (capped) {
    text += `\n(Output capped at ${SEARCH_LIMIT} matches)`;
  }
  return { content: [{ type: "text", text }] };
}

const SEARCH_LIMIT = 200;

/**
 * Pages at or under this many lines are returned whole, exactly as before —
 * the common case must stay one round trip, matching the harness Read tool
 * agents already know. Only longer pages lead with a table of contents.
 */
export const LARGE_PAGE_LINES = 150;

export async function handleLoreRead(
  ctx: ToolContext,
  args: { path: string; offset?: number; limit?: number; section?: string },
): Promise<{ content: { type: "text"; text: string }[]; isError?: boolean }> {
  await ensureFirstContact(ctx);
  const rel = normalizeRepoPath(args.path);
  const content = await readRepoFile(ctx.kb, args.path);
  if (content === undefined) {
    record(ctx, { tool: "lore_read", path: rel, results: 0 });
    const near = findNearMisses(ctx.kb, path.basename(rel));
    let message = `Page not found: ${args.path}`;
    if (near.length > 0) {
      message += `\nDid you mean: ${near.join(", ")}?`;
    }
    return { content: [{ type: "text", text: message }], isError: true };
  }

  const lines = content.split("\n");
  const sections = parseSections(content);
  const label = pageLabel(rel);
  const header = label ? `# ${label}\n` : "";

  if (args.section !== undefined) {
    const found = findSection(sections, args.section);
    if (found === undefined) {
      // A missed section is a miss like any other: it says what the agent
      // expected the page to contain.
      record(ctx, {
        tool: "lore_read",
        path: rel,
        section: args.section,
        results: 0,
      });
      const toc =
        sections.length > 0
          ? `\nSections:\n${renderToc(sections)}`
          : "\nThis page has no headings.";
      return {
        content: [
          {
            type: "text",
            text: `No section matching "${args.section}" in ${rel}.${toc}`,
          },
        ],
        isError: true,
      };
    }
    record(ctx, {
      tool: "lore_read",
      path: rel,
      section: found.heading,
      results: found.endLine - found.startLine + 1,
    });
    const body = numberLines(lines, found.startLine, found.endLine);
    return { content: [{ type: "text", text: `${header}${body}` }] };
  }

  // Explicit windowing wins over the table-of-contents behavior.
  if (args.offset !== undefined || args.limit !== undefined) {
    const offset = Math.max(1, args.offset ?? 1);
    const end =
      args.limit === undefined ? lines.length : offset + args.limit - 1;
    record(ctx, {
      tool: "lore_read",
      path: rel,
      results: Math.max(0, Math.min(end, lines.length) - offset + 1),
    });
    const body = numberLines(lines, offset, end);
    return { content: [{ type: "text", text: `${header}${body}` }] };
  }

  if (lines.length <= LARGE_PAGE_LINES || sections.length < 2) {
    record(ctx, { tool: "lore_read", path: rel, results: lines.length });
    const body = numberLines(lines, 1, lines.length);
    return { content: [{ type: "text", text: `${header}${body}` }] };
  }

  // Show everything before the SECOND heading, not the first section: a page
  // shaped `# Title` / `## A` / `## B` has a first section that spans the
  // whole page (a section contains its subsections), so "first section" would
  // return everything and defeat the table of contents.
  const previewEnd = Math.min(sections[1].startLine - 1, LARGE_PAGE_LINES);
  const truncated = previewEnd < sections[1].startLine - 1;
  record(ctx, {
    tool: "lore_read",
    path: rel,
    section: "(toc)",
    results: previewEnd,
  });
  const preamble = `${header}${rel} is ${lines.length} lines. Sections:
${renderToc(sections)}

Request one with lore_read(path, section: "<heading>"). Showing lines 1-${previewEnd}${truncated ? " (truncated)" : ""}:
`;
  const body = numberLines(lines, 1, previewEnd);
  return { content: [{ type: "text", text: `${preamble}${body}` }] };
}

export async function handleLoreWrite(
  ctx: ToolContext,
  args: { path: string; content: string },
): Promise<{ content: { type: "text"; text: string }[]; isError?: boolean }> {
  await ensureFirstContact(ctx);
  const rel = normalizeRepoPath(args.path);
  const existed = (await readRepoFile(ctx.kb, args.path)) !== undefined;
  const result = await writeRepoFile(ctx.kb, {
    rel,
    content: args.content,
    ...sharedWriteArgs(ctx),
  });
  let text = formatCommitResult(result).content[0].text;
  if (!existed) {
    text = await appendRelated(text, ctx.kb, rel, extractTitle(args.content));
  }
  return { content: [{ type: "text", text }] };
}

export async function handleLoreEdit(
  ctx: ToolContext,
  args: {
    edits: {
      path: string;
      old_string: string;
      new_string: string;
      replace_all?: boolean;
    }[];
  },
): Promise<{ content: { type: "text"; text: string }[]; isError?: boolean }> {
  await ensureFirstContact(ctx);
  const result = await editRepoFiles(ctx.kb, {
    edits: args.edits,
    ...sharedWriteArgs(ctx),
  });
  return formatCommitResult(result);
}

export async function handleLoreTalk(
  ctx: ToolContext,
  args: { topic: string; message: string },
): Promise<{ content: { type: "text"; text: string }[]; isError?: boolean }> {
  await ensureFirstContact(ctx);
  const topic = normalizeTalkTopic(args.topic);
  const timestamp = new Date().toISOString();
  const entry = formatTalkEntry(
    topic,
    ctx.identity.name,
    timestamp,
    args.message,
  );
  const result = await appendTalk(ctx.kb, {
    topic,
    message: args.message,
    entry,
    ...sharedWriteArgs(ctx),
  });
  return formatCommitResult(result);
}

export async function handleLoreLog(
  ctx: ToolContext,
  args: { path?: string; limit?: number },
): Promise<{ content: { type: "text"; text: string }[] }> {
  await ensureFirstContact(ctx);
  const rel = args.path ? normalizeRepoPath(args.path) : undefined;
  const lines = await logRepo(ctx.kb, rel, args.limit ?? 20);
  return { content: [{ type: "text", text: lines.join("\n") }] };
}

function formatCommitResult(result: CommitResult): {
  content: { type: "text"; text: string }[];
  isError?: boolean;
} {
  let text = `Committed ${result.hash}`;
  if (result.dangling.length > 0) {
    text += `\nDangling wikilinks: ${result.dangling.join(", ")}`;
  }
  return { content: [{ type: "text", text }] };
}

function pageLabel(rel: string): string {
  if (isSessionsPath(rel)) return `${rel} (ledger page)`;
  if (rel.endsWith(".talk.md")) return `${rel} (talk page)`;
  return "";
}

function findNearMisses(kb: string, basename: string): string[] {
  const matches: string[] = [];
  function walk(dir: string, prefix: string) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(abs, rel);
      } else if (entry.isFile() && entry.name === basename) {
        matches.push(rel);
      }
    }
  }
  walk(kb, "");
  return matches;
}

function extractTitle(content: string): string | undefined {
  const match = /^#\s+(.+)$/m.exec(content);
  return match?.[1].trim();
}

function patternToSyntheticPath(pattern: string): string {
  const slug = pattern
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
  return slug === "" ? "search.md" : `search/${slug}.md`;
}

async function listNotePaths(kb: string): Promise<string[]> {
  return globRepo(kb, "**/*.md", false, false);
}

async function appendRelated(
  text: string,
  kb: string,
  rel: string,
  title?: string,
): Promise<string> {
  // Advisory: the commit has already landed, so a failure here must not turn a
  // successful write into an error the caller might retry. Report it in the
  // result rather than swallowing it — a silent skip would hide the bug.
  let existing: string[];
  try {
    existing = await listNotePaths(kb);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return `${text}\n(related-page check failed: ${detail})`;
  }
  // The page we just wrote is already on disk; exclude it from the candidate set.
  const candidates = existing.filter((p) => p !== rel);
  const findings = findRelated(rel, candidates, title);
  if (findings.length === 0) return text;
  return `${text}\nRelated:\n${findings.map((f) => `- ${f.message}`).join("\n")}`;
}

async function relatedSearchHint(kb: string, pattern: string): Promise<string> {
  // Advisory, as in appendRelated: report the failure rather than hiding it
  // behind a bare "nothing matched", which would read as a clean empty result.
  let existing: string[];
  try {
    existing = await listNotePaths(kb);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return `Nothing matched.\n(related-page check failed: ${detail})`;
  }
  const findings = findRelated(patternToSyntheticPath(pattern), existing);
  if (findings.length === 0) return "Nothing matched.";
  const lines = findings.map((f) => `- ${f.message}`);
  return `Nothing matched. Possibly related:\n${lines.join("\n")}`;
}
