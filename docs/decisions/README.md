# Decision records

Engineering decisions that constrain agent-lore, with the alternatives that
were rejected and the consequences that follow. The format matches
`../../../agent-mail/docs/decisions/`.

A record belongs here when a future reader could reasonably undo the decision
by mistake — because the rule looks arbitrary, looks like an unfinished
feature, or looks like a safe simplification.

Records are immutable once accepted. A change of position is a new record that
names the one it supersedes.

| # | Decision | Adopted |
|---|---|---|
| [0001](0001-access-log-outside-the-repo.md) | Read-side analytics stay out of the knowledge repo | 2026-08-17 |
| [0002](0002-real-git-outside-jj.md) | Invoke the real git binary, and keep the repo outside every jj tree | 2026-08-17 |
| [0003](0003-anchors-are-the-concurrency-control.md) | Edit anchors are the concurrency control; no version tokens | 2026-08-17 |
| [0004](0004-tools-mirror-the-harness.md) | Tool shapes mirror the harness file tools | 2026-08-17 |
