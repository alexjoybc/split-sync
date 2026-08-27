-- Penalties and adjustments (#71). Officials commonly need to apply a time
-- penalty, drop a lap, or relegate a rider without touching the underlying
-- crossing facts (ADR 0001). Unlike rider status (#66, one current value +
-- history), penalties are cumulative — an entry can carry several stacked
-- penalties — so this is modeled as its own append-only-by-convention table
-- (rows are only ever inserted or deleted, never updated) rather than
-- columns on `entries`. See docs/adr/0012-penalties-and-adjustments.md.

create type penalty_type as enum ('time_penalty', 'lap_penalty', 'relegation', 'note');

create table race_entry_penalties (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references entries(id) on delete cascade,
  type penalty_type not null,
  value numeric, -- seconds for time_penalty, laps for lap_penalty; null for relegation/note
  reason text not null,
  set_by text not null, -- JWT subject, set by trigger only
  set_at timestamptz not null default now() -- set by trigger only
);

create index race_entry_penalties_entry_idx on race_entry_penalties (entry_id, set_at);

alter table race_entry_penalties enable row level security;

-- Every penalty/adjustment requires a reason (unlike rider status, where a
-- reason is optional) and a value appropriate to its type. Attribution
-- (set_by/set_at) is written only here, never accepted from the client.
create or replace function race_entry_penalties_guard()
returns trigger
language plpgsql
as $$
begin
  if btrim(coalesce(new.reason, '')) = '' then
    raise exception 'a reason is required to record a penalty or adjustment';
  end if;

  if new.type in ('time_penalty', 'lap_penalty') then
    if new.value is null or new.value <= 0 then
      raise exception '% requires a positive value', new.type;
    end if;
  else
    new.value := null; -- relegation/note carry no numeric value
  end if;

  new.set_by := coalesce(auth.jwt()->>'sub', 'system');
  new.set_at := now();

  return new;
end;
$$;

create trigger race_entry_penalties_guard
  before insert on race_entry_penalties
  for each row
  execute function race_entry_penalties_guard();

-- Owner, organizer-role, or official-role members can record and remove
-- penalties. This is the "official" role's first write capability — it
-- existed as read-only classification review (#75) but adjudicating
-- penalties is squarely that role's real-world mandate. Rows are only ever
-- inserted or deleted (undo a mistaken entry); there is no update policy.
create policy "organizer read race entry penalties" on race_entry_penalties for select to authenticated
  using (exists (
    select 1 from entries
    join races on races.id = entries.race_id
    join events on events.id = races.event_id
    where entries.id = race_entry_penalties.entry_id
      and (
        events.owner_id = auth.jwt()->>'sub'
        or has_event_role(events.id, array['organizer', 'official']::event_member_role[])
      )
  ));

create policy "organizer insert race entry penalties" on race_entry_penalties for insert to authenticated
  with check (exists (
    select 1 from entries
    join races on races.id = entries.race_id
    join events on events.id = races.event_id
    where entries.id = race_entry_penalties.entry_id
      and (
        events.owner_id = auth.jwt()->>'sub'
        or has_event_role(events.id, array['organizer', 'official']::event_member_role[])
      )
  ));

create policy "organizer delete race entry penalties" on race_entry_penalties for delete to authenticated
  using (exists (
    select 1 from entries
    join races on races.id = entries.race_id
    join events on events.id = races.event_id
    where entries.id = race_entry_penalties.entry_id
      and (
        events.owner_id = auth.jwt()->>'sub'
        or has_event_role(events.id, array['organizer', 'official']::event_member_role[])
      )
  ));

-- Spectators of a published event see penalty badges/tooltips on public
-- results, mirroring the "public read published entries/crossings" split.
create policy "public read published race entry penalties" on race_entry_penalties for select
  using (exists (
    select 1 from entries
    join races on races.id = entries.race_id
    join events on events.id = races.event_id
    where entries.id = race_entry_penalties.entry_id
      and events.status in ('live', 'finished')
  ));

grant select on race_entry_penalties to anon, authenticated;
grant insert, delete on race_entry_penalties to authenticated;
