-- Dev seed: fake velodrome race night for local testing and dry runs
insert into events (id, title, sport_type, location, starts_at, status, scorer_pin)
values (
  'a0000000-0000-0000-0000-000000000001',
  'Friday Night Racing — Dry Run',
  'velodrome',
  'Greater Victoria Velodrome',
  now(),
  'live',
  '1234'
);

insert into races (id, event_id, name, sequence_order, laps_planned, status) values
  ('b0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'A Race — Scratch 20 laps', 1, 20, 'upcoming'),
  ('b0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'B Race — Scratch 15 laps', 2, 15, 'upcoming');

insert into entries (race_id, bib, name, team) values
  ('b0000000-0000-0000-0000-000000000001', '12', 'Maya Chen', 'Tripleshot'),
  ('b0000000-0000-0000-0000-000000000001', '7', 'Liam O''Brien', 'UVic Cycling'),
  ('b0000000-0000-0000-0000-000000000001', '23', 'Sofia Marchetti', 'Broad Street'),
  ('b0000000-0000-0000-0000-000000000001', '41', 'Dev Patel', 'Independent'),
  ('b0000000-0000-0000-0000-000000000001', '3', 'Emma Larsen', 'Tripleshot'),
  ('b0000000-0000-0000-0000-000000000002', '55', 'Noah Kim', 'UVic Cycling'),
  ('b0000000-0000-0000-0000-000000000002', '61', 'Olivia Reyes', 'Independent'),
  ('b0000000-0000-0000-0000-000000000002', '78', 'Jack Thompson', 'Broad Street');
