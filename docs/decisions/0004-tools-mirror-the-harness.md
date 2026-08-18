---
status: accepted
date: 2026-08-17
---

# 0004. Tool shapes mirror the harness file tools

## Context and Problem Statement

The knowledge base is only useful if agents actually use it, and every MCP
tool competes for attention with tools the agent already knows. A
purpose-built API — a structured page object, a JSON patch format, typed
sections, an `append` verb — would express the domain more precisely than
glob/grep/read/edit over markdown.

## Decision Outcome

The tools copy the argument shapes of the file tools built into agent
harnesses: `lore_glob` (pattern), `lore_search` (pattern, glob),
`lore_read` (path, offset, limit), `lore_edit` (path, `old_string`,
`new_string`, `replace_all`). Storage is plain markdown files, not records.

Agents have deep training and in-context reinforcement on exactly these
shapes — including their failure modes, like a non-unique `old_string`. A
tool that behaves the way `Edit` behaves needs no explanation and inherits
that competence; a better-designed tool would have to earn it. Two additions
are justified by domain need rather than symmetry: `lore_talk` (auto-signed
talk entries) and `lore_log` (provenance), which have no harness analogue.

### Consequences

- Additions to the surface must clear a real bar: `lore_read`'s `section`
  argument is an addition, and it is why short pages must still return whole
  in one call, exactly as `Read` would. Divergence from the harness shape is a
  cost paid for a specific benefit, not a default.
- The API will keep looking unambitious relative to what the domain would
  support. That is the intent, and "improving" it toward a structured
  page/patch model would forfeit the transfer this decision buys.
- Markdown-as-storage follows from the same reasoning and is reinforced by the
  repo being human-readable in Obsidian or an editor. Schema lives in
  conventions (talk-page siblings, section names), never in a format agents
  must learn.
- Mirroring is not imitation of harness *implementation*: the harness's
  read-before-edit tracking is not reproduced, because anchor validation
  covers the same ground (see 0003).
