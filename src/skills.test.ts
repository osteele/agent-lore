import { afterEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { listSkillNames, skillForTarget } from "./skills.ts";

describe("skillForTarget", () => {
  it("matches a skill named by the last path segment", () => {
    const names = new Set(["opencode"]);
    expect(skillForTarget("tools/opencode", names)).toBe("opencode");
  });

  it("matches a top-level target that is a skill name", () => {
    const names = new Set(["opencode"]);
    expect(skillForTarget("opencode", names)).toBe("opencode");
  });

  it("returns undefined when the last segment is not a skill", () => {
    const names = new Set(["opencode"]);
    expect(skillForTarget("tools/vastai", names)).toBeUndefined();
  });

  it("returns undefined when the name set is empty", () => {
    expect(skillForTarget("tools/opencode", new Set())).toBeUndefined();
  });
});

describe("resolveSkillDirs via AGENT_LORE_SKILL_DIRS", () => {
  const previous = process.env.AGENT_LORE_SKILL_DIRS;

  afterEach(() => {
    if (previous === undefined) {
      Reflect.deleteProperty(process.env, "AGENT_LORE_SKILL_DIRS");
    } else {
      process.env.AGENT_LORE_SKILL_DIRS = previous;
    }
  });

  it("splits on the platform delimiter, so a Windows drive letter survives", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lore-skills-"));
    const a = path.join(tmp, "a");
    const b = path.join(tmp, "b");
    fs.mkdirSync(path.join(a, "alpha"), { recursive: true });
    fs.mkdirSync(path.join(b, "beta"), { recursive: true });
    process.env.AGENT_LORE_SKILL_DIRS = [a, b].join(path.delimiter);
    try {
      const names = await listSkillNames();
      expect(names.has("alpha")).toBe(true);
      expect(names.has("beta")).toBe(true);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
