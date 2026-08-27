# ADR 0004: Self-Service Help On The Website And Documentation Requirements

## Status

Accepted.

## Context

SplitSync documentation (architecture notes, runbooks, ADRs) lives entirely in the git repository. That is useful for contributors, but it is invisible to the people who actually run and watch races: organizers setting up an event on race day and spectators trying to read the live board. Support questions currently have no in-product answer path, and there was no explicit rule about when a change requires an ADR versus a runbook update versus nothing at all.

## Decision

1. Add an on-site, self-service Help section at `apps/web/src/app/help`, reachable directly from the website (not just from the repo). It is scoped per surface:
   - A spectator-facing section explaining how to follow live results and what "unofficial results" means.
   - An organizer-facing section explaining event/race setup, roster/entries, and scoring basics.
   - A placeholder for mobile tracker help, to be filled in once an in-app help screen ships in `apps/mobile`.
2. Codify in `AGENTS.md` that user-facing features must ship with corresponding on-site Help content, and that ADRs are required for architecture/security/data-model/cross-surface changes, while runbooks are required for operational workflow changes.

## Rationale

- Repo docs serve contributors; on-site Help serves end users (organizers and spectators) who will never open GitHub. Keeping both close to the code they document keeps them from drifting apart.
- Explicit criteria for "when do I write an ADR" reduces both under-documentation (silent architectural drift) and over-documentation (ADRs for trivial copy changes).
- Scoping Help content per surface preserves the existing rule that spectator, organizer, and mobile surfaces must not blend permissions or goals.

## Consequences

- New user-facing features should include a short Help update as part of the same PR when practical, or a fast-follow issue when not.
- `apps/web/src/app/help` is now a permanent home for spectator/organizer self-service docs; keep its content in sync with actual product behavior.
- Mobile in-app help is out of scope for this ADR and tracked as a follow-up; for now, the on-site Help page's tracker section points volunteers/organizers to the web Help page.
