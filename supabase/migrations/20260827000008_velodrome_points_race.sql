-- Velodrome points race scoring, modeled as a derived-standings overlay on
-- top of crossings (see docs/adr/0009-points-race-overlay.md). No new fact
-- table is needed: sprint results are read directly from each rider's
-- existing crossing sequence, the same facts overall standings already use.
-- Only the per-race scoring configuration is persisted, on `races` itself,
-- following ADR 0001's guidance that scoring rules more complex than
-- mass-start laps require a separate overlay rather than mutating crossings.

alter table races add column is_points_race boolean not null default false;
alter table races add column sprint_interval_laps int not null default 5;
alter table races add column sprint_points int[] not null default '{5,3,2,1}';
alter table races add column final_sprint_multiplier int not null default 2;
alter table races add column lap_gain_bonus int not null default 20;
alter table races add column lap_loss_penalty int not null default 0;

alter table races add constraint races_sprint_interval_laps_check check (sprint_interval_laps > 0);
alter table races add constraint races_final_sprint_multiplier_check check (final_sprint_multiplier > 0);
alter table races add constraint races_lap_gain_bonus_check check (lap_gain_bonus >= 0);
alter table races add constraint races_lap_loss_penalty_check check (lap_loss_penalty >= 0);

-- No RLS changes: these are plain columns on `races`, already covered by the
-- existing "organizer manage races" / "public read published races" policies.
