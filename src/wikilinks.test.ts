import { describe, expect, it } from "bun:test";
import { extractWikilinks } from "./wikilinks.ts";

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
