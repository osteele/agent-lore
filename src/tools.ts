import fs from "node:fs";
import path from "node:path";
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
import { formatTalkEntry, normalizeTalkTopic } from "./talk.ts";

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
    description: "Read a page with line numbers.",
    inputSchema: {
      type: "object" as const,
      properties: {
        path: {
          type: "string",
          description: "Repo-root-relative path to the page",
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
  let text = lines.join("\n");
  if (capped) {
    text += `\n(Output capped at ${SEARCH_LIMIT} matches)`;
  }
  return { content: [{ type: "text", text }] };
}

const SEARCH_LIMIT = 200;

export async function handleLoreRead(
  ctx: ToolContext,
  args: { path: string; offset?: number; limit?: number },
): Promise<{ content: { type: "text"; text: string }[]; isError?: boolean }> {
  await ensureFirstContact(ctx);
  const rel = normalizeRepoPath(args.path);
  const content = await readRepoFile(ctx.kb, args.path);
  if (content === undefined) {
    const near = findNearMisses(ctx.kb, path.basename(rel));
    let message = `Page not found: ${args.path}`;
    if (near.length > 0) {
      message += `\nDid you mean: ${near.join(", ")}?`;
    }
    return { content: [{ type: "text", text: message }], isError: true };
  }

  const lines = content.split("\n");
  const offset = Math.max(1, args.offset ?? 1);
  const limit = args.limit ?? lines.length;
  const start = offset - 1;
  const slice = lines.slice(start, start + limit);

  const label = pageLabel(rel);
  const header = label ? `# ${label}\n` : "";
  const numbered = slice
    .map((line, idx) => `${start + idx + 1}\t${line}`)
    .join("\n");
  return { content: [{ type: "text", text: `${header}${numbered}` }] };
}

export async function handleLoreWrite(
  ctx: ToolContext,
  args: { path: string; content: string },
): Promise<{ content: { type: "text"; text: string }[]; isError?: boolean }> {
  await ensureFirstContact(ctx);
  const rel = normalizeRepoPath(args.path);
  const result = await writeRepoFile(ctx.kb, {
    rel,
    content: args.content,
    ...sharedWriteArgs(ctx),
  });
  return formatCommitResult(result);
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
