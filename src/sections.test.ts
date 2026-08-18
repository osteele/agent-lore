import { describe, expect, it } from "bun:test";
import {
  findSection,
  headingForLine,
  numberLines,
  parseSections,
  renderToc,
  slugify,
} from "./sections.ts";

const PAGE = [
  "# weft inputs", // 1
  "", // 2
  "Intro line.", // 3
  "", // 4
  "## checkpoint inputs", // 5
  "", // 6
  "A placement hint.", // 7
  "", // 8
  "### detail", // 9
  "", // 10
  "Nested content.", // 11
  "", // 12
  "## hf prefixes", // 13
  "", // 14
  "Auto-corrected.", // 15
].join("\n");

describe("parseSections", () => {
  it("finds headings with levels and line ranges", () => {
    const sections = parseSections(PAGE);
    expect(sections.map((s) => s.heading)).toEqual([
      "weft inputs",
      "checkpoint inputs",
      "detail",
      "hf prefixes",
    ]);
    expect(sections[0].level).toBe(1);
    expect(sections[0].startLine).toBe(1);
  });

  it("includes subsections in a section's range", () => {
    const sections = parseSections(PAGE);
    const checkpoint = sections[1];
    expect(checkpoint.startLine).toBe(5);
    // Runs through the nested "### detail" and stops before "## hf prefixes".
    expect(checkpoint.endLine).toBe(12);
  });

  it("runs the last section to the end of the page", () => {
    const sections = parseSections(PAGE);
    expect(sections[3].endLine).toBe(15);
  });

  it("ignores headings inside fenced code blocks", () => {
    const content = [
      "# real",
      "",
      "```sh",
      "# not a heading",
      "echo hi",
      "```",
      "",
      "## also real",
    ].join("\n");
    expect(parseSections(content).map((s) => s.heading)).toEqual([
      "real",
      "also real",
    ]);
  });

  it("returns nothing for a page with no headings", () => {
    expect(parseSections("just prose\nmore prose")).toEqual([]);
  });
});

describe("findSection", () => {
  const sections = parseSections(PAGE);

  it("matches an exact heading", () => {
    expect(findSection(sections, "checkpoint inputs")?.startLine).toBe(5);
  });

  it("matches case-insensitively and tolerates leading hashes", () => {
    expect(findSection(sections, "## Checkpoint Inputs")?.startLine).toBe(5);
  });

  it("matches a slug", () => {
    expect(findSection(sections, "checkpoint-inputs")?.startLine).toBe(5);
  });

  it("matches a prefix", () => {
    expect(findSection(sections, "checkpoint")?.startLine).toBe(5);
  });

  it("matches a substring", () => {
    expect(findSection(sections, "prefixes")?.startLine).toBe(13);
  });

  it("returns undefined for no match", () => {
    expect(findSection(sections, "nonexistent")).toBeUndefined();
  });

  it("returns undefined for an empty query", () => {
    expect(findSection(sections, "   ")).toBeUndefined();
  });
});

describe("headingForLine", () => {
  const sections = parseSections(PAGE);

  it("returns the innermost enclosing heading", () => {
    expect(headingForLine(sections, 11)).toBe("detail");
    expect(headingForLine(sections, 7)).toBe("checkpoint inputs");
    expect(headingForLine(sections, 3)).toBe("weft inputs");
  });

  it("returns undefined above the first heading", () => {
    const sections2 = parseSections("intro\n\n# later");
    expect(headingForLine(sections2, 1)).toBeUndefined();
  });
});

describe("renderToc", () => {
  it("indents by level and shows line ranges", () => {
    const toc = renderToc(parseSections(PAGE));
    expect(toc).toContain("# weft inputs (lines 1-15)");
    expect(toc).toContain("  ## checkpoint inputs (lines 5-12)");
    expect(toc).toContain("    ### detail (lines 9-12)");
  });
});

describe("numberLines", () => {
  it("preserves original 1-based line numbers", () => {
    const lines = ["a", "b", "c", "d"];
    expect(numberLines(lines, 2, 3)).toBe("2\tb\n3\tc");
  });

  it("clamps past the end of the file", () => {
    expect(numberLines(["a", "b"], 2, 99)).toBe("2\tb");
  });
});

describe("slugify", () => {
  it("lowercases and collapses non-alphanumerics", () => {
    expect(slugify("Checkpoint Inputs (2026)")).toBe("checkpoint-inputs-2026");
  });
});
