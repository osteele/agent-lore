import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveIdentity } from "./identity.ts";

describe("resolveIdentity", () => {
  let tmp: string;
  let origClaude: string | undefined;
  let origCodex: string | undefined;
  let origAgent: string | undefined;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lore-identity-"));
    origClaude = process.env.CLAUDE_CODE_SESSION_ID;
    origCodex = process.env.CODEX_THREAD_ID;
    origAgent = process.env.AGENT_SESSION_ID;
    process.env.CLAUDE_CODE_SESSION_ID = undefined;
    process.env.CODEX_THREAD_ID = undefined;
    process.env.AGENT_SESSION_ID = undefined;
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
    if (origClaude !== undefined)
      process.env.CLAUDE_CODE_SESSION_ID = origClaude;
    else process.env.CLAUDE_CODE_SESSION_ID = undefined;
    if (origCodex !== undefined) process.env.CODEX_THREAD_ID = origCodex;
    else process.env.CODEX_THREAD_ID = undefined;
    if (origAgent !== undefined) process.env.AGENT_SESSION_ID = origAgent;
    else process.env.AGENT_SESSION_ID = undefined;
  });

  it("uses CLAUDE_CODE_SESSION_ID first", () => {
    process.env.CLAUDE_CODE_SESSION_ID = "claude-id";
    process.env.CODEX_THREAD_ID = "codex-id";
    const id = resolveIdentity(tmp);
    expect(id.sessionId).toBe("claude-id");
    expect(id.idSource).toBe("CLAUDE_CODE_SESSION_ID");
    expect(id.minted).toBe(false);
  });

  it("falls back through env vars", () => {
    process.env.AGENT_SESSION_ID = "agent-id";
    const id = resolveIdentity(tmp);
    expect(id.sessionId).toBe("agent-id");
    expect(id.idSource).toBe("AGENT_SESSION_ID");
  });

  it("mints a UUID when no env var is set", () => {
    const id = resolveIdentity(tmp);
    expect(id.idSource).toBe("minted");
    expect(id.minted).toBe(true);
    expect(id.sessionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it("reads the agent-mail name file keyed by sha256(sessionId)", () => {
    process.env.CLAUDE_CODE_SESSION_ID = "sid";
    writeNameFile(tmp, "sid", {
      sessionId: "sid",
      scheme: "adjective-noun",
      slug: "fair-garden",
      displayName: "Fair Garden",
    });
    const id = resolveIdentity(tmp);
    expect(id.name).toBe("fair-garden");
    expect(id.authorEmail).toBe("sid@agent-lore");
  });

  it("ignores a name record for a different session id", () => {
    process.env.CLAUDE_CODE_SESSION_ID = "sid";
    writeNameFile(tmp, "sid", {
      sessionId: "someone-else",
      slug: "stolen-name",
    });
    const id = resolveIdentity(tmp);
    expect(id.name).toBe("session-sid");
  });

  it("falls back to session-<prefix> when name file is missing", () => {
    process.env.CLAUDE_CODE_SESSION_ID = "sid-with-long-name";
    const id = resolveIdentity(tmp);
    expect(id.name).toBe("session-sid-with");
  });

  it("falls back when name file is unparseable", () => {
    process.env.CLAUDE_CODE_SESSION_ID = "sid";
    const namesDir = path.join(tmp, ".claude", "agent-mail", "session-names");
    fs.mkdirSync(namesDir, { recursive: true });
    fs.writeFileSync(path.join(namesDir, nameFileBasename("sid")), "not json");
    const id = resolveIdentity(tmp);
    expect(id.name).toBe("session-sid");
  });
});

function nameFileBasename(sessionId: string): string {
  return `${createHash("sha256").update(sessionId).digest("hex")}.json`;
}

function writeNameFile(
  home: string,
  sessionId: string,
  record: Record<string, unknown>,
): void {
  const namesDir = path.join(home, ".claude", "agent-mail", "session-names");
  fs.mkdirSync(namesDir, { recursive: true });
  fs.writeFileSync(
    path.join(namesDir, nameFileBasename(sessionId)),
    JSON.stringify(record),
  );
}
