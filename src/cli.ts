import os from "node:os";
import path from "node:path";
import { initRepo, searchRepo } from "./gitrepo.ts";
import { resolveIdentity } from "./identity.ts";
import { LORE_VERSION, buildContext } from "./server.ts";
import { type ToolContext, handleLoreLog, handleLoreRead } from "./tools.ts";

const USAGE = `Usage:
  lore mcp
  lore init
  lore search <pattern>
  lore read <path>
  lore log [path]
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
  const result = await handleLoreRead(ctx, { path: args[0] });
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

function runInstall(): number {
  console.log("Claude Code (~/.claude.json user-scope mcpServers):");
  console.log(
    JSON.stringify(
      {
        mcpServers: {
          lore: {
            command: "lore",
            args: ["mcp"],
          },
        },
      },
      null,
      2,
    ),
  );
  console.log("\nCodex (~/.codex/config.toml):");
  console.log(`[mcp_servers.lore]
command = "lore"
args = ["mcp"]
`);
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

function defaultKbPath(): string {
  return path.join(os.homedir(), ".claude", "agent-lore", "kb");
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
