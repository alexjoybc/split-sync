-- Time trial race type (see docs/adr/0014-time-trial-race-type.md).
-- Reuses existing crossings table unchanged: 1st crossing = start, 2nd = finish.
-- No RLS changes needed (existing races policies are column-agnostic).

alter table races add column is_time_trial boolean not null default false;
alter table races add column time_trial_countdown_seconds int not null default 5;

alter table races add constraint races_time_trial_countdown_seconds_check
  check (time_trial_countdown_seconds >= 0);

-- Ensure a race cannot be both a points race and a time trial at once.
alter table races add constraint races_points_or_time_trial_check
  check (not (is_points_race and is_time_trial));
