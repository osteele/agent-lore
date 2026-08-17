import { describe, expect, it } from "bun:test";
import { formatLedger } from "./ledger.ts";

describe("formatLedger", () => {
  it("includes required fields and omits missing optional fields", () => {
    const text = formatLedger({
      sessionId: "abc-123",
      idSource: "CLAUDE_CODE_SESSION_ID",
      firstObserved: "2024-01-15T10:00:00.000Z",
      loreVersion: "0.1.0",
    });
    expect(text).toContain("sessionId: abc-123");
    expect(text).toContain("idSource: CLAUDE_CODE_SESSION_ID");
    expect(text).toContain("firstObserved: 2024-01-15T10:00:00.000Z");
    expect(text).toContain("loreVersion: 0.1.0");
    expect(text).not.toContain("client:");
    expect(text).toContain("First observed 2024-01-15T10:00:00.000Z");
  });

  it("includes client and env when provided", () => {
    const text = formatLedger({
      sessionId: "abc",
      idSource: "minted",
      minted: true,
      client: { name: "claude-code", version: "0.5.0" },
      protocolVersion: "2024-11-05",
      cwd: "/home/user/project",
      env: { TERM_PROGRAM: "tmux", SHELL: "/bin/zsh" },
      firstObserved: "2024-01-15T10:00:00.000Z",
      loreVersion: "0.1.0",
    });
    expect(text).toContain("minted: true");
    expect(text).toContain("client:");
    expect(text).toContain("name: claude-code");
    expect(text).toContain("protocolVersion: 2024-11-05");
    expect(text).toContain("cwd: /home/user/project");
    expect(text).toContain("env:");
    expect(text).toContain("TERM_PROGRAM: tmux");
    expect(text).toContain("via claude-code 0.5.0");
  });
});
