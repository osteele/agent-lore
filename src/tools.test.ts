import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { type AccessEvent, readAccessEvents } from "./access.ts";
import { initRepo } from "./gitrepo.ts";
import type { Identity } from "./identity.ts";
import {
  type ToolContext,
  handleLoreRead,
  handleLoreSearch,
  handleLoreWrite,
} from "./tools.ts";

function makeIdentity(name = "test-session", sessionId = "test-123"): Identity {
  return {
    sessionId,
    idSource: "AGENT_SESSION_ID",
    minted: false,
    name,
    authorName: name,
    authorEmail: `${sessionId}@agent-lore`,
  };
}

async function git(kb: string, ...args: string[]): Promise<string> {
  const proc = Bun.spawn(["git", "-C", kb, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const out = await Bun.readableStreamToText(proc.stdout);
  const err = await Bun.readableStreamToText(proc.stderr);
  const code = await proc.exited;
  if (code !== 0) throw new Error(`git ${args.join(" ")} failed: ${err}`);
  return out;
}

describe("handleLoreWrite", () => {
  let tmp: string;
  let kb: string;

  beforeEach(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lore-tools-"));
    kb = path.join(tmp, "kb");
    await initRepo(kb);
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("commits the ledger before the triggering write", async () => {
    const id = makeIdentity("tool-test", "tt-1");
    await handleLoreWrite(
      {
        kb,
        identity: id,
        clientName: "test-client",
        clientVersion: "1.0.0",
        cwd: "/tmp/project",
        loreVersion: "0.1.0",
      },
      { path: "note.md", content: "hello" },
    );

    const log = await git(kb, "log", "--pretty=format:%s");
    const lines = log.split("\n");
    const ledgerIndex = lines.findIndex((l) =>
      l.includes("ledger: first contact from tool-test"),
    );
    const writeIndex = lines.findIndex((l) => l.includes("write note.md"));
    expect(writeIndex).toBeLessThan(ledgerIndex);
  });
});

describe("handleLoreRead", () => {
  let tmp: string;
  let kb: string;
  let ctx: ToolContext;

  beforeEach(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lore-read-"));
    kb = path.join(tmp, "kb");
    await initRepo(kb);
    process.env.AGENT_LORE_ACCESS_LOG = path.join(tmp, "access.jsonl");
    ctx = {
      kb,
      identity: makeIdentity(),
      clientName: "test",
      clientVersion: "0",
      cwd: tmp,
      loreVersion: "0.1.0",
    };
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
    Reflect.deleteProperty(process.env, "AGENT_LORE_ACCESS_LOG");
  });

  function logged(): AccessEvent[] {
    return readAccessEvents(kb).events.filter((e) => e.tool === "lore_read");
  }

  function longPage(): string {
    const filler = Array(80).fill("body line").join("\n");
    return `# Top\n\n${filler}\n\n## Second\n\nsecond body\n\n${filler}\n`;
  }

  it("returns a short page whole, with no table of contents", async () => {
    await handleLoreWrite(ctx, {
      path: "short.md",
      content: "# Title\n\n## A\n\nalpha\n\n## B\n\nbeta\n",
    });
    const result = await handleLoreRead(ctx, { path: "short.md" });
    const text = result.content[0].text;
    expect(text).toContain("alpha");
    expect(text).toContain("beta");
    expect(text).not.toContain("Sections:");
  });

  it("leads a long page with a table of contents and the first section", async () => {
    await handleLoreWrite(ctx, { path: "long.md", content: longPage() });
    const result = await handleLoreRead(ctx, { path: "long.md" });
    const text = result.content[0].text;
    expect(text).toContain("Sections:");
    expect(text).toContain("# Top (lines 1-");
    expect(text).toContain("## Second (lines");
    expect(text).toContain('lore_read(path, section: "<heading>")');
    // Shows the preamble before the first "## " heading, not the whole page:
    // a top-level "# Top" section contains its subsections, so returning the
    // first section would return everything.
    expect(text).toContain("1\t# Top");
    expect(text).not.toContain("second body");
  });

  it("returns just the requested section, with original line numbers", async () => {
    await handleLoreWrite(ctx, { path: "long.md", content: longPage() });
    const result = await handleLoreRead(ctx, {
      path: "long.md",
      section: "second",
    });
    const text = result.content[0].text;
    expect(text).toContain("second body");
    expect(text).not.toContain("1\t# Top");
    expect(text).toMatch(/\n?8[0-9]\t## Second/);
  });

  it("records a missed section as a zero-result event and lists sections", async () => {
    await handleLoreWrite(ctx, { path: "long.md", content: longPage() });
    const result = await handleLoreRead(ctx, {
      path: "long.md",
      section: "placement",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Sections:");
    const miss = logged().find((e) => e.section === "placement");
    expect(miss?.results).toBe(0);
  });

  it("records a missing page as a zero-result event", async () => {
    const result = await handleLoreRead(ctx, { path: "absent.md" });
    expect(result.isError).toBe(true);
    const miss = logged().find((e) => e.path === "absent.md");
    expect(miss?.results).toBe(0);
  });

  it("lets explicit offset/limit win over the table of contents", async () => {
    await handleLoreWrite(ctx, { path: "long.md", content: longPage() });
    const result = await handleLoreRead(ctx, {
      path: "long.md",
      offset: 3,
      limit: 2,
    });
    const text = result.content[0].text;
    expect(text).not.toContain("Sections:");
    expect(text.split("\n")).toHaveLength(2);
    expect(text).toContain("3\t");
  });
});

describe("handleLoreSearch", () => {
  let tmp: string;
  let kb: string;
  let ctx: ToolContext;

  beforeEach(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lore-search-"));
    kb = path.join(tmp, "kb");
    await initRepo(kb);
    process.env.AGENT_LORE_ACCESS_LOG = path.join(tmp, "access.jsonl");
    ctx = {
      kb,
      identity: makeIdentity(),
      cwd: tmp,
      loreVersion: "0.1.0",
    };
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
    Reflect.deleteProperty(process.env, "AGENT_LORE_ACCESS_LOG");
  });

  it("names the enclosing section of each hit", async () => {
    await handleLoreWrite(ctx, {
      path: "p.md",
      content: "# Top\n\n## Placement\n\ncheckpoint is a hint\n",
    });
    const result = await handleLoreSearch(ctx, { pattern: "checkpoint" });
    expect(result.content[0].text).toContain("p.md:5");
    expect(result.content[0].text).toContain("[§ Placement]");
  });

  it("records a fruitless search with results 0", async () => {
    await handleLoreSearch(ctx, { pattern: "nothing-matches-this" });
    const events = readAccessEvents(kb).events.filter(
      (e) => e.tool === "lore_search",
    );
    expect(events[0].query).toBe("nothing-matches-this");
    expect(events[0].results).toBe(0);
  });
});
