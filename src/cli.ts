#!/usr/bin/env node
import path from "node:path";
import {
  accessLogPath,
  analyticsEnabled,
  readAccessEvents,
  summarize,
} from "./access.ts";
import {
  globRepo,
  initRepo,
  readRepoFile,
  recentlyModifiedFiles,
  searchRepo,
} from "./gitrepo.ts";
import { resolveIdentity } from "./identity.ts";
import { isSessionsPath } from "./paths.ts";
import { type Section, findSection, parseSections } from "./sections.ts";
import { LORE_VERSION, buildContext, defaultKbPath } from "./server.ts";
import { type ToolContext, handleLoreLog, handleLoreRead } from "./tools.ts";

const USAGE = `Usage:
  lore mcp
  lore init
  lore search <pattern>
  lore read <path> [section]
  lore log [path]
  lore stats [--since <N>d] [--limit <N>]
  lore digest [--since <N>d] [--sections <a,b,c>]
  lore install`;

async function main(args: string[]): Promise<number> {
  const command = args[0];
  switch (command) {
    case "mcp":
      await runMcp();
      return 0;
    case "init":
      return await runInit();
    case "search":
      return await runSearch(args.slice(1));
    case "read":
      return await runRead(args.slice(1));
    case "log":
      return await runLog(args.slice(1));
    case "stats":
      return await runStats(args.slice(1));
    case "digest":
      return await runDigest(args.slice(1));
    case "install":
      return runInstall();
    default:
      console.error(USAGE);
      return command === undefined ? 0 : 1;
  }
}

async function runMcp(): Promise<void> {
  const { runServer } = await import("./server.ts");
  await runServer();
}

async function runInit(): Promise<number> {
  const kb = process.env.AGENT_LORE_KB ?? defaultKbPath();
  await initRepo(kb);
  console.log(kb);
  return 0;
}

async function runSearch(args: string[]): Promise<number> {
  if (args.length === 0) {
    console.error("lore search: missing pattern");
    return 1;
  }
  const kb = process.env.AGENT_LORE_KB ?? defaultKbPath();
  await initRepo(kb);
  const { lines, capped } = await searchRepo(kb, args[0], undefined, false);
  if (lines.length > 0) {
    console.log(lines.join("\n"));
  }
  if (capped) {
    console.log("(Output capped at 200 matches)");
  }
  return 0;
}

async function runRead(args: string[]): Promise<number> {
  if (args.length === 0) {
    console.error("lore read: missing path");
    return 1;
  }
  const ctx = await buildCliContext();
  const result = await handleLoreRead(ctx, {
    path: args[0],
    section: args[1],
  });
  const text = result.content.map((c) => c.text).join("\n");
  if (result.isError) {
    console.error(text);
    return 1;
  }
  console.log(text);
  return 0;
}

async function runLog(args: string[]): Promise<number> {
  const ctx = await buildCliContext();
  const result = await handleLoreLog(ctx, { path: args[0] });
  console.log(result.content.map((c) => c.text).join("\n"));
  return 0;
}

async function runStats(args: string[]): Promise<number> {
  const kb = process.env.AGENT_LORE_KB ?? defaultKbPath();
  await initRepo(kb);

  let sinceMs: number | undefined;
  let limit = 10;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--since" && args[i + 1] !== undefined) {
      const days = Number.parseInt(args[i + 1].replace(/d$/, ""), 10);
      if (Number.isNaN(days)) {
        console.error(`lore stats: bad --since value ${args[i + 1]}`);
        return 1;
      }
      sinceMs = Date.now() - days * 24 * 60 * 60 * 1000;
      i++;
    } else if (args[i] === "--limit" && args[i + 1] !== undefined) {
      const parsed = Number.parseInt(args[i + 1], 10);
      if (Number.isNaN(parsed)) {
        console.error(`lore stats: bad --limit value ${args[i + 1]}`);
        return 1;
      }
      limit = parsed;
      i++;
    }
  }

  if (!analyticsEnabled()) {
    console.log("Analytics are disabled (AGENT_LORE_NO_ANALYTICS=1).");
  }
  const summary = summarize(readAccessEvents(kb, sinceMs));
  console.log(`log: ${accessLogPath(kb)}`);
  const damaged =
    summary.unparseable > 0
      ? ` (${summary.unparseable} unparseable line(s))`
      : "";
  console.log(
    `${summary.total} events from ${summary.sessions} session(s)${damaged}`,
  );

  if (summary.byTool.length > 0) {
    console.log("\nBy tool:");
    for (const row of summary.byTool) {
      console.log(`  ${row.count}\t${row.tool}`);
    }
  }

  if (summary.zeroResult.length > 0) {
    console.log("\nFound nothing (write these pages):");
    for (const row of summary.zeroResult.slice(0, limit)) {
      console.log(`  ${row.count}\t${row.tool}\t${row.query}`);
    }
  }

  if (summary.topPages.length > 0) {
    console.log("\nMost-read pages:");
    for (const row of summary.topPages.slice(0, limit)) {
      console.log(`  ${row.reads}\t${row.path}`);
    }
  }

  const allPages = await globRepo(kb, "**/*.md", true, true);
  const unread = allPages.filter((p) => !summary.readPaths.has(p));
  if (unread.length > 0) {
    console.log("\nNever read:");
    for (const page of unread.slice(0, limit)) {
      console.log(`  ${page}`);
    }
  }

  return 0;
}

const DEFAULT_DIGEST_SECTIONS = [
  "Quirks and gotchas",
  "Wanted",
  "Rough edges",
  "What worked",
];

async function runDigest(args: string[]): Promise<number> {
  const kb = process.env.AGENT_LORE_KB ?? defaultKbPath();
  await initRepo(kb);

  let sinceDays = 7;
  let sectionNames = [...DEFAULT_DIGEST_SECTIONS];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--since" && args[i + 1] !== undefined) {
      const days = Number.parseInt(args[i + 1].replace(/d$/, ""), 10);
      if (Number.isNaN(days)) {
        console.error(`lore digest: bad --since value ${args[i + 1]}`);
        return 1;
      }
      sinceDays = days;
      i++;
    } else if (args[i] === "--sections" && args[i + 1] !== undefined) {
      sectionNames = args[i + 1]
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s !== "");
      i++;
    }
  }

  const sinceMs = Date.now() - sinceDays * 24 * 60 * 60 * 1000;
  const files = await recentlyModifiedFiles(
    kb,
    new Date(sinceMs).toISOString(),
  );
  const candidates = files.filter(
    (f) => !isSessionsPath(f.path) && f.path !== "README.md",
  );

  let printedAny = false;
  for (const file of candidates) {
    const content = await readRepoFile(kb, file.path);
    if (content === undefined) continue;
    const sections = parseSections(content);
    const matches = sectionNames
      .map((name) => findSection(sections, name))
      .filter((s): s is Section => s !== undefined);

    let fileText = "";
    for (const section of matches) {
      const body = extractSectionBody(content, section).trim();
      if (body === "") continue;
      if (isPlaceholderBody(body)) continue;
      if (fileText === "") {
        fileText += `${file.path} — ${file.author}, ${file.date}`;
      }
      fileText += `\n\n## ${section.heading}\n${body}`;
    }

    if (fileText !== "") {
      console.log(fileText);
      printedAny = true;
    }
  }

  if (!printedAny) {
    console.log(`No qualifying sections in the last ${sinceDays} days.`);
  }

  return 0;
}

function extractSectionBody(content: string, section: Section): string {
  const lines = content.split("\n");
  const from = section.startLine; // heading line
  const to = section.endLine;
  const bodyLines: string[] = [];
  for (let i = from; i <= to && i <= lines.length; i++) {
    // Skip the heading line itself.
    if (i === section.startLine) continue;
    bodyLines.push(lines[i - 1]);
  }
  return bodyLines.join("\n");
}

function isPlaceholderBody(body: string): boolean {
  return body.trim().toLowerCase().startsWith("nothing recorded yet");
}

function runInstall(): number {
  const command = process.execPath;
  const script = path.join(import.meta.dir, "cli.ts");

  console.log("Claude Code (~/.claude.json, user-scope mcpServers):");
  console.log(
    JSON.stringify(
      {
        mcpServers: { lore: { type: "stdio", command, args: [script, "mcp"] } },
      },
      null,
      2,
    ),
  );

  console.log("\nCodex (~/.codex/config.toml):");
  console.log(`[mcp_servers.lore]
command = ${JSON.stringify(command)}
args = [${JSON.stringify(script)}, "mcp"]`);

  console.log("\nkimi (~/.kimi-code/mcp.json, under mcpServers):");
  console.log(
    JSON.stringify({ lore: { command, args: [script, "mcp"] } }, null, 2),
  );

  console.log("\nopencode (~/.config/opencode/opencode.jsonc, under mcp):");
  console.log(
    JSON.stringify(
      {
        lore: {
          type: "local",
          command: [command, script, "mcp"],
          enabled: true,
        },
      },
      null,
      2,
    ),
  );
  return 0;
}

async function buildCliContext(): Promise<ToolContext> {
  const kb = process.env.AGENT_LORE_KB ?? defaultKbPath();
  await initRepo(kb);
  const identity = resolveIdentity();
  const ctx = await buildContext(kb);
  return {
    kb,
    identity,
    clientName: "lore-cli",
    clientVersion: LORE_VERSION,
    cwd: ctx.cwd,
    user: ctx.user,
    hostname: ctx.hostname,
    osVersion: ctx.osVersion,
    parent: ctx.parent,
    envAllowlist: ctx.envAllowlist,
    loreVersion: LORE_VERSION,
  };
}

if (import.meta.main) {
  main(process.argv.slice(2))
    .then((code) => {
      if (code !== 0) process.exit(code);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
