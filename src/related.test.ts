import { describe, expect, it } from "bun:test";
import { findRelated } from "./related.ts";

const EXISTING = [
  "tooling/agent-review.md",
  "tooling/weft.md",
  "tooling/vastai.md",
  "weft/inputs.md",
  "weft/outputs.md",
  "weft/checkpoints.md",
  "notes/llm-training.md",
  "notes/obsidian.md",
  "notes/workflow.md",
  "notes/retrieval.md",
];

describe("findRelated", () => {
  it("returns namespace-prefix for tools/x.md against tooling/*", () => {
    const findings = findRelated("tools/x.md", EXISTING);
    expect(findings).toHaveLength(1);
    expect(findings[0].kind).toBe("namespace-prefix");
    expect(findings[0].message).toContain("tools");
    expect(findings[0].message).toContain("tooling/");
    expect(findings[0].message).toContain("3 pages");
    expect(findings[0].paths).toEqual([
      "tooling/agent-review.md",
      "tooling/vastai.md",
      "tooling/weft.md",
    ]);
  });

  it("returns directory-shadows-page for agent-review/entity-graph.md", () => {
    const findings = findRelated("agent-review/entity-graph.md", EXISTING);
    const shadow = findings.find((f) => f.kind === "directory-shadows-page");
    expect(shadow).toBeDefined();
    if (shadow === undefined)
      throw new Error("expected directory-shadows-page");
    expect(shadow.message).toContain("tooling/agent-review.md");
    expect(shadow.paths).toEqual(["tooling/agent-review.md"]);
  });

  it("returns similar-topic on token overlap", () => {
    const findings = findRelated("weft-inputs.md", EXISTING);
    const similar = findings.find((f) => f.kind === "similar-topic");
    expect(similar).toBeDefined();
    if (similar === undefined) throw new Error("expected similar-topic");
    expect(similar.paths).toContain("weft/inputs.md");
  });

  it("requires at least 2 shared tokens for common terms", () => {
    // "weft" appears in 4 existing pages, so a single shared token is not enough.
    const findings = findRelated("weft-summary.md", EXISTING);
    const similar = findings.find((f) => f.kind === "similar-topic");
    expect(similar).toBeUndefined();
  });

  it("includes a distinctive single shared token", () => {
    // "vastai" appears in only 1 existing page.
    const findings = findRelated("vastai-notes.md", EXISTING);
    const similar = findings.find((f) => f.kind === "similar-topic");
    expect(similar).toBeDefined();
    if (similar === undefined) throw new Error("expected similar-topic");
    expect(similar.paths).toEqual(["tooling/vastai.md"]);
  });

  it("caps similar-topic at 5 paths", () => {
    const many = [
      "topic/alpha-beta-1.md",
      "topic/alpha-beta-2.md",
      "topic/alpha-beta-3.md",
      "topic/alpha-beta-4.md",
      "topic/alpha-beta-5.md",
      "topic/alpha-beta-6.md",
    ];
    const findings = findRelated("alpha-beta-guide.md", many);
    const similar = findings.find((f) => f.kind === "similar-topic");
    expect(similar).toBeDefined();
    if (similar === undefined) throw new Error("expected similar-topic");
    expect(similar.paths.length).toBe(5);
  });

  it("deduplicates similar-topic against higher-priority findings", () => {
    const findings = findRelated("agent-review/entity-graph.md", EXISTING);
    const shadow = findings.find((f) => f.kind === "directory-shadows-page");
    expect(shadow).toBeDefined();
    const similar = findings.find((f) => f.kind === "similar-topic");
    if (similar) {
      expect(similar.paths).not.toContain("tooling/agent-review.md");
    }
  });

  it("returns an empty array for an unrelated new path", () => {
    expect(findRelated("completely/unrelated-page.md", EXISTING)).toEqual([]);
  });

  it("splits a multi-word title into separately matchable tokens", () => {
    // The path shares no token with any existing page; only the title does,
    // so this fails if a title is treated as one unsplit token.
    const findings = findRelated(
      "scratch/scratchpad.md",
      EXISTING,
      "weft checkpoints",
    );
    const similar = findings.find((f) => f.kind === "similar-topic");
    expect(similar).toBeDefined();
    if (similar === undefined) throw new Error("expected similar-topic");
    expect(similar.paths).toContain("weft/checkpoints.md");
  });

  it("includes title tokens in similar-topic matching", () => {
    const findings = findRelated("kb/inputs.md", EXISTING, "weft inputs");
    const similar = findings.find((f) => f.kind === "similar-topic");
    expect(similar).toBeDefined();
    if (similar === undefined) throw new Error("expected similar-topic");
    expect(similar.paths).toContain("weft/inputs.md");
  });
});
