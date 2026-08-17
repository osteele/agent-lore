import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { initRepo } from "./gitrepo.ts";
import type { Identity } from "./identity.ts";
import { handleLoreWrite } from "./tools.ts";

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
