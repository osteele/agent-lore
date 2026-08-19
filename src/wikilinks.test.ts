import { describe, expect, it } from "bun:test";
import { extractWikilinks, rewriteWikilinks } from "./wikilinks.ts";

describe("extractWikilinks", () => {
  it("extracts simple wikilinks", () => {
    expect(extractWikilinks("See [[foo]] and [[bar/baz]].")).toEqual([
      "foo",
      "bar/baz",
    ]);
  });

  it("deduplicates while preserving first-seen order", () => {
    expect(extractWikilinks("[[foo]] [[foo]] [[bar]] [[foo]]")).toEqual([
      "foo",
      "bar",
    ]);
  });

  it("strips display aliases", () => {
    expect(extractWikilinks("[[target|display text]]")).toEqual(["target"]);
  });

  it("ignores empty links", () => {
    expect(extractWikilinks("[[]] [[real]]")).toEqual(["real"]);
  });

  it("returns an empty array when there are no links", () => {
    expect(extractWikilinks("plain text")).toEqual([]);
  });
});

describe("rewriteWikilinks", () => {
  it("rewrites a plain wikilink", () => {
    expect(rewriteWikilinks("See [[foo]] here.", "foo", "bar")).toBe(
      "See [[bar]] here.",
    );
  });

  it("preserves display aliases", () => {
    expect(rewriteWikilinks("See [[foo|display]] here.", "foo", "bar")).toBe(
      "See [[bar|display]] here.",
    );
  });

  it("rewrites multiple occurrences", () => {
    expect(rewriteWikilinks("[[foo]] and [[foo|x]]", "foo", "bar")).toBe(
      "[[bar]] and [[bar|x]]",
    );
  });

  it("leaves other links alone", () => {
    expect(rewriteWikilinks("[[foo]] [[foobar]] [[foo2]]", "foo", "bar")).toBe(
      "[[bar]] [[foobar]] [[foo2]]",
    );
  });

  it("leaves aliased links to other targets alone", () => {
    expect(rewriteWikilinks("[[other|foo]]", "foo", "bar")).toBe(
      "[[other|foo]]",
    );
  });

  it("handles nested paths", () => {
    expect(rewriteWikilinks("[[tools/foo]]", "tools/foo", "tooling/foo")).toBe(
      "[[tooling/foo]]",
    );
  });
});
