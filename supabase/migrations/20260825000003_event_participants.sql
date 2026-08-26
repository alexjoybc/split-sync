-- An event roster is created once, then participants are assigned to races.
-- `entries` remains the per-race list consumed by scoring and the live board.

create table participants (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  bib text not null,
  name text not null,
  team text,
  category text,
  created_at timestamptz not null default now(),
  unique (event_id, bib)
);

create index participants_event_idx on participants (event_id);

grant select, insert, delete on participants to anon, authenticated;

alter table participants enable row level security;

create policy "public read participants" on participants for select using (true);
create policy "anon insert participants" on participants for insert with check (true);
create policy "anon delete participants" on participants for delete using (true);
