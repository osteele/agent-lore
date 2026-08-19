import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  PatchAnchorError,
  appendTalk,
  editRepoFiles,
  ensureLedger,
  findRenamedTo,
  globRepo,
  initRepo,
  logRepo,
  moveRepoFile,
  readRepoFile,
  searchRepo,
  writeRepoFile,
} from "./gitrepo.ts";
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

describe("gitrepo", () => {
  let tmp: string;
  let kb: string;

  beforeEach(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lore-gitrepo-"));
    kb = path.join(tmp, "kb");
    await initRepo(kb);
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  describe("initRepo", () => {
    it("creates a kb with README and initial commit", async () => {
      expect(fs.existsSync(path.join(kb, "README.md"))).toBe(true);
      const log = await git(kb, "log", "--pretty=format:%s");
      expect(log).toContain("initial commit");
    });
  });

  describe("writeRepoFile", () => {
    it("writes a new page and commits", async () => {
      const result = await writeRepoFile(kb, {
        rel: "notes/weft.md",
        content: "# Weft\n\nDetails.\n",
        identity: makeIdentity(),
        cwd: "/tmp/project",
      });
      expect(fs.existsSync(path.join(kb, "notes/weft.md"))).toBe(true);
      expect(result.hash).toMatch(/^[0-9a-f]{40}$/);

      const log = await git(kb, "log", "-1", "--pretty=format:%s%n%b");
      expect(log).toContain("write notes/weft.md");
      expect(log).toContain("Lore-Session: test-123");
      expect(log).toContain("Lore-Client: unknown");
      expect(log).toContain("Lore-Project: /tmp/project");
    });

    it("reports dangling wikilinks", async () => {
      const result = await writeRepoFile(kb, {
        rel: "a.md",
        content: "See [[missing/topic]].",
        identity: makeIdentity(),
      });
      expect(result.dangling).toEqual(["missing/topic"]);
    });

    it("rejects sessions/ paths", async () => {
      await expect(
        writeRepoFile(kb, {
          rel: "sessions/hacked.md",
          content: "x",
          identity: makeIdentity(),
        }),
      ).rejects.toThrow();
    });

    it("rejects sessions/ edits even under raw path spellings", async () => {
      await expect(
        editRepoFiles(kb, {
          edits: [
            {
              path: "./sessions/hacked.md",
              old_string: "a",
              new_string: "b",
            },
          ],
          identity: makeIdentity(),
        }),
      ).rejects.toThrow(/server-owned/);
    });

    it("rejects absolute paths", async () => {
      await expect(
        writeRepoFile(kb, {
          rel: "/etc/passwd",
          content: "x",
          identity: makeIdentity(),
        }),
      ).rejects.toThrow();
    });

    it("rejects paths escaping via ..", async () => {
      await expect(
        writeRepoFile(kb, {
          rel: "../secret.md",
          content: "x",
          identity: makeIdentity(),
        }),
      ).rejects.toThrow();
    });
  });

  describe("editRepoFiles", () => {
    it("applies a valid patch set", async () => {
      await writeRepoFile(kb, {
        rel: "a.md",
        content: "alpha beta gamma",
        identity: makeIdentity(),
      });
      const result = await editRepoFiles(kb, {
        edits: [{ path: "a.md", old_string: "beta", new_string: "BETA" }],
        identity: makeIdentity(),
      });
      const content = await readRepoFile(kb, "a.md");
      expect(content).toBe("alpha BETA gamma");
      expect(result.hash).toBeTruthy();
    });

    it("rejects the whole set when one anchor fails", async () => {
      await writeRepoFile(kb, {
        rel: "a.md",
        content: "alpha beta",
        identity: makeIdentity(),
      });
      await writeRepoFile(kb, {
        rel: "b.md",
        content: "one two",
        identity: makeIdentity(),
      });

      await expect(
        editRepoFiles(kb, {
          edits: [
            { path: "a.md", old_string: "beta", new_string: "BETA" },
            { path: "b.md", old_string: "missing", new_string: "x" },
          ],
          identity: makeIdentity(),
        }),
      ).rejects.toThrow(PatchAnchorError);

      // No partial application: a.md must remain unchanged.
      const content = await readRepoFile(kb, "a.md");
      expect(content).toBe("alpha beta");
    });
  });

  describe("appendTalk", () => {
    it("creates a talk page and appends a signed entry", async () => {
      const { formatTalkEntry } = await import("./talk.ts");
      const entry = formatTalkEntry(
        "weft/inputs",
        "test-session",
        new Date().toISOString(),
        "Question about inputs.",
      );
      const result = await appendTalk(kb, {
        topic: "weft/inputs",
        message: "Question about inputs.",
        entry,
        identity: makeIdentity("test-session", "sid"),
      });
      const talkPath = path.join(kb, "weft/inputs.talk.md");
      expect(fs.existsSync(talkPath)).toBe(true);
      const content = fs.readFileSync(talkPath, "utf-8");
      expect(content).toContain("# Talk: weft/inputs");
      expect(content).toContain("## ");
      expect(content).toContain("[[sessions/test-session]]");
      expect(content).toContain("Question about inputs.");
      expect(result.hash).toBeTruthy();
    });
  });

  describe("foreign-dirt sweep", () => {
    it("commits external changes as unattributed before a write", async () => {
      fs.writeFileSync(path.join(kb, "dirty.md"), "external edit", "utf-8");
      await git(kb, "add", "dirty.md");

      const result = await writeRepoFile(kb, {
        rel: "clean.md",
        content: "from lore",
        identity: makeIdentity("writer", "w-1"),
      });

      const log = await git(kb, "log", "--pretty=format:%an|%ae|%s");
      const lines = log.split("\n");
      expect(lines[0]).toContain("write clean.md");
      const [authorName, authorEmail, subject] = lines[1].split("|");
      expect(authorName).toBe("unattributed");
      expect(authorEmail).toBe("unattributed@agent-lore");
      expect(subject).toContain("unattributed edit");
      expect(result.hash).toBeTruthy();
    });
  });

  describe("ensureLedger", () => {
    it("creates a ledger page exactly once", async () => {
      const id = makeIdentity("ledger-test", "l-1");
      await ensureLedger(kb, {
        identity: id,
        clientName: "claude-code",
        clientVersion: "0.5.0",
        protocolVersion: "2024-11-05",
        cwd: "/tmp/project",
        loreVersion: "0.1.0",
      });

      const content = await readRepoFile(kb, "sessions/ledger-test.md");
      expect(content).toContain("sessionId: l-1");
      expect(content).toContain("client:");
      expect(content).toContain("protocolVersion: 2024-11-05");
      expect(content).toContain("First observed");

      const log = await git(kb, "log", "--pretty=format:%s");
      expect(log).toContain("ledger: first contact from ledger-test");

      // Second call is a no-op.
      await ensureLedger(kb, {
        identity: id,
        loreVersion: "0.1.0",
      });
      const content2 = await readRepoFile(kb, "sessions/ledger-test.md");
      expect(content2).toBe(content);
    });

    it("commits the ledger before the triggering write", async () => {
      const id = makeIdentity("first-contact", "fc-1");
      await ensureLedger(kb, {
        identity: id,
        loreVersion: "0.1.0",
      });
      await writeRepoFile(kb, {
        rel: "note.md",
        content: "hello",
        identity: id,
      });
      const log = await git(kb, "log", "--pretty=format:%s");
      const lines = log.split("\n");
      const ledgerIndex = lines.findIndex((l) =>
        l.includes("ledger: first contact from first-contact"),
      );
      const writeIndex = lines.findIndex((l) => l.includes("write note.md"));
      expect(writeIndex).toBeLessThan(ledgerIndex);
    });
  });

  describe("globRepo and searchRepo", () => {
    beforeEach(async () => {
      await writeRepoFile(kb, {
        rel: "note.md",
        content: "hello world",
        identity: makeIdentity(),
      });
      await writeRepoFile(kb, {
        rel: "note.talk.md",
        content: "hello talk",
        identity: makeIdentity(),
      });
      await ensureLedger(kb, {
        identity: makeIdentity("searcher", "s-1"),
        loreVersion: "0.1.0",
      });
    });

    it("excludes talk and sessions by default", async () => {
      const matches = await globRepo(kb, "**/*.md");
      expect(matches).toContain("note.md");
      expect(matches).not.toContain("note.talk.md");
      expect(matches).not.toContain("sessions/searcher.md");
    });

    it("includes talk when asked", async () => {
      const matches = await globRepo(kb, "**/*.md", true, true);
      expect(matches).toContain("note.talk.md");
      expect(matches).toContain("sessions/searcher.md");
    });

    it("excludes talk and sessions in search by default", async () => {
      const { lines } = await searchRepo(kb, "hello");
      expect(lines.some((l) => l.includes("note.md"))).toBe(true);
      expect(lines.some((l) => l.includes("note.talk.md"))).toBe(false);
      expect(lines.some((l) => l.includes("sessions/searcher.md"))).toBe(false);
    });
  });

  describe("moveRepoFile", () => {
    it("moves a page and records it as a rename", async () => {
      await writeRepoFile(kb, {
        rel: "foo.md",
        content: "# Foo\n",
        identity: makeIdentity(),
      });
      const result = await moveRepoFile(kb, {
        from: "foo.md",
        to: "bar.md",
        identity: makeIdentity("mover", "m-1"),
      });
      expect(fs.existsSync(path.join(kb, "bar.md"))).toBe(true);
      expect(fs.existsSync(path.join(kb, "foo.md"))).toBe(false);
      expect(result.moved).toEqual(["bar.md"]);
      expect(result.rewritten).toBe(0);

      const status = await git(kb, "status", "--porcelain");
      expect(status).toBe("");
      const diff = await git(kb, "diff", "HEAD~1", "HEAD", "--name-status");
      expect(diff).toContain("R100");
    });

    it("moves the talk sibling in the same commit", async () => {
      await writeRepoFile(kb, {
        rel: "foo.md",
        content: "# Foo\n",
        identity: makeIdentity(),
      });
      await appendTalk(kb, {
        topic: "foo",
        message: "note",
        entry: "entry",
        identity: makeIdentity(),
      });
      const result = await moveRepoFile(kb, {
        from: "foo.md",
        to: "bar.md",
        identity: makeIdentity("mover", "m-1"),
      });
      expect(result.moved).toContain("bar.md");
      expect(result.moved).toContain("bar.talk.md");
      expect(fs.existsSync(path.join(kb, "bar.talk.md"))).toBe(true);
      expect(fs.existsSync(path.join(kb, "foo.talk.md"))).toBe(false);

      const log = await git(kb, "log", "-1", "--pretty=format:%s");
      expect(log).toContain("move foo.md -> bar.md");
    });

    it("rewrites inbound wikilinks in a third page", async () => {
      await writeRepoFile(kb, {
        rel: "foo.md",
        content: "# Foo\n",
        identity: makeIdentity(),
      });
      await writeRepoFile(kb, {
        rel: "index.md",
        content: "See [[foo|the foo page]].",
        identity: makeIdentity(),
      });
      const result = await moveRepoFile(kb, {
        from: "foo.md",
        to: "bar.md",
        identity: makeIdentity("mover", "m-1"),
      });
      expect(result.rewritten).toBe(1);
      const content = await readRepoFile(kb, "index.md");
      expect(content).toBe("See [[bar|the foo page]].");
    });

    it("refuses a sessions/ source", async () => {
      await expect(
        moveRepoFile(kb, {
          from: "sessions/foo.md",
          to: "bar.md",
          identity: makeIdentity(),
        }),
      ).rejects.toThrow(/server-owned/);
    });

    it("refuses a sessions/ destination", async () => {
      await writeRepoFile(kb, {
        rel: "foo.md",
        content: "x",
        identity: makeIdentity(),
      });
      await expect(
        moveRepoFile(kb, {
          from: "foo.md",
          to: "sessions/bar.md",
          identity: makeIdentity(),
        }),
      ).rejects.toThrow(/server-owned/);
    });

    it("refuses a missing source", async () => {
      await expect(
        moveRepoFile(kb, {
          from: "foo.md",
          to: "bar.md",
          identity: makeIdentity(),
        }),
      ).rejects.toThrow(/Source does not exist/);
    });

    it("refuses an existing destination", async () => {
      await writeRepoFile(kb, {
        rel: "foo.md",
        content: "x",
        identity: makeIdentity(),
      });
      await writeRepoFile(kb, {
        rel: "bar.md",
        content: "y",
        identity: makeIdentity(),
      });
      await expect(
        moveRepoFile(kb, {
          from: "foo.md",
          to: "bar.md",
          identity: makeIdentity(),
        }),
      ).rejects.toThrow(/Destination already exists/);
    });
  });

  describe("findRenamedTo", () => {
    it("returns the current path when a file was renamed", async () => {
      await writeRepoFile(kb, {
        rel: "foo.md",
        content: "# Foo\n",
        identity: makeIdentity(),
      });
      await moveRepoFile(kb, {
        from: "foo.md",
        to: "bar.md",
        identity: makeIdentity(),
      });
      const renamed = await findRenamedTo(kb, "foo.md");
      expect(renamed).toBe("bar.md");
    });

    it("returns undefined when no rename exists", async () => {
      await writeRepoFile(kb, {
        rel: "foo.md",
        content: "# Foo\n",
        identity: makeIdentity(),
      });
      const renamed = await findRenamedTo(kb, "foo.md");
      expect(renamed).toBeUndefined();
    });
  });

  describe("dangling wikilink reporting", () => {
    it("reports only newly introduced dangling links", async () => {
      await writeRepoFile(kb, {
        rel: "existing.md",
        content: "[[old-dangle]]",
        identity: makeIdentity(),
      });
      const first = await editRepoFiles(kb, {
        edits: [
          {
            path: "existing.md",
            old_string: "[[old-dangle]]",
            new_string: "[[old-dangle]] [[new-dangle]]",
          },
        ],
        identity: makeIdentity(),
      });
      expect(first.dangling).toEqual(["new-dangle"]);
    });

    it("reports a skill-named dangling link with the skill message", async () => {
      const skillDir = path.join(tmp, "skills");
      fs.mkdirSync(path.join(skillDir, "opencode"), { recursive: true });
      const prev = process.env.AGENT_LORE_SKILL_DIRS;
      process.env.AGENT_LORE_SKILL_DIRS = skillDir;
      try {
        const result = await writeRepoFile(kb, {
          rel: "tools.md",
          content: "Use [[tools/opencode]] for coding.",
          identity: makeIdentity(),
        });
        // The skill note is not a topic worth writing, so it stays out of
        // the dangling list and travels on its own channel.
        expect(result.dangling).toHaveLength(0);
        expect(result.notes).toHaveLength(1);
        expect(result.notes[0]).toContain("opencode");
        expect(result.notes[0]).toContain("installed skill");
      } finally {
        if (prev === undefined) {
          Reflect.deleteProperty(process.env, "AGENT_LORE_SKILL_DIRS");
        } else {
          process.env.AGENT_LORE_SKILL_DIRS = prev;
        }
      }
    });
  });
});
