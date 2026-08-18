---
status: accepted
date: 2026-08-17
---

# 0001. Read-side analytics stay out of the knowledge repo

## Context and Problem Statement

Writes are recorded as git commits, which is the whole provenance mechanism:
`git blame` says who claimed a fact and `git log <page>` is the page's change
history. Reads and searches leave no trace, so nothing shows which pages are
actually relied on, and nothing shows what agents looked for and failed to
find.

The obvious way to close that gap is to record reads the same way writes are
recorded — in the repo, where everything else lives. That unification is
wrong, and wrong in a way that only shows up after it has run for a while.

## Decision Outcome

Read and search events append to a JSONL file **outside** the knowledge repo
(`AGENT_LORE_ACCESS_LOG`, else `<parent of kb>/access.jsonl`). The write
pipeline never sees them, and no read produces a commit.

Two properties are load-bearing rather than incidental:

- Read events are high-frequency and individually low-value. In the repo they
  would swamp the commit history that provenance depends on: `git log` on a
  page must remain a list of changes to that page.
- Appends are lock-free. Writes serialize through a per-repo `mkdir` lock;
  reads must never contend on it, or consulting the knowledge base becomes as
  expensive as editing it. A single small `appendFileSync` under `O_APPEND`
  interleaves whole lines between concurrent sessions, which is sufficient
  because each line is independent.

### Consequences

- Cloning the knowledge repo does not carry its usage history. That is
  accepted: the repo is the knowledge, the log is operational telemetry about
  one machine.
- A crash mid-append can truncate the last line. The reader counts
  unparseable lines and reports the count rather than skipping them silently.
- `results: 0` rows are the point of the mechanism, not a byproduct: a search
  that matched nothing, a page that does not exist, and a section request that
  did not match are each a topic gap stated in an agent's own words.
- The log grows without bound, so it rotates to `.1` past 8 MB, checked once
  per process. There is no compaction and no retention policy beyond that.
- Anything wanting durable, reviewable read history would need a different
  mechanism; do not reach for the git repo to get it.
