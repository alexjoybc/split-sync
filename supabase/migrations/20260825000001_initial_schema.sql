-- SplitSync initial schema: mass-start lap racing (velodrome / cyclocross)
-- Positions and gaps are DERIVED from crossings, never stored.

create type event_status as enum ('draft', 'live', 'finished');
create type race_status as enum ('upcoming', 'active', 'finished');
create type crossing_source as enum ('manual', 'connector');

create table events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  sport_type text not null default 'velodrome',
  location text,
  starts_at timestamptz,
  status event_status not null default 'draft',
  scorer_pin text, -- MVP access control, see #17
  created_at timestamptz not null default now()
);

create table races (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  name text not null, -- category, e.g. "A Race", "Women 3/4"
  sequence_order int not null default 0,
  laps_planned int, -- null = timed race / unknown
  status race_status not null default 'upcoming',
  started_at timestamptz, -- set when race goes active
  created_at timestamptz not null default now()
);

create table entries (
  id uuid primary key default gen_random_uuid(),
  race_id uuid not null references races(id) on delete cascade,
  bib text not null,
  name text not null,
  team text,
  category text,
  created_at timestamptz not null default now(),
  unique (race_id, bib)
);

create table crossings (
  id uuid primary key default gen_random_uuid(),
  race_id uuid not null references races(id) on delete cascade,
  bib text not null, -- intentionally NOT an FK: unknown bibs must be recordable, resolved later
  client_id uuid not null, -- generated on the scoring device; idempotency key for offline retry
  recorded_at timestamptz not null default now(), -- server time
  client_recorded_at timestamptz not null, -- device time at the moment of the tap
  source crossing_source not null default 'manual',
  deleted_at timestamptz, -- soft delete for scorer corrections (undo)
  created_at timestamptz not null default now(),
  unique (client_id)
);

create index crossings_race_time_idx on crossings (race_id, client_recorded_at) where deleted_at is null;
create index races_event_idx on races (event_id);
create index entries_race_idx on entries (race_id);

-- Realtime: spectator boards subscribe to crossings + races changes
alter publication supabase_realtime add table crossings;
alter publication supabase_realtime add table races;

-- Table grants (Supabase no longer grants to anon/authenticated by default)
grant usage on schema public to anon, authenticated;
grant select on events, races, entries, crossings to anon, authenticated;
grant insert, update on crossings to anon, authenticated;
grant update on races to anon, authenticated;

-- RLS: public read (spectators are anonymous), writes open for MVP.
-- Write restriction via scorer PIN lands in #17.
alter table events enable row level security;
alter table races enable row level security;
alter table entries enable row level security;
alter table crossings enable row level security;

create policy "public read events" on events for select using (true);
create policy "public read races" on races for select using (true);
create policy "public read entries" on entries for select using (true);
create policy "public read crossings" on crossings for select using (true);

-- TODO(#17): replace with PIN-gated policies before the event
create policy "anon insert crossings" on crossings for insert with check (true);
create policy "anon update crossings" on crossings for update using (true);
create policy "anon update races" on races for update using (true);
