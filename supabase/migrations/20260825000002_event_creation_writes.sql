-- Allow creating events/races/entries from the app (MVP: open writes).
-- TODO(#17): gate all writes behind scorer/organizer PIN before public deploy.

grant insert on events, races, entries to anon, authenticated;
grant update on events to anon, authenticated;
grant delete on entries to anon, authenticated;

create policy "anon insert events" on events for insert with check (true);
create policy "anon update events" on events for update using (true);
create policy "anon insert races" on races for insert with check (true);
create policy "anon insert entries" on entries for insert with check (true);
create policy "anon delete entries" on entries for delete using (true);
