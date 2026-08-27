-- Check-in and start lists (#69).
--
-- Adds a per-event check-in timestamp to the roster and a security-definer
-- RPC so a `checkin`-role volunteer (added read-only in #75/migration
-- 20260827000005) can flip it without being granted a blanket UPDATE on
-- `participants` (which would also let them edit bib/name/team/category).
-- This mirrors the `reopen_race()` pattern: authorization is checked inside
-- the function, and only the one column it's meant to touch is written.

alter table participants add column checked_in_at timestamptz;

create or replace function public.set_participant_checked_in(p_participant_id uuid, p_checked_in boolean)
returns participants
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event_id uuid;
  v_participant participants;
begin
  select event_id into v_event_id from participants where id = p_participant_id;
  if v_event_id is null then
    raise exception 'participant not found';
  end if;

  if not (is_event_owner(v_event_id) or has_event_role(v_event_id, array['organizer', 'checkin']::event_member_role[])) then
    raise exception 'not authorized to check in this participant';
  end if;

  update participants
    set checked_in_at = case when p_checked_in then now() else null end
    where id = p_participant_id
    returning * into v_participant;

  return v_participant;
end;
$$;

grant execute on function public.set_participant_checked_in(uuid, boolean) to authenticated;
