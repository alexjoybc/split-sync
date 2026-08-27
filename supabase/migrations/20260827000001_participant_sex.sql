-- Add a sex field to the event roster. Categories (e.g. "Junior", "Master
-- 35+") are often further split by sex at the race level, so organizers need
-- to record it once on the roster alongside name/team/category.

alter table participants add column sex text check (sex in ('M', 'F', 'X'));
