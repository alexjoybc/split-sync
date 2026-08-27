-- Event cloning (issue #68): let an event owner or organizer-role volunteer
-- (see 20260827000005_volunteer_roles.sql) reuse an existing event's
-- structure (details, races, and optionally the participant roster) as the
-- starting point for a new draft event. Never copies race-day state
-- (entries, crossings, race status/timestamps) or event status/starts_at.
-- The caller becomes the new event's owner regardless of their role on the
-- source event.

create or replace function clone_event(p_event_id uuid, p_include_roster boolean default false, p_title text default null)
returns events
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source events;
  v_new events;
begin
  select * into v_source from events where id = p_event_id;
  if v_source is null then
    raise exception 'event not found';
  end if;

  if not (is_event_owner(p_event_id) or has_event_role(p_event_id, array['organizer']::event_member_role[])) then
    raise exception 'not authorized to clone this event';
  end if;

  insert into events (
    title, sport_type, location, status, owner_id,
    description, banner_image_url, venue_address, timezone,
    contact_email, registration_url
  )
  values (
    coalesce(nullif(btrim(coalesce(p_title, '')), ''), v_source.title || ' (copy)'),
    v_source.sport_type,
    v_source.location,
    'draft',
    auth.jwt()->>'sub',
    v_source.description,
    v_source.banner_image_url,
    v_source.venue_address,
    v_source.timezone,
    v_source.contact_email,
    v_source.registration_url
  )
  returning * into v_new;

  insert into races (event_id, name, sequence_order, laps_planned)
  select v_new.id, name, sequence_order, laps_planned
  from races
  where event_id = v_source.id
  order by sequence_order;

  if p_include_roster then
    insert into participants (event_id, bib, first_name, last_name, team, category, sex)
    select v_new.id, bib, first_name, last_name, team, category, sex
    from participants
    where event_id = v_source.id;
  end if;

  return v_new;
end;
$$;

revoke all on function clone_event(uuid, boolean, text) from public;
grant execute on function clone_event(uuid, boolean, text) to authenticated;
