---
status: accepted
date: 2026-08-17
---

# 0002. Invoke the real git binary, and keep the repo outside every jj tree

## Context and Problem Statement

This machine puts a `git` shadow first on `PATH`
(`agent-command-guards/shadows/git`). For any path under a `.jj` directory the
shadow rewrites git into jj: `git add` exits 0 **without staging anything**
(jj auto-tracks), `git commit` becomes `jj commit` and rejects git-only flags
such as `--no-verify`, and read commands are re-pointed at the jj backing
store through a synthetic ref. The shadow walks *up* from its target, so a
plain git repo nested anywhere inside a jj working copy is still shadowed.

The knowledge repo's original default location was `~/.claude/agent-lore/kb`,
and `~/.claude` is itself a jj repo. The first real write failed there — but
the failure mode that matters is the quieter one: staging silently doing
nothing while the tool believes it has staged.

## Decision Outcome

The write pipeline invokes a real git binary — `AGENT_LORE_GIT` if set, else
`/usr/bin/git`, falling back to `git` — rather than whatever `git` resolves to
on `PATH`. The default knowledge repo lives at `~/.local/share/agent-lore/kb`,
outside every jj working copy on this machine.

Both halves are needed. The explicit binary protects a repo that ends up under
a jj tree anyway; the default location keeps a correctly-configured install
away from the hazard entirely.

### Consequences

- `AGENT_LORE_KB` pointing inside a jj working copy is a supported
  configuration only because of the explicit binary; it is still not
  recommended, and the README says so.
- A hardcoded `/usr/bin/git` is unusual and looks like something to tidy up
  into a bare `git`. It is not: that change reintroduces the silent-staging
  failure on this machine and on any machine with a comparable wrapper.
- Tests spawn a bare `git` for assertions. That is safe only because they run
  in temp directories outside any jj tree, and it is why they do not exercise
  this decision. The shim behavior is recorded as lore rather than as a test.
- Nothing here depends on jj being absent — only on not routing this tool's
  plumbing through a wrapper that reinterprets it.
