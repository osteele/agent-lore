import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  LORE_VERSION,
  buildContext,
  buildInstructions,
  createServer,
} from "./server.ts";

describe("buildContext", () => {
  let tmp: string;
  let origKb: string | undefined;
  let origClaude: string | undefined;
  let origSecret: string | undefined;
  let origTerm: string | undefined;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lore-server-"));
    origKb = process.env.AGENT_LORE_KB;
    process.env.AGENT_LORE_KB = path.join(tmp, "kb");
    origClaude = process.env.CLAUDE_CODE_SESSION_ID;
    process.env.CLAUDE_CODE_SESSION_ID = "session-xyz";
    origSecret = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "super-secret";
    origTerm = process.env.TERM_PROGRAM;
    process.env.TERM_PROGRAM = "tmux";
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
    if (origKb !== undefined) process.env.AGENT_LORE_KB = origKb;
    else Reflect.deleteProperty(process.env, "AGENT_LORE_KB");
    if (origClaude !== undefined)
      process.env.CLAUDE_CODE_SESSION_ID = origClaude;
    else Reflect.deleteProperty(process.env, "CLAUDE_CODE_SESSION_ID");
    if (origSecret !== undefined) process.env.OPENAI_API_KEY = origSecret;
    else Reflect.deleteProperty(process.env, "OPENAI_API_KEY");
    if (origTerm !== undefined) process.env.TERM_PROGRAM = origTerm;
    else Reflect.deleteProperty(process.env, "TERM_PROGRAM");
  });

  it("captures only allowlisted env vars", async () => {
    const ctx = await buildContext();
    expect(ctx.envAllowlist.CLAUDE_CODE_SESSION_ID).toBe("session-xyz");
    expect(ctx.envAllowlist.TERM_PROGRAM).toBe("tmux");
    expect(ctx.envAllowlist.OPENAI_API_KEY).toBeUndefined();
  });
});

describe("createServer", () => {
  let tmp: string;
  let origKb: string | undefined;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lore-server-"));
    origKb = process.env.AGENT_LORE_KB;
    process.env.AGENT_LORE_KB = path.join(tmp, "kb");
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
    if (origKb !== undefined) process.env.AGENT_LORE_KB = origKb;
    else Reflect.deleteProperty(process.env, "AGENT_LORE_KB");
  });

  it("initializes and exposes the expected tools", async () => {
    const ctx = await buildContext();
    const server = createServer(ctx);
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test", version: "1.0.0" });
    await Promise.all([
      client.connect(clientTransport),
      server.connect(serverTransport),
    ]);

    const tools = await client.listTools();
    const names = tools.tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "lore_edit",
      "lore_glob",
      "lore_log",
      "lore_move",
      "lore_read",
      "lore_search",
      "lore_talk",
      "lore_write",
    ]);

    await client.close();
    await server.close();
  });

  it("instructions include the search-before-write guidance", () => {
    const text = buildInstructions("/tmp/kb");
    expect(text).toContain(
      "Search before you create a page and extend the existing one where there is one",
    );
    expect(text).toContain(
      "A search that turned up nothing is itself a page worth writing",
    );
  });

  it("instructions tell callers to name skills in backticks", () => {
    const text = buildInstructions("/tmp/kb");
    expect(text).toContain(
      "A wikilink addresses a lore page — name a skill in backticks instead, since skills are not pages here.",
    );
  });
});
