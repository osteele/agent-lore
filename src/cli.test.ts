import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { initRepo, writeRepoFile } from "./gitrepo.ts";
import type { Identity } from "./identity.ts";

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

async function runCli(
  args: string[],
  env: Record<string, string>,
): Promise<{ stdout: string; stderr: string; code: number }> {
  const proc = Bun.spawn(["bun", "src/cli.ts", ...args], {
    cwd: path.join(import.meta.dir, ".."),
    env: { ...process.env, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await Bun.readableStreamToText(proc.stdout);
  const stderr = await Bun.readableStreamToText(proc.stderr);
  const code = await proc.exited;
  return { stdout, stderr, code };
}

describe("lore digest", () => {
  let tmp: string;
  let kb: string;

  beforeEach(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lore-digest-"));
    kb = path.join(tmp, "kb");
    await initRepo(kb);
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("includes a page with real Wanted content and excludes placeholder sections", async () => {
    await writeRepoFile(kb, {
      rel: "weft/inputs.md",
      content: [
        "# Weft Inputs",
        "",
        "## Wanted",
        "",
        "Support nested asset references.",
        "",
        "## Quirks and gotchas",
        "",
        "Nothing recorded yet.",
      ].join("\n"),
      identity: makeIdentity(),
    });

    await writeRepoFile(kb, {
      rel: "tooling/vastai.md",
      content: [
        "# Vast.ai",
        "",
        "## Wanted",
        "",
        "Nothing recorded yet. Add feature requests here.",
      ].join("\n"),
      identity: makeIdentity(),
    });

    const { stdout, code } = await runCli(["digest"], {
      AGENT_LORE_KB: kb,
    });
    expect(code).toBe(0);
    expect(stdout).toContain("weft/inputs.md");
    expect(stdout).toContain("Support nested asset references");
    expect(stdout).not.toContain("tooling/vastai.md");
  });

  it("prints a summary when nothing qualifies", async () => {
    await writeRepoFile(kb, {
      rel: "notes/empty.md",
      content: [
        "# Empty",
        "",
        "## Wanted",
        "",
        "Nothing recorded yet. Add feature requests here.",
      ].join("\n"),
      identity: makeIdentity(),
    });

    const { stdout, code } = await runCli(["digest"], {
      AGENT_LORE_KB: kb,
    });
    expect(code).toBe(0);
    expect(stdout).toContain("No qualifying sections");
  });

  it("honors --sections override", async () => {
    await writeRepoFile(kb, {
      rel: "weft/inputs.md",
      content: [
        "# Weft Inputs",
        "",
        "## Wanted",
        "",
        "Nothing recorded yet.",
        "",
        "## Custom Section",
        "",
        "Has content.",
      ].join("\n"),
      identity: makeIdentity(),
    });

    const { stdout, code } = await runCli(
      ["digest", "--sections", "Custom Section"],
      { AGENT_LORE_KB: kb },
    );
    expect(code).toBe(0);
    expect(stdout).toContain("Has content");
    expect(stdout).not.toContain("Nothing recorded yet");
  });
});
