-- Enforce the race lifecycle (upcoming -> active -> finished) at the database
-- level, not just in the UI (see docs/adr/0004-race-lifecycle-enforcement.md).

alter table races add column finished_at timestamptz; -- set when race finishes, cleared on reopen

-- Minimal audit log for race status transitions. Scope coordinated with the
-- (not-yet-landed) crossing correction issue: this table only needs to carry
-- a required reason for "reopen" for now, and doubles as a full transition
-- log since the trigger below records every status change.
create table race_status_changes (
  id uuid primary key default gen_random_uuid(),
  race_id uuid not null references races(id) on delete cascade,
  previous_status race_status not null,
  new_status race_status not null,
  reason text, -- required by reopen_race(), null for ordinary start/finish
  actor text not null, -- JWT subject that made the change
  created_at timestamptz not null default now()
);

create index race_status_changes_race_idx on race_status_changes (race_id, created_at);

alter table race_status_changes enable row level security;

create policy "organizer read race status changes" on race_status_changes for select to authenticated
  using (exists (
    select 1 from races join events on events.id = races.event_id
    where races.id = race_status_changes.race_id and events.owner_id = auth.jwt()->>'sub'
  ));

grant select on race_status_changes to authenticated;

-- Enforce legal transitions and keep started_at/finished_at consistent
-- regardless of which client (web, mobile, future connector) issues the
-- update. Only reopen_race() below is allowed to move finished -> active,
-- via a transaction-local flag; a bare client update cannot skip the
-- required reason.
create or replace function races_lifecycle_guard()
returns trigger
language plpgsql
as $$
begin
  if new.status = old.status then
    return new;
  end if;

  if old.status = 'upcoming' and new.status = 'active' then
    new.started_at := coalesce(old.started_at, now());
  elsif old.status = 'active' and new.status = 'finished' then
    new.finished_at := now();
  elsif old.status = 'finished' and new.status = 'active' then
    if coalesce(current_setting('splitsync.reopen_reason', true), '') = '' then
      raise exception 'reopening a finished race requires reopen_race() with a reason';
    end if;
    new.finished_at := null;
  else
    raise exception 'invalid race status transition: % -> %', old.status, new.status;
  end if;

  return new;
end;
$$;

create trigger races_lifecycle_guard
  before update on races
  for each row
  execute function races_lifecycle_guard();

-- security definer: authenticated organizers have no insert policy on
-- race_status_changes (it is an append-only, trigger-managed audit log).
create or replace function races_lifecycle_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status <> old.status then
    insert into race_status_changes (race_id, previous_status, new_status, reason, actor)
    values (
      new.id,
      old.status,
      new.status,
      nullif(current_setting('splitsync.reopen_reason', true), ''),
      coalesce(auth.jwt()->>'sub', 'system')
    );
  end if;
  return null;
end;
$$;

create trigger races_lifecycle_audit
  after update on races
  for each row
  execute function races_lifecycle_audit();

-- Reopen requires an explicit, non-empty reason and event ownership. This is
-- the only supported path from finished back to active.
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

  if not exists (
    select 1 from events
    where events.id = v_race.event_id and events.owner_id = auth.jwt()->>'sub'
  ) then
    raise exception 'not authorized to reopen this race';
  end if;

  if v_race.status <> 'finished' then
    raise exception 'only a finished race can be reopened';
  end if;

  perform set_config('splitsync.reopen_reason', btrim(p_reason), true);

  update races set status = 'active' where id = p_race_id returning * into v_race;

  return v_race;
end;
$$;

revoke all on function reopen_race(uuid, text) from public;
grant execute on function reopen_race(uuid, text) to authenticated;

-- Crossings may only be inserted while their race is active; corrections
-- (soft-delete via update, or plain reads) remain available regardless of
-- race status so a finished race can still be corrected.
drop policy "organizer manage crossings" on crossings;

create policy "organizer read crossings" on crossings for select to authenticated
  using (exists (
    select 1 from races join events on events.id = races.event_id
    where races.id = crossings.race_id and events.owner_id = auth.jwt()->>'sub'
  ));

create policy "organizer insert active race crossings" on crossings for insert to authenticated
  with check (exists (
    select 1 from races join events on events.id = races.event_id
    where races.id = crossings.race_id
      and races.status = 'active'
      and events.owner_id = auth.jwt()->>'sub'
  ));

create policy "organizer update crossings" on crossings for update to authenticated
  using (exists (
    select 1 from races join events on events.id = races.event_id
    where races.id = crossings.race_id and events.owner_id = auth.jwt()->>'sub'
  ))
  with check (exists (
    select 1 from races join events on events.id = races.event_id
    where races.id = crossings.race_id and events.owner_id = auth.jwt()->>'sub'
  ));

create policy "organizer delete crossings" on crossings for delete to authenticated
  using (exists (
    select 1 from races join events on events.id = races.event_id
    where races.id = crossings.race_id and events.owner_id = auth.jwt()->>'sub'
  ));
