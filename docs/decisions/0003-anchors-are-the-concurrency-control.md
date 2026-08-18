---
status: accepted
date: 2026-08-17
---

# 0003. Edit anchors are the concurrency control; no version tokens

## Context and Problem Statement

Several sessions across several harnesses write to one knowledge repo
concurrently. Read it, edit it, and two agents can clobber each other — the
standard motivation for optimistic concurrency control with an explicit
version: return an ETag or revision with each read, require it on write,
reject on mismatch.

The tools deliberately mirror the harness file tools, so an edit is already
`{path, old_string, new_string}`: a literal anchor plus its replacement.

## Decision Outcome

Do not add version tokens, ETags, or revision numbers. The `old_string` anchor
*is* the concurrency check: it is validated against current file content under
the write lock, and a patch set whose anchor no longer matches is rejected in
full.

This is not a weaker substitute for versioning; on this data it is a stronger
check with a better failure mode. A version token detects that a file changed;
an anchor detects that *the text this edit depends on* changed — so two agents
editing different sections of one page both succeed, where versioning would
fail the second one spuriously. And the failure is already familiar: agents
recover from a failed anchor by re-reading and re-anchoring many times a day.

### Consequences

- Rejection is all-or-nothing across a patch set. Partial application would
  leave the repo in a state no agent intended, and no version scheme fixes
  that.
- A failed anchor must return enough surrounding content to re-anchor against,
  or the mechanism costs a round trip and teaches nothing. The failure report
  carries the closest matching region.
- Two agents replacing the *same* text still race, and the loser's anchor
  fails. That is correct: they disagree about that text, which is what the
  talk page is for.
- Whole-file replacement (`lore_write`) has no anchor and therefore no check —
  it is last-writer-wins by construction. Git history is the recovery path.
- Anything that later needs true serialization (a rename across many pages,
  say) needs a different mechanism; do not retrofit versions onto edits to get
  it.
