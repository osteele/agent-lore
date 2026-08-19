import { describe, expect, it } from "bun:test";
import { skillForTarget } from "./skills.ts";

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
