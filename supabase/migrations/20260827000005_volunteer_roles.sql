-- Event-scoped volunteer roles + time-limited invite links (#75).
-- Replaces the shared-PIN sketch from #17 (the unused `events.scorer_pin`
-- column) with per-person, revocable access enforced through RLS.
--
-- Roles:
--   organizer  - co-owner: manages roster/races/participants and invites,
--                cannot delete the event or change owner_id.
--   scorer     - records/undoes crossings and starts/finishes races.
--   checkin    - can view the private roster before publish (day-of
--                check-in workflow); no additional writes yet.
--   official   - read-only view of the private event, for classification
--                officials reviewing before publish.
-- The event owner (`events.owner_id`) is not duplicated into this table.

create type event_member_role as enum ('organizer', 'scorer', 'checkin', 'official');

create table event_members (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  user_id text not null, -- JWT subject, matches events.owner_id (see docs/adr/0002)
  role event_member_role not null,
  invited_by text, -- JWT subject of whoever generated the accepted invite
  created_at timestamptz not null default now(),
  unique (event_id, user_id)
);

create index event_members_event_idx on event_members (event_id);
create index event_members_user_idx on event_members (user_id);

create table event_invites (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  role event_member_role not null,
  token text not null unique,
  created_by text not null,
  expires_at timestamptz not null default (now() + interval '14 days'),
  used_at timestamptz,
  used_by text,
  created_at timestamptz not null default now()
);

create index event_invites_event_idx on event_invites (event_id);

alter table event_members enable row level security;
alter table event_invites enable row level security;

grant select, delete on event_members to authenticated;
grant select, insert, delete on event_invites to authenticated;

-- Security-definer helpers so policies never self-reference event_members
-- (avoids RLS recursion) and so the accept-invite flow can run without
-- exposing the invites table to arbitrary SELECTs (tokens are secrets).
create or replace function public.is_event_owner(p_event_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from events where id = p_event_id and owner_id = auth.jwt()->>'sub'
  );
$$;

create or replace function public.has_event_role(p_event_id uuid, p_roles event_member_role[])
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from event_members
    where event_id = p_event_id
      and user_id = auth.jwt()->>'sub'
      and role = any(p_roles)
  );
$$;

grant execute on function public.is_event_owner(uuid) to authenticated;
grant execute on function public.has_event_role(uuid, event_member_role[]) to authenticated;

-- event_members: owner or an 'organizer' member manages the roster of
-- volunteers; any member can see their own row (used to resolve their role).
create policy "owner or organizer view members" on event_members for select to authenticated
  using (
    is_event_owner(event_id)
    or has_event_role(event_id, array['organizer']::event_member_role[])
    or user_id = auth.jwt()->>'sub'
  );

create policy "owner or organizer revoke members" on event_members for delete to authenticated
  using (is_event_owner(event_id) or has_event_role(event_id, array['organizer']::event_member_role[]));

-- event_invites: owner or organizer create/list/revoke invite links.
-- No SELECT-by-anyone policy exists on purpose; looking up an invite by its
-- token goes through preview_event_invite() below instead.
create policy "owner or organizer view invites" on event_invites for select to authenticated
  using (is_event_owner(event_id) or has_event_role(event_id, array['organizer']::event_member_role[]));

create policy "owner or organizer create invites" on event_invites for insert to authenticated
  with check (
    created_by = auth.jwt()->>'sub'
    and (is_event_owner(event_id) or has_event_role(event_id, array['organizer']::event_member_role[]))
  );

create policy "owner or organizer revoke invites" on event_invites for delete to authenticated
  using (is_event_owner(event_id) or has_event_role(event_id, array['organizer']::event_member_role[]));

-- Preview an invite (event title + role) before the visitor signs in.
create type event_invite_preview as (
  event_id uuid,
  event_title text,
  role event_member_role,
  valid boolean
);

create or replace function public.preview_event_invite(p_token text)
returns event_invite_preview
language sql
security definer
set search_path = public
stable
as $$
  select ei.event_id, e.title, ei.role, (ei.used_at is null and ei.expires_at > now())
  from event_invites ei
  join events e on e.id = ei.event_id
  where ei.token = p_token;
$$;

grant execute on function public.preview_event_invite(text) to anon, authenticated;

-- Accept an invite: create/refresh the membership and burn the token.
create or replace function public.accept_event_invite(p_token text)
returns event_members
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite event_invites%rowtype;
  v_member event_members%rowtype;
  v_sub text := auth.jwt()->>'sub';
begin
  if v_sub is null then
    raise exception 'Sign in required to accept an invite.';
  end if;

  select * into v_invite from event_invites where token = p_token for update;
  if not found then
    raise exception 'This invite link is invalid.';
  end if;
  if v_invite.used_at is not null then
    raise exception 'This invite link has already been used.';
  end if;
  if v_invite.expires_at <= now() then
    raise exception 'This invite link has expired.';
  end if;

  insert into event_members (event_id, user_id, role, invited_by)
  values (v_invite.event_id, v_sub, v_invite.role, v_invite.created_by)
  on conflict (event_id, user_id) do update set role = excluded.role
  returning * into v_member;

  update event_invites set used_at = now(), used_by = v_sub where id = v_invite.id;

  return v_member;
end;
$$;

grant execute on function public.accept_event_invite(text) to authenticated;

-- Volunteers can read the private (draft) event they were invited to.
create policy "member read events" on events for select to authenticated
  using (has_event_role(id, array['organizer', 'scorer', 'checkin', 'official']::event_member_role[]));

create policy "member read races" on races for select to authenticated
  using (has_event_role(event_id, array['organizer', 'scorer', 'checkin', 'official']::event_member_role[]));

create policy "member read entries" on entries for select to authenticated
  using (exists (
    select 1 from races
    where races.id = entries.race_id
      and has_event_role(races.event_id, array['organizer', 'scorer', 'checkin', 'official']::event_member_role[])
  ));

create policy "member read crossings" on crossings for select to authenticated
  using (exists (
    select 1 from races
    where races.id = crossings.race_id
      and has_event_role(races.event_id, array['organizer', 'scorer', 'checkin', 'official']::event_member_role[])
  ));

create policy "member read participants" on participants for select to authenticated
  using (has_event_role(event_id, array['organizer', 'scorer', 'checkin', 'official']::event_member_role[]));

-- Scorer (and organizer) volunteers record/undo crossings.
-- Matches the owner-facing "organizer insert active race crossings" policy
-- (see 20260827000004_race_lifecycle.sql): crossings may only be recorded
-- while the race is active, regardless of who is recording them.
create policy "member insert crossings" on crossings for insert to authenticated
  with check (exists (
    select 1 from races
    where races.id = crossings.race_id
      and races.status = 'active'
      and has_event_role(races.event_id, array['organizer', 'scorer']::event_member_role[])
  ));

create policy "member update crossings" on crossings for update to authenticated
  using (exists (
    select 1 from races
    where races.id = crossings.race_id
      and has_event_role(races.event_id, array['organizer', 'scorer']::event_member_role[])
  ))
  with check (exists (
    select 1 from races
    where races.id = crossings.race_id
      and has_event_role(races.event_id, array['organizer', 'scorer']::event_member_role[])
  ));

-- Scorer (and organizer) volunteers start/finish races.
create policy "member update races" on races for update to authenticated
  using (has_event_role(event_id, array['organizer', 'scorer']::event_member_role[]))
  with check (has_event_role(event_id, array['organizer', 'scorer']::event_member_role[]));

-- Organizer-role volunteers manage races/participants/entries like the
-- owner. Entries stay locked to `upcoming` races (see #20260825000005).
create policy "member manage races" on races for all to authenticated
  using (has_event_role(event_id, array['organizer']::event_member_role[]))
  with check (has_event_role(event_id, array['organizer']::event_member_role[]));

create policy "member manage participants" on participants for all to authenticated
  using (has_event_role(event_id, array['organizer']::event_member_role[]))
  with check (has_event_role(event_id, array['organizer']::event_member_role[]));

create policy "member manage upcoming race entries" on entries for all to authenticated
  using (exists (
    select 1 from races
    where races.id = entries.race_id
      and races.status = 'upcoming'
      and has_event_role(races.event_id, array['organizer']::event_member_role[])
  ))
  with check (exists (
    select 1 from races
    where races.id = entries.race_id
      and races.status = 'upcoming'
      and has_event_role(races.event_id, array['organizer']::event_member_role[])
  ));

-- Extend reopen_race() (20260827000004_race_lifecycle.sql) so an
-- organizer-role volunteer has the same lifecycle authority as the owner.
create or replace function reopen_race(p_race_id uuid, p_reason text)
returns races
language plpgsql
security definer
set search_path = public
as $$
declare
  v_race races;
begin
  if btrim(coalesce(p_reason, '')) = '' then
    raise exception 'a reason is required to reopen a race';
  end if;

  select * into v_race from races where id = p_race_id;
  if v_race is null then
    raise exception 'race not found';
  end if;

  if not (is_event_owner(v_race.event_id) or has_event_role(v_race.event_id, array['organizer']::event_member_role[])) then
    raise exception 'not authorized to reopen this race';
  end if;

  if v_race.status <> 'finished' then
    raise exception 'only a finished race can be reopened';
  end if;

  perform set_config('splitsync.reopen_reason', btrim(p_reason), true);

  update races set status = 'active' where id = p_race_id returning * into v_race;

  return v_race;
end;
$$;
