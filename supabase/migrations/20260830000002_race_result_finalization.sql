-- Result finalization and publishing workflow (#72, see docs/adr/0018).
--
-- Adds an explicit "publish" step distinct from the existing race lifecycle
-- (ADR 0005): a race can be `finished` for a while before an organizer
-- reviews it and deliberately publishes results. `results_published_at` is
-- the single source of truth for "has this race's results been published".
--
-- `results_under_revision` is a companion flag: when a previously-published
-- race is reopened, this is set true so every surface can say "these
-- results are being corrected" instead of silently reverting to ordinary
-- live-race copy. It is cleared the next time results are published.

alter table races add column results_published_at timestamptz;
alter table races add column results_under_revision boolean not null default false;

-- Neither column is part of the `status` state machine, so the existing
-- `races_lifecycle_guard` (which only fires on status changes) does not
-- cover them. Guard them the same way: only finalize_and_publish_race() and
-- reopen_race() may write results_published_at/results_under_revision,
-- signalled by a transaction-local flag, so a bare client update cannot
-- publish or unpublish results.
create or replace function races_publish_guard()
returns trigger
language plpgsql
as $$
begin
  if new.results_published_at is not distinct from old.results_published_at
    and new.results_under_revision is not distinct from old.results_under_revision
  then
    return new;
  end if;

  if coalesce(current_setting('splitsync.publish_action', true), '') <> 'on' then
    raise exception 'publishing or unpublishing race results requires finalize_and_publish_race() or reopen_race()';
  end if;

  return new;
end;
$$;

create trigger races_publish_guard
  before update on races
  for each row
  execute function races_publish_guard();

-- Finalize & publish: only a finished race may be published. Idempotent —
-- publishing an already-published race simply refreshes the timestamp and
-- clears results_under_revision (the "re-finalize after reopen" path).
create or replace function finalize_and_publish_race(p_race_id uuid)
returns races
language plpgsql
security definer
set search_path = public
as $$
declare
  v_race races;
begin
  select * into v_race from races where id = p_race_id;
  if v_race is null then
    raise exception 'race not found';
  end if;

  if not (is_event_owner(v_race.event_id) or has_event_role(v_race.event_id, array['organizer']::event_member_role[])) then
    raise exception 'not authorized to publish this race';
  end if;

  if v_race.status <> 'finished' then
    raise exception 'only a finished race can be published';
  end if;

  perform set_config('splitsync.publish_action', 'on', true);

  update races
  set results_published_at = now(), results_under_revision = false
  where id = p_race_id
  returning * into v_race;

  return v_race;
end;
$$;

revoke all on function finalize_and_publish_race(uuid) from public;
grant execute on function finalize_and_publish_race(uuid) to authenticated;

-- Re-create reopen_race() (20260827000004, extended by 20260827000005) to
-- also clear results_published_at and, when the race had been published,
-- flag results_under_revision so every surface can say results are being
-- corrected rather than silently reverting to ordinary live-race copy.
create or replace function reopen_race(p_race_id uuid, p_reason text)
returns races
language plpgsql
security definer
set search_path = public
as $$
declare
  v_race races;
begin
  if btrim(coalesce(p_reason, '')) = '' then
    raise exception 'a reason is required to reopen a race';
  end if;

  select * into v_race from races where id = p_race_id;
  if v_race is null then
    raise exception 'race not found';
  end if;

  if not (is_event_owner(v_race.event_id) or has_event_role(v_race.event_id, array['organizer']::event_member_role[])) then
    raise exception 'not authorized to reopen this race';
  end if;

  if v_race.status <> 'finished' then
    raise exception 'only a finished race can be reopened';
  end if;

  perform set_config('splitsync.reopen_reason', btrim(p_reason), true);
  perform set_config('splitsync.publish_action', 'on', true);

  update races
  set
    status = 'active',
    results_published_at = null,
    results_under_revision = (v_race.results_published_at is not null)
  where id = p_race_id
  returning * into v_race;

  return v_race;
end;
$$;

revoke all on function reopen_race(uuid, text) from public;
grant execute on function reopen_race(uuid, text) to authenticated;
