-- Provider-neutral identity subject. Do not FK auth.users: future Auth0/OIDC
-- identities may not exist in Supabase's auth.users table.
-- Existing local seed data remains readable but cannot be edited.
alter table events add column owner_id text;
create index events_owner_idx on events (owner_id);

-- Remove the MVP's public write policies before granting organizer-only access.
drop policy "anon insert crossings" on crossings;
drop policy "anon update crossings" on crossings;
drop policy "anon update races" on races;
drop policy "anon insert events" on events;
drop policy "anon update events" on events;
drop policy "anon insert races" on races;
drop policy "anon insert entries" on entries;
drop policy "anon delete entries" on entries;
drop policy "anon insert participants" on participants;
drop policy "anon delete participants" on participants;
drop policy "public read events" on events;
drop policy "public read races" on races;
drop policy "public read entries" on entries;
drop policy "public read crossings" on crossings;
drop policy "public read participants" on participants;

revoke insert, update, delete on events, races, entries, crossings, participants from anon;
grant insert, update, delete on events, races, entries, crossings, participants to authenticated;

create policy "organizer manage events" on events for all to authenticated
  using (owner_id = auth.jwt()->>'sub')
  with check (owner_id = auth.jwt()->>'sub');

-- Spectators can read published events and their race data only.
create policy "public read published events" on events for select
  using (status in ('live', 'finished'));

create policy "public read published races" on races for select
  using (exists (select 1 from events where events.id = races.event_id and events.status in ('live', 'finished')));

create policy "public read published entries" on entries for select
  using (exists (
    select 1 from races join events on events.id = races.event_id
    where races.id = entries.race_id and events.status in ('live', 'finished')
  ));

create policy "public read published crossings" on crossings for select
  using (exists (
    select 1 from races join events on events.id = races.event_id
    where races.id = crossings.race_id and events.status in ('live', 'finished')
  ));

create policy "organizer manage races" on races for all to authenticated
  using (exists (select 1 from events where events.id = races.event_id and events.owner_id = auth.jwt()->>'sub'))
  with check (exists (select 1 from events where events.id = races.event_id and events.owner_id = auth.jwt()->>'sub'));

create policy "organizer manage entries" on entries for all to authenticated
  using (exists (
    select 1 from races join events on events.id = races.event_id
    where races.id = entries.race_id and events.owner_id = auth.jwt()->>'sub'
  ))
  with check (exists (
    select 1 from races join events on events.id = races.event_id
    where races.id = entries.race_id and events.owner_id = auth.jwt()->>'sub'
  ));

create policy "organizer manage participants" on participants for all to authenticated
  using (exists (select 1 from events where events.id = participants.event_id and events.owner_id = auth.jwt()->>'sub'))
  with check (exists (select 1 from events where events.id = participants.event_id and events.owner_id = auth.jwt()->>'sub'));

-- Scoring is owner-only until event-scoped scorer sessions (#17) are implemented.
create policy "organizer manage crossings" on crossings for all to authenticated
  using (exists (
    select 1 from races join events on events.id = races.event_id
    where races.id = crossings.race_id and events.owner_id = auth.jwt()->>'sub'
  ))
  with check (exists (
    select 1 from races join events on events.id = races.event_id
    where races.id = crossings.race_id and events.owner_id = auth.jwt()->>'sub'
  ));
