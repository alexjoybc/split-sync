-- E2E seed: deterministic state for functional tests.
-- LOCAL ONLY — never run against hosted Supabase (bsihlrzncucrglqltjrc).
-- Apply with: supabase db reset

-- === Published event (spectators can see this) ===
insert into events (id, title, sport_type, location, starts_at, status, scorer_pin)
values (
  'a0000000-0000-0000-0000-000000000001',
  'Friday Night Racing — E2E Test Event',
  'velodrome',
  'Greater Victoria Velodrome',
  now(),
  'live',
  '1234'
);

-- Roster: participants first (domain invariant #3)
insert into participants (id, event_id, bib, first_name, last_name, team) values
  ('c0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', '12', 'Maya',    'Chen',      'Tripleshot'),
  ('c0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', '7',  'Liam',    'O''Brien',  'UVic Cycling'),
  ('c0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', '23', 'Sofia',   'Marchetti', 'Broad Street'),
  ('c0000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000001', '41', 'Dev',     'Patel',     'Independent'),
  ('c0000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000001', '3',  'Emma',    'Larsen',    'Tripleshot'),
  ('c0000000-0000-0000-0000-000000000006', 'a0000000-0000-0000-0000-000000000001', '55', 'Noah',    'Kim',       'UVic Cycling'),
  ('c0000000-0000-0000-0000-000000000007', 'a0000000-0000-0000-0000-000000000001', '61', 'Olivia',  'Reyes',     'Independent'),
  ('c0000000-0000-0000-0000-000000000008', 'a0000000-0000-0000-0000-000000000001', '78', 'Jack',    'Thompson',  'Broad Street');

-- Races
insert into races (id, event_id, name, sequence_order, laps_planned, status) values
  ('b0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'A Race — Scratch 20 laps', 1, 20, 'upcoming'),
  ('b0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'B Race — Scratch 15 laps', 2, 15, 'upcoming');

-- Entries: selected from roster (domain invariant #3)
insert into entries (race_id, bib, name, team) values
  ('b0000000-0000-0000-0000-000000000001', '12', 'Maya Chen',       'Tripleshot'),
  ('b0000000-0000-0000-0000-000000000001', '7',  'Liam O''Brien',   'UVic Cycling'),
  ('b0000000-0000-0000-0000-000000000001', '23', 'Sofia Marchetti', 'Broad Street'),
  ('b0000000-0000-0000-0000-000000000001', '41', 'Dev Patel',       'Independent'),
  ('b0000000-0000-0000-0000-000000000001', '3',  'Emma Larsen',     'Tripleshot'),
  ('b0000000-0000-0000-0000-000000000002', '55', 'Noah Kim',        'UVic Cycling'),
  ('b0000000-0000-0000-0000-000000000002', '61', 'Olivia Reyes',    'Independent'),
  ('b0000000-0000-0000-0000-000000000002', '78', 'Jack Thompson',   'Broad Street');

-- Some crossings for A Race (so spectator live board shows standings)
-- Lap 1 finish order: #12, #7, #23
insert into crossings (id, race_id, bib, client_id, client_recorded_at) values
  ('d0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', '12', 'e0000000-0000-0000-0000-000000000001', now() - interval '5 minutes'),
  ('d0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000001', '7',  'e0000000-0000-0000-0000-000000000002', now() - interval '5 minutes' + interval '2 seconds'),
  ('d0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000001', '23', 'e0000000-0000-0000-0000-000000000003', now() - interval '5 minutes' + interval '5 seconds');

-- === Draft event (spectators must NOT see this) ===
insert into events (id, title, sport_type, location, status, scorer_pin)
values (
  'a0000000-0000-0000-0000-000000000002',
  'Draft Event — Not Visible to Public',
  'velodrome',
  'Test Location',
  'draft',
  '9999'
);

insert into participants (id, event_id, bib, first_name, last_name) values
  ('c0000000-0000-0000-0000-000000000009', 'a0000000-0000-0000-0000-000000000002', '1', 'Test', 'Rider');

insert into races (id, event_id, name, sequence_order, status) values
  ('b0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000002', 'Draft Race', 1, 'upcoming');

insert into entries (race_id, bib, name) values
  ('b0000000-0000-0000-0000-000000000003', '1', 'Test Rider');
