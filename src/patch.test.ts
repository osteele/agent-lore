import { describe, expect, it } from "bun:test";
import { type EditPatch, applyPatchSet } from "./patch.ts";

describe("applyPatchSet", () => {
  it("applies a single edit", () => {
    const current = new Map([["a.md", "hello world"]]);
    const edits: EditPatch[] = [
      { path: "a.md", old_string: "hello", new_string: "goodbye" },
    ];
    const result = applyPatchSet(current, edits);
    expect(result.ok).toBe(true);
    expect(result.applied.get("a.md")).toBe("goodbye world");
  });

  it("supports replace_all", () => {
    const current = new Map([["a.md", "foo foo foo"]]);
    const edits: EditPatch[] = [
      { path: "a.md", old_string: "foo", new_string: "bar", replace_all: true },
    ];
    const result = applyPatchSet(current, edits);
    expect(result.ok).toBe(true);
    expect(result.applied.get("a.md")).toBe("bar bar bar");
  });

  it("rejects empty old_string", () => {
    const current = new Map([["a.md", "hello"]]);
    const edits: EditPatch[] = [
      { path: "a.md", old_string: "", new_string: "x" },
    ];
    const result = applyPatchSet(current, edits);
    expect(result.ok).toBe(false);
    expect(result.failures[0].reason).toBe("empty_old_string");
  });

  it("rejects a missing anchor", () => {
    const current = new Map([["a.md", "hello world"]]);
    const edits: EditPatch[] = [
      { path: "a.md", old_string: "missing", new_string: "x" },
    ];
    const result = applyPatchSet(current, edits);
    expect(result.ok).toBe(false);
    expect(result.failures[0].reason).toBe("missing");
  });

  it("rejects multiple occurrences without replace_all", () => {
    const current = new Map([["a.md", "foo foo"]]);
    const edits: EditPatch[] = [
      { path: "a.md", old_string: "foo", new_string: "bar" },
    ];
    const result = applyPatchSet(current, edits);
    expect(result.ok).toBe(false);
    expect(result.failures[0].reason).toBe("multiple");
  });

  it("inserts replacement strings literally, including $-patterns", () => {
    const current = new Map([["a.md", "price: OLD"]]);
    const edits: EditPatch[] = [
      {
        path: "a.md",
        old_string: "OLD",
        new_string: "$& costs $` or $' or $$1",
      },
    ];
    const result = applyPatchSet(current, edits);
    expect(result.ok).toBe(true);
    expect(result.applied.get("a.md")).toBe("price: $& costs $` or $' or $$1");
  });

  it("applies multiple edits to the same file sequentially", () => {
    const current = new Map([["a.md", "one two three"]]);
    const edits: EditPatch[] = [
      { path: "a.md", old_string: "one", new_string: "1" },
      { path: "a.md", old_string: "1 two", new_string: "1 2" },
    ];
    const result = applyPatchSet(current, edits);
    expect(result.ok).toBe(true);
    expect(result.applied.get("a.md")).toBe("1 2 three");
  });

  it("rejects the whole set when one anchor fails", () => {
    const current = new Map([
      ["a.md", "hello world"],
      ["b.md", "alpha beta"],
    ]);
    const edits: EditPatch[] = [
      { path: "a.md", old_string: "hello", new_string: "goodbye" },
      { path: "b.md", old_string: "gamma", new_string: "delta" },
    ];
    const result = applyPatchSet(current, edits);
    expect(result.ok).toBe(false);
    expect(result.applied.size).toBe(0);
    expect(result.failures.length).toBe(1);
    expect(result.failures[0].path).toBe("b.md");
  });
});
