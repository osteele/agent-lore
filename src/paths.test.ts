import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  PathEscapeError,
  SessionsWriteError,
  assertNotSessions,
  isSessionsPath,
  normalizeRepoPath,
  resolveRepoPath,
} from "./paths.ts";

describe("normalizeRepoPath", () => {
  it("accepts simple relative paths", () => {
    expect(normalizeRepoPath("foo.md")).toBe("foo.md");
    expect(normalizeRepoPath("foo/bar.md")).toBe("foo/bar.md");
  });

  it("collapses ./ and redundant slashes", () => {
    expect(normalizeRepoPath("./foo.md")).toBe("foo.md");
    expect(normalizeRepoPath("foo//bar.md")).toBe("foo/bar.md");
    expect(normalizeRepoPath("foo/./bar.md")).toBe("foo/bar.md");
  });

  it("rejects absolute paths", () => {
    expect(() => normalizeRepoPath("/etc/passwd")).toThrow(PathEscapeError);
  });

  it("rejects paths escaping via ..", () => {
    expect(() => normalizeRepoPath("../foo.md")).toThrow(PathEscapeError);
    expect(() => normalizeRepoPath("foo/../../bar.md")).toThrow(
      PathEscapeError,
    );
  });

  it("allows .. that stays inside the repo", () => {
    expect(normalizeRepoPath("foo/../bar.md")).toBe("bar.md");
  });

  it("rejects empty paths", () => {
    expect(() => normalizeRepoPath("")).toThrow(PathEscapeError);
    expect(() => normalizeRepoPath(".")).toThrow(PathEscapeError);
  });
});

describe("isSessionsPath", () => {
  it("identifies sessions paths", () => {
    expect(isSessionsPath("sessions/foo.md")).toBe(true);
    expect(isSessionsPath("sessions")).toBe(true);
    expect(isSessionsPath("foo.md")).toBe(false);
  });
});

describe("assertNotSessions", () => {
  it("throws for sessions paths", () => {
    expect(() =>
      assertNotSessions("sessions/foo.md", "sessions/foo.md"),
    ).toThrow(SessionsWriteError);
  });

  it("does not throw for normal paths", () => {
    expect(() => assertNotSessions("foo.md", "foo.md")).not.toThrow();
  });
});

describe("resolveRepoPath", () => {
  let tmp: string;
  let kb: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lore-paths-"));
    kb = path.join(tmp, "kb");
    fs.mkdirSync(kb, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("resolves a path inside the repo", () => {
    const { rel, abs } = resolveRepoPath("foo/bar.md", kb);
    expect(rel).toBe("foo/bar.md");
    expect(abs).toBe(path.join(fs.realpathSync(kb), "foo/bar.md"));
  });

  it("rejects a path escaping through a symlinked parent", () => {
    const outside = path.join(tmp, "outside");
    fs.mkdirSync(outside, { recursive: true });
    fs.symlinkSync(outside, path.join(kb, "link"));
    expect(() => resolveRepoPath("link/../../etc/passwd", kb)).toThrow(
      PathEscapeError,
    );
  });

  it("rejects absolute paths", () => {
    expect(() => resolveRepoPath("/etc/passwd", kb)).toThrow(PathEscapeError);
  });
});
