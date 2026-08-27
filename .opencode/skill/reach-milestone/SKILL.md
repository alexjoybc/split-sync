---
name: reach-milestone
description: Autonomously drive a GitHub milestone to completion by dispatching parallel subagents that claim issues, implement them in isolated git worktrees, open PRs, review each other's PRs, resolve conflicts, and merge — looping until every issue in the milestone is closed. Use when the user says "/reach-milestone", "finish milestone", "work the milestone autonomously", or asks to have subagents self-organize on a GitHub milestone.
---

# Reach Milestone

Drive every open issue in a GitHub milestone to merged-and-closed, with minimal
human intervention, by repeatedly: computing what's safe to start, dispatching
one `milestone-worker` subagent per safe issue in parallel, dispatching
`milestone-reviewer` subagents against resulting PRs, merging what passes
review, and re-running the loop until the milestone is empty or nothing more
can move.

opencode has no separate "teams" primitive. The mechanism is Task-tool
subagents (`milestone-worker`, `milestone-reviewer`) working in parallel, each
scoped to its own git worktree, coordinating through GitHub issue labels/state
as the shared source of truth — the same way multiple human-driven sessions
coordinated on this repo's actual roadmap (see `docs/adr/` and the closed
roadmap issues for precedent).

## Non-negotiable ground rules

These come directly from this repo's `AGENTS.md` and apply to every worker:

1. Every issue is implemented in its own git worktree:
   `git worktree add ../<repo>-worktrees/issue-<number>-<slug> -b issue-<number>-<slug>`.
   Never edit `main` directly, never let two issues share a worktree.
2. Verify before opening a PR with exactly what CI runs
   (`.github/workflows/ci.yml`): `pnpm --filter web lint`,
   `pnpm --filter web typecheck`, `pnpm --filter web build` for any web
   change; `pnpm --filter mobile lint`, `pnpm --filter mobile typecheck` for
   any mobile change. CI re-checks this on the PR automatically
   (`gh pr checks`) — running it locally first avoids a slow round trip.
3. Commit message / PR title references the issue (`Closes #N` when the PR
   fully resolves it).
4. Never force-push over another worker's branch, never edit files outside the
   assigned worktree, never touch a worktree that already has uncommitted
   changes from someone/something else.
5. After a PR merges and is verified, remove its worktree and delete the
   branch (`git worktree remove ...`, `git branch -D ...`).

## Label vocabulary this skill relies on

If these labels don't exist yet, create them once before starting (`gh label
create <name> --description "..." --color "..."`):

| Label | Meaning |
| --- | --- |
| `status:ready` | Unblocked, unclaimed, safe to dispatch |
| `status:in-progress` | A worker has claimed it (worktree exists and/or PR open) |
| `status:blocked` | Waiting on another issue; do not dispatch |
| `status:deferred` | Intentionally not being worked; skip entirely |
| `status:done` | Merged; used for issues GitHub doesn't auto-close cleanly |

## The loop

Repeat this whole sequence until the milestone's `open_issues` count is 0, or
until a full pass makes no progress (see "Termination" below).

### 1. Sync and inventory

```bash
git -C <repo> fetch origin
git -C <repo> pull --ff-only   # from the main checkout only, never a worktree
gh api repos/:owner/:repo/milestones/<id> -q '.title, .open_issues, .closed_issues'
gh issue list --state open --search "milestone:\"<title>\"" --json number,title,body,labels
git -C <repo> worktree list
gh pr list --state open --json number,title,headRefName,mergeable,statusCheckRollup
```

Build a picture of every issue in the milestone: state, labels, and whether a
worktree/branch/PR already exists for it (grep `git worktree list` and open
PRs by `headRefName` containing `issue-<number>-`).

### 2. Classify each open issue

For each open issue in the milestone, determine:

- **Already has an open PR** → skip claiming; go to step 4 (review/merge) for
  it this pass.
- **Has a worktree with uncommitted changes, but no PR yet** → a worker is
  mid-flight from a previous pass; leave it alone this pass (don't dispatch a
  second worker into the same worktree).
- **`status:blocked`** → check its "Depends On" section (issues in this repo
  consistently document this in the issue body). If every dependency issue is
  now closed, relabel to `status:ready` and comment why it unblocked. If not,
  leave blocked.
- **`status:deferred`** → skip entirely, every pass, until a human changes
  that.
- **`status:ready` (or unlabeled with no blockers) with no worktree and no
  PR** → this is dispatchable this pass.

### 3. Dispatch workers in parallel

For every dispatchable issue from step 2, in a **single message with multiple
parallel Task tool calls** (do not dispatch sequentially — that defeats the
point):

- `subagent_type: milestone-worker`
- Prompt must include: the issue number, its full body (paste it — don't make
  the worker re-fetch), the exact worktree path/branch name to create, the
  repo's verification commands, and an explicit instruction to open a PR with
  `Closes #N` when done and then stop (workers do not merge their own PRs).
- Before dispatching, `gh issue edit <n> --add-label status:in-progress`.

Two issues touching the same file (e.g. both editing `standings.ts`) is fine
to dispatch in parallel — conflicts are resolved at merge time in step 4, not
avoided up front. Don't try to be clever about file-level collision detection;
this repo's actual history shows that pattern working fine.

### 4. Review and merge resulting PRs

For every open PR belonging to an issue in this milestone:

```bash
gh pr checks <pr>
gh pr view <pr> --json mergeable,mergeStateStatus
```

- **`mergeable: CONFLICTING`**: do not attempt to resolve this yourself in the
  orchestrator turn. Dispatch a `milestone-worker` back into that same
  worktree/branch with an explicit instruction: `git fetch origin && git
  rebase origin/main`, re-run verification, force-push the branch
  (`git push --force-with-lease`), and confirm the PR is clean. This is the
  single most common failure mode in this repo's real history — always check
  for it before attempting a merge.
- **CI failing**: dispatch a `milestone-worker` back into the branch to fix it
  (paste the failing check's log).
- **Mergeable and CI green**: dispatch a `milestone-reviewer` subagent with the
  PR number. It reads the diff, checks it against the issue's acceptance
  criteria, and returns one of `approve`, `request-changes` (with specific,
  actionable feedback), or `escalate` (ambiguous product decision, needs a
  human).
  - `approve` → merge it yourself: `gh pr merge <pr> --squash --delete-branch`,
    then `gh issue edit <n> --add-label status:done` (if the issue didn't
    auto-close via `Closes #N`, close it explicitly), then remove the local
    worktree if one exists in the main checkout's sibling directory.
  - `request-changes` → dispatch a `milestone-worker` back into the same
    branch with the reviewer's feedback verbatim.
  - `escalate` → leave the PR open, post the reviewer's question as a PR
    comment, and surface it in this run's final summary for the human. Do not
    merge, do not keep looping on it.

### 5. Recompute and repeat

After dispatching this pass's workers/reviewers/mergers, `git pull --ff-only`
on the main checkout, re-check the milestone's `open_issues` count, and go
back to step 1. Continue until:

- `open_issues == 0` → done. Report the final state.
- Or **termination** (see below).

## Termination / do not infinite-loop

Track pass-over-pass progress (issues closed, PRs merged, PRs advanced from
conflicting→clean). If a full pass produces **zero** progress (nothing merged,
nothing newly unblocked, no worker made a new commit), stop and report:

- What's still open and why (blocked on what, escalated with what question,
  or a worker/reviewer failed twice on the same issue).
- Do not retry the same failing thing a third time automatically — surface it.

Also stop and surface to the human immediately (don't attempt to resolve)
whenever:

- A `milestone-reviewer` returns `escalate`.
- The same issue's PR fails verification twice in a row after a fix attempt.
- Any step would require force-pushing `main`, deleting a branch with unmerged
  work, or touching a worktree that has changes you didn't create this run.

## Reporting

At the end of every pass (not just at full completion), report a compact
table: issue, state (merged / in-progress / blocked / escalated), and PR
number if any. This mirrors the manual status-check format already used
throughout this project's history — keep it consistent so a human skimming
mid-run understands it immediately.
