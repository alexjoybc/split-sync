-- Crossing correction and audit trail (#65). Today the only correction
-- primitive is soft-delete via crossings.deleted_at; this adds an audited
-- edit (bib/time) and restore path, following the audit-log conventions
-- established for race lifecycle changes (#64 / 20260827000004), and using
-- the is_event_owner()/has_event_role() helpers from #75's volunteer roles
-- (20260827000005_volunteer_roles.sql) so scorer/organizer volunteers get
-- the same correction authority as the event owner.

-- Append-only audit log for per-crossing corrections. `reason` is nullable
-- because the existing plain soft-delete ("Undo" tap) is left unreasoned and
-- unchanged; the guard trigger below requires a reason for every other
-- change (bib, client_recorded_at, restore).
create table crossing_corrections (
  id uuid primary key default gen_random_uuid(),
  crossing_id uuid not null references crossings(id) on delete cascade,
  field_changed text not null check (field_changed in ('bib', 'client_recorded_at', 'deleted_at')),
  previous_value text,
  new_value text,
  actor text not null, -- JWT subject that made the change
  reason text,
  created_at timestamptz not null default now()
);

create index crossing_corrections_crossing_idx on crossing_corrections (crossing_id, created_at);

alter table crossing_corrections enable row level security;

create policy "organizer read crossing corrections" on crossing_corrections for select to authenticated
  using (exists (
    select 1 from crossings
    join races on races.id = crossings.race_id
    join events on events.id = races.event_id
    where crossings.id = crossing_corrections.crossing_id
      and (
        events.owner_id = auth.jwt()->>'sub'
        or has_event_role(events.id, array['organizer', 'scorer']::event_member_role[])
      )
  ));

grant select on crossing_corrections to authenticated;

-- Guard: editing a crossing's bib or client_recorded_at, or restoring a
-- soft-deleted crossing, always requires a reason. This holds regardless of
-- which client performs the write (mirrors races_lifecycle_guard), so the
-- correct_crossing()/restore_crossing() functions below are the only
-- practical way to make these changes even though "organizer update
-- crossings" still permits the underlying UPDATE. Deleting (soft-delete,
-- deleted_at null -> not null) is intentionally left unreasoned to preserve
-- the existing one-tap "Undo" flow.
create or replace function crossings_correction_guard()
returns trigger
language plpgsql
as $$
declare
  v_reason text := nullif(current_setting('splitsync.correction_reason', true), '');
begin
  if new.bib is distinct from old.bib and v_reason is null then
    raise exception 'editing a crossing bib requires a reason (use correct_crossing())';
  end if;

  if new.client_recorded_at is distinct from old.client_recorded_at and v_reason is null then
    raise exception 'editing a crossing time requires a reason (use correct_crossing())';
  end if;

  if old.deleted_at is not null and new.deleted_at is null and v_reason is null then
    raise exception 'restoring a crossing requires a reason (use restore_crossing())';
  end if;

  return new;
end;
$$;

create trigger crossings_correction_guard
  before update on crossings
  for each row
  execute function crossings_correction_guard();

-- security definer: authenticated organizers have no insert policy on
-- crossing_corrections (it is an append-only, trigger-managed audit log).
create or replace function crossings_correction_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reason text := nullif(current_setting('splitsync.correction_reason', true), '');
  v_actor text := coalesce(auth.jwt()->>'sub', 'system');
begin
  if new.bib is distinct from old.bib then
    insert into crossing_corrections (crossing_id, field_changed, previous_value, new_value, actor, reason)
    values (new.id, 'bib', old.bib, new.bib, v_actor, v_reason);
  end if;

  if new.client_recorded_at is distinct from old.client_recorded_at then
    insert into crossing_corrections (crossing_id, field_changed, previous_value, new_value, actor, reason)
    values (new.id, 'client_recorded_at', old.client_recorded_at::text, new.client_recorded_at::text, v_actor, v_reason);
  end if;

  if new.deleted_at is distinct from old.deleted_at then
    insert into crossing_corrections (crossing_id, field_changed, previous_value, new_value, actor, reason)
    values (new.id, 'deleted_at', old.deleted_at::text, new.deleted_at::text, v_actor, v_reason);
  end if;

  return null;
end;
$$;

create trigger crossings_correction_audit
  after update on crossings
  for each row
  execute function crossings_correction_audit();

-- Edit a crossing's bib and/or displayed time. The original id/client_id
-- (idempotency key) are never touched. Requires event ownership (or an
-- organizer/scorer event_members role) and a reason.
create or replace function correct_crossing(
  p_crossing_id uuid,
  p_bib text,
  p_client_recorded_at timestamptz,
  p_reason text
)
returns crossings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_crossing crossings;
  v_event_id uuid;
begin
  if btrim(coalesce(p_reason, '')) = '' then
    raise exception 'a reason is required to correct a crossing';
  end if;

  if p_bib is null and p_client_recorded_at is null then
    raise exception 'at least one of bib or client_recorded_at must be provided';
  end if;

  select * into v_crossing from crossings where id = p_crossing_id;
  if v_crossing is null then
    raise exception 'crossing not found';
  end if;

  select event_id into v_event_id from races where id = v_crossing.race_id;

  if not (is_event_owner(v_event_id) or has_event_role(v_event_id, array['organizer', 'scorer']::event_member_role[])) then
    raise exception 'not authorized to correct this crossing';
  end if;

  perform set_config('splitsync.correction_reason', btrim(p_reason), true);

  update crossings
  set bib = coalesce(nullif(btrim(p_bib), ''), bib),
      client_recorded_at = coalesce(p_client_recorded_at, client_recorded_at)
  where id = p_crossing_id
  returning * into v_crossing;

  return v_crossing;
end;
$$;

revoke all on function correct_crossing(uuid, text, timestamptz, text) from public;
grant execute on function correct_crossing(uuid, text, timestamptz, text) to authenticated;

-- Restore a soft-deleted crossing. Requires event ownership (or an
-- organizer/scorer event_members role) and a reason.
create or replace function restore_crossing(p_crossing_id uuid, p_reason text)
returns crossings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_crossing crossings;
  v_event_id uuid;
begin
  if btrim(coalesce(p_reason, '')) = '' then
    raise exception 'a reason is required to restore a crossing';
  end if;

  select * into v_crossing from crossings where id = p_crossing_id;
  if v_crossing is null then
    raise exception 'crossing not found';
  end if;

  if v_crossing.deleted_at is null then
    raise exception 'crossing is not deleted';
  end if;

  select event_id into v_event_id from races where id = v_crossing.race_id;

  if not (is_event_owner(v_event_id) or has_event_role(v_event_id, array['organizer', 'scorer']::event_member_role[])) then
    raise exception 'not authorized to restore this crossing';
  end if;

  perform set_config('splitsync.correction_reason', btrim(p_reason), true);

  update crossings set deleted_at = null where id = p_crossing_id returning * into v_crossing;

  return v_crossing;
end;
$$;

revoke all on function restore_crossing(uuid, text) from public;
grant execute on function restore_crossing(uuid, text) to authenticated;
