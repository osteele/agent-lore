import { describe, expect, it } from "bun:test";
import { formatTalkEntry, formatTalkPage, normalizeTalkTopic } from "./talk.ts";

describe("normalizeTalkTopic", () => {
  it("accepts the note path with or without .md, and the talk page path", () => {
    expect(normalizeTalkTopic("weft/inputs")).toBe("weft/inputs");
    expect(normalizeTalkTopic("weft/inputs.md")).toBe("weft/inputs");
    expect(normalizeTalkTopic("weft/inputs.talk")).toBe("weft/inputs");
    expect(normalizeTalkTopic("weft/inputs.talk.md")).toBe("weft/inputs");
  });
});

describe("formatTalkPage", () => {
  it("creates an H1 for the topic", () => {
    expect(formatTalkPage("weft/inputs")).toBe("# Talk: weft/inputs\n");
  });
});

describe("formatTalkEntry", () => {
  it("formats a signed entry", () => {
    const entry = formatTalkEntry(
      "weft/inputs",
      "session-abc123",
      "2024-01-15T10:00:00.000Z",
      "This is my message.\nWith two lines.",
    );
    expect(entry).toContain(
      "## 2024-01-15T10:00:00.000Z — [[sessions/session-abc123]]",
    );
    expect(entry).toContain("This is my message.\nWith two lines.");
    expect(entry.startsWith("\n")).toBe(true);
  });
});
