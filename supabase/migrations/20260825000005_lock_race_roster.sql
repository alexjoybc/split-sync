-- A start is a roster lock. Entries cannot change once timing begins.
drop policy "organizer manage entries" on entries;

create policy "organizer manage upcoming race entries" on entries for all to authenticated
  using (exists (
    select 1 from races join events on events.id = races.event_id
    where races.id = entries.race_id
      and races.status = 'upcoming'
      and events.owner_id = auth.jwt()->>'sub'
  ))
  with check (exists (
    select 1 from races join events on events.id = races.event_id
    where races.id = entries.race_id
      and races.status = 'upcoming'
      and events.owner_id = auth.jwt()->>'sub'
  ));
