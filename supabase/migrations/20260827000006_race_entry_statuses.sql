-- Rider status support (DNS/DNF/DSQ). These are asserted facts about an
-- entry's participation, not derived standings — see
-- docs/adr/0007-rider-status.md. Standings computation (apps/web/src/lib/
-- standings.ts) treats non-"ok" entries as excluded from ranked position but
-- still visible with their status badge.

create type entry_status as enum ('ok', 'dns', 'dnf', 'dsq');

alter table entries add column status entry_status not null default 'ok';
alter table entries add column status_reason text;
alter table entries add column status_set_by text; -- JWT subject, set by trigger only
alter table entries add column status_set_at timestamptz;

-- Append-only audit log, same shape/precedent as race_status_changes.
create table entry_status_changes (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references entries(id) on delete cascade,
  previous_status entry_status not null,
  new_status entry_status not null,
  reason text,
  actor text not null, -- JWT subject that made the change
  created_at timestamptz not null default now()
);

create index entry_status_changes_entry_idx on entry_status_changes (entry_id, created_at);

alter table entry_status_changes enable row level security;

create policy "organizer read entry status changes" on entry_status_changes for select to authenticated
  using (exists (
    select 1 from entries join races on races.id = entries.race_id join events on events.id = races.event_id
    where entries.id = entry_status_changes.entry_id and events.owner_id = auth.jwt()->>'sub'
  ));

grant select on entry_status_changes to authenticated;

-- Roster identity fields (bib/name/team/category) stay locked once a race
-- has started, per the existing "organizer manage upcoming race entries"
-- policy's intent — but status must be settable while the race is active
-- (DNF/DSQ happen mid-race) and even after it finishes (late corrections).
-- RLS can't enforce that split at the column level, so it's done here.
create or replace function entries_write_guard()
returns trigger
language plpgsql
as $$
declare
  v_race_status race_status;
begin
  select status into v_race_status from races where id = new.race_id;

  if (new.bib, new.name, coalesce(new.team, ''), coalesce(new.category, ''))
       is distinct from
     (old.bib, old.name, coalesce(old.team, ''), coalesce(old.category, ''))
     and v_race_status <> 'upcoming' then
    raise exception 'race roster is locked once the race has started';
  end if;

  -- status_set_by/status_set_at are attribution, not client-editable input.
  if new.status <> old.status then
    new.status_set_by := coalesce(auth.jwt()->>'sub', 'system');
    new.status_set_at := now();
  else
    new.status_set_by := old.status_set_by;
    new.status_set_at := old.status_set_at;
  end if;

  return new;
end;
$$;

create trigger entries_write_guard
  before update on entries
  for each row
  execute function entries_write_guard();

-- security definer: authenticated organizers have no insert policy on
-- entry_status_changes (it is an append-only, trigger-managed audit log).
create or replace function entries_status_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status <> old.status then
    insert into entry_status_changes (entry_id, previous_status, new_status, reason, actor)
    values (new.id, old.status, new.status, new.status_reason, coalesce(auth.jwt()->>'sub', 'system'));
  end if;
  return null;
end;
$$;

create trigger entries_status_audit
  after update on entries
  for each row
  execute function entries_status_audit();

-- Split the roster-lock policy: adding/removing entries stays upcoming-only,
-- but updates (including status changes on an active/finished race) are
-- allowed for the owner and enforced at the field level by the trigger
-- above rather than by RLS.
drop policy "organizer manage upcoming race entries" on entries;

create policy "organizer insert upcoming race entries" on entries for insert to authenticated
  with check (exists (
    select 1 from races join events on events.id = races.event_id
    where races.id = entries.race_id
      and races.status = 'upcoming'
      and events.owner_id = auth.jwt()->>'sub'
  ));

create policy "organizer delete upcoming race entries" on entries for delete to authenticated
  using (exists (
    select 1 from races join events on events.id = races.event_id
    where races.id = entries.race_id
      and races.status = 'upcoming'
      and events.owner_id = auth.jwt()->>'sub'
  ));

create policy "organizer update race entries" on entries for update to authenticated
  using (exists (
    select 1 from races join events on events.id = races.event_id
    where races.id = entries.race_id and events.owner_id = auth.jwt()->>'sub'
  ))
  with check (exists (
    select 1 from races join events on events.id = races.event_id
    where races.id = entries.race_id and events.owner_id = auth.jwt()->>'sub'
  ));

-- Same split for organizer-role event_members (#75's "member manage
-- upcoming race entries"): insert/delete stay upcoming-only, update is
-- allowed on any race status and field-level locked by the trigger above.
drop policy "member manage upcoming race entries" on entries;

create policy "member insert upcoming race entries" on entries for insert to authenticated
  with check (exists (
    select 1 from races
    where races.id = entries.race_id
      and races.status = 'upcoming'
      and has_event_role(races.event_id, array['organizer']::event_member_role[])
  ));

create policy "member delete upcoming race entries" on entries for delete to authenticated
  using (exists (
    select 1 from races
    where races.id = entries.race_id
      and races.status = 'upcoming'
      and has_event_role(races.event_id, array['organizer']::event_member_role[])
  ));

create policy "member update race entries" on entries for update to authenticated
  using (exists (
    select 1 from races
    where races.id = entries.race_id
      and has_event_role(races.event_id, array['organizer']::event_member_role[])
  ))
  with check (exists (
    select 1 from races
    where races.id = entries.race_id
      and has_event_role(races.event_id, array['organizer']::event_member_role[])
  ));

-- entry_status_changes: organizer-role members can also read the audit log.
create policy "member read entry status changes" on entry_status_changes for select to authenticated
  using (exists (
    select 1 from entries join races on races.id = entries.race_id
    where entries.id = entry_status_changes.entry_id
      and has_event_role(races.event_id, array['organizer']::event_member_role[])
  ));
