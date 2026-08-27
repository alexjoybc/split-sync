-- Split the single participant "name" field into first_name/last_name so the
-- roster can be edited field-by-field and future exports/imports can key on
-- either part. entries.name stays a single frozen full-name snapshot copied
-- at assignment time; it is not affected by this migration.

alter table participants add column first_name text;
alter table participants add column last_name text;

update participants
set first_name = split_part(name, ' ', 1),
    last_name = nullif(trim(substring(name from position(' ' in name))), '');

alter table participants alter column first_name set not null;
alter table participants drop column name;
