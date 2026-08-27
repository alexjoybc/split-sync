---
description: Autonomously drive a GitHub milestone to completion — dispatch parallel subagents to claim, implement, review, and merge every issue until the milestone is closed.
agent: build
---

Load the `reach-milestone` skill and execute its full loop against milestone
`$ARGUMENTS` (a milestone number, e.g. `5`, or an exact milestone title in
quotes) in the current repository.

Run the loop autonomously end to end: sync, classify issues, dispatch
`milestone-worker` subagents in parallel for everything dispatchable, dispatch
`milestone-reviewer` subagents against resulting PRs, merge what's approved,
rebase/fix what's conflicting or failing CI, and repeat — without stopping to
ask for confirmation between passes. CI and this repo's build/typecheck
commands are the validation; do not add human-confirmation checkpoints the
skill doesn't call for.

Only stop early for the specific cases the skill defines as escalation
(reviewer escalation, repeated failure on the same issue, or a zero-progress
pass) — and when you do, report clearly what's open, why, and what decision is
needed.

After each pass, report the compact status table the skill specifies so
progress is visible even before the milestone fully completes.
