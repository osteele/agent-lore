import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  type AccessEvent,
  accessLogPath,
  readAccessEvents,
  recordAccess,
  summarize,
} from "./access.ts";

function event(overrides: Partial<AccessEvent>): AccessEvent {
  return {
    ts: new Date().toISOString(),
    session: "s-1",
    name: "test-session",
    tool: "lore_read",
    results: 1,
    ...overrides,
  };
}

describe("access log", () => {
  let tmp: string;
  let kb: string;
  let origOverride: string | undefined;
  let origDisabled: string | undefined;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lore-access-"));
    kb = path.join(tmp, "kb");
    fs.mkdirSync(kb, { recursive: true });
    origOverride = process.env.AGENT_LORE_ACCESS_LOG;
    origDisabled = process.env.AGENT_LORE_NO_ANALYTICS;
    Reflect.deleteProperty(process.env, "AGENT_LORE_ACCESS_LOG");
    Reflect.deleteProperty(process.env, "AGENT_LORE_NO_ANALYTICS");
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
    if (origOverride !== undefined)
      process.env.AGENT_LORE_ACCESS_LOG = origOverride;
    else Reflect.deleteProperty(process.env, "AGENT_LORE_ACCESS_LOG");
    if (origDisabled !== undefined)
      process.env.AGENT_LORE_NO_ANALYTICS = origDisabled;
    else Reflect.deleteProperty(process.env, "AGENT_LORE_NO_ANALYTICS");
  });

  it("writes outside the knowledge repo", () => {
    const target = accessLogPath(kb);
    expect(target.startsWith(`${kb}${path.sep}`)).toBe(false);
    recordAccess(kb, event({ path: "a.md" }));
    expect(fs.existsSync(target)).toBe(true);
    // The repo itself must stay untouched by a read.
    expect(fs.readdirSync(kb)).toEqual([]);
  });

  it("appends one JSON line per event", () => {
    recordAccess(kb, event({ path: "a.md" }));
    recordAccess(kb, event({ tool: "lore_search", query: "x", results: 0 }));
    const raw = fs.readFileSync(accessLogPath(kb), "utf-8").trim();
    expect(raw.split("\n")).toHaveLength(2);
  });

  it("honors the off switch", () => {
    process.env.AGENT_LORE_NO_ANALYTICS = "1";
    recordAccess(kb, event({ path: "a.md" }));
    expect(fs.existsSync(accessLogPath(kb))).toBe(false);
  });

  it("filters by time when reading", () => {
    recordAccess(
      kb,
      event({ ts: new Date(Date.now() - 86_400_000 * 5).toISOString() }),
    );
    recordAccess(kb, event({}));
    const recent = readAccessEvents(kb, Date.now() - 86_400_000);
    expect(recent.events).toHaveLength(1);
  });

  it("counts unparseable lines instead of dropping them silently", () => {
    recordAccess(kb, event({ path: "a.md" }));
    fs.appendFileSync(accessLogPath(kb), '{"ts":"broken\n', "utf-8");
    const result = readAccessEvents(kb);
    expect(result.events).toHaveLength(1);
    expect(result.unparseable).toBe(1);
  });
});

describe("summarize", () => {
  it("ranks zero-result queries by frequency", () => {
    const result = {
      events: [
        event({ tool: "lore_search", query: "mutagen", results: 0 }),
        event({ tool: "lore_search", query: "mutagen", results: 0 }),
        event({ tool: "lore_search", query: "vastai", results: 0 }),
        event({ tool: "lore_search", query: "weft", results: 3 }),
      ],
      unparseable: 0,
    };
    const summary = summarize(result);
    expect(summary.zeroResult[0]).toEqual({
      tool: "lore_search",
      query: "mutagen",
      count: 2,
    });
    expect(summary.zeroResult).toHaveLength(2);
  });

  it("counts a missed section as a zero-result event", () => {
    const summary = summarize({
      events: [
        event({ path: "weft/inputs.md", section: "placement", results: 0 }),
      ],
      unparseable: 0,
    });
    expect(summary.zeroResult[0].query).toBe("weft/inputs.md § placement");
  });

  it("counts reads per page and ignores misses in the page tally", () => {
    const summary = summarize({
      events: [
        event({ path: "a.md", results: 10 }),
        event({ path: "a.md", results: 10 }),
        event({ path: "b.md", results: 4 }),
        event({ path: "gone.md", results: 0 }),
      ],
      unparseable: 0,
    });
    expect(summary.topPages[0]).toEqual({ path: "a.md", reads: 2 });
    expect(summary.readPaths.has("gone.md")).toBe(false);
  });

  it("counts distinct sessions", () => {
    const summary = summarize({
      events: [
        event({ session: "s-1" }),
        event({ session: "s-2" }),
        event({ session: "s-1" }),
      ],
      unparseable: 0,
    });
    expect(summary.sessions).toBe(2);
  });
});
