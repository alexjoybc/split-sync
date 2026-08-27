-- Additional organizer-editable event detail fields. All nullable/optional;
-- existing owner-only write / published-only read RLS policies on `events`
-- already cover these columns since they apply to the whole row.

alter table events add column description text;
alter table events add column banner_image_url text;
alter table events add column venue_address text;
alter table events add column ends_at timestamptz;
alter table events add column timezone text;
alter table events add column contact_email text;
alter table events add column registration_url text;
