-- ADR: docs/adr/0027-shared-session-event-sourcing.md
--
-- Replace the original single-stopwatch casual-session schema with the shared
-- multi-timer event log. The event log is canonical; shared_sessions.state is
-- a transactionally updated cache for reconnect and live-view reads.

-- Stop the old job before removing the tables it references.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'casual_sessions_expiry') then
    perform cron.unschedule('casual_sessions_expiry');
  end if;
end $$;

-- These functions depend on the old composite table types, so explicitly
-- remove the complete old RPC surface before dropping its tables.
drop function if exists create_casual_session(text, text);
drop function if exists join_casual_session(text, text, uuid);
drop function if exists record_session_event(uuid, uuid, text, timestamptz, uuid);
drop function if exists get_session_state(uuid, uuid);
drop function if exists close_casual_session(uuid);
drop function if exists delete_casual_session(uuid);
drop function if exists get_casual_session_results(text);
drop function if exists get_casual_session_live_view(text);
drop function if exists generate_session_code();

-- Note: dropping the tables below automatically removes them from the
-- supabase_realtime publication (Postgres removes dropped tables from
-- publications automatically via dependency tracking).

drop table if exists casual_session_events;
drop table if exists casual_session_participants;
drop table if exists casual_sessions;

create table shared_sessions (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null,
  name text not null check (char_length(name) between 1 and 80),
  code text unique not null,
  status text not null default 'waiting'
    check (status in ('waiting', 'running', 'stopped', 'closed')),
  expires_at timestamptz not null,
  sequence bigint not null default 0,
  state jsonb not null default '{"timers":[],"timer_order":[],"repeat_config":null}'::jsonb,
  created_at timestamptz not null default now()
);

create table shared_session_participants (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references shared_sessions(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 30),
  client_id uuid not null,
  joined_at timestamptz not null default now(),
  is_owner boolean not null default false,
  unique (session_id, client_id)
);

create table shared_session_events (
  id uuid primary key,
  session_id uuid not null references shared_sessions(id) on delete cascade,
  actor_participant_id uuid not null references shared_session_participants(id),
  timer_id uuid,
  type text not null check (type in (
    'start', 'pause', 'lap', 'reset', 'complete', 'timer_added',
    'timer_removed', 'timer_renamed', 'timers_reordered',
    'session_renamed', 'repeat_config_set'
  )),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  client_recorded_at timestamptz not null,
  server_received_at timestamptz not null default now(),
  sequence bigint generated always as identity
);

create index shared_sessions_owner_id_idx on shared_sessions(owner_id);
create index shared_sessions_expires_at_idx on shared_sessions(expires_at);
create index shared_session_participants_session_client_idx on shared_session_participants(session_id, client_id);
create index shared_session_events_session_sequence_idx on shared_session_events(session_id, sequence);

alter table shared_sessions enable row level security;
alter table shared_session_participants enable row level security;
alter table shared_session_events enable row level security;

-- Owners can list their sessions. Every participant and event operation,
-- including every anonymous operation, goes through the narrow RPC surface.
create policy "owner can read own shared sessions"
  on shared_sessions for select to authenticated
  using (owner_id = auth.uid()::text);
revoke all on shared_sessions, shared_session_participants, shared_session_events from anon;
revoke all on shared_sessions, shared_session_participants, shared_session_events from authenticated;
grant select on shared_sessions to authenticated;

create or replace function generate_shared_session_code()
returns text language plpgsql set search_path = public as $$
declare
  alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  code text := '';
  i int;
begin
  for i in 1..6 loop
    code := code || substr(alphabet, floor(random() * length(alphabet))::int + 1, 1);
  end loop;
  return code;
end;
$$;

-- The cached state deliberately stores only presentation/derivation inputs,
-- never participant bearer ids. Timer-specific state is keyed by timer_id.
create or replace function reduce_shared_session_state(
  p_state jsonb, p_type text, p_timer_id uuid, p_payload jsonb,
  p_recorded_at timestamptz
) returns jsonb language plpgsql immutable set search_path = public as $$
declare
  v_state jsonb := coalesce(p_state, '{"timers":[],"timer_order":[],"repeat_config":null}'::jsonb);
  v_timers jsonb := coalesce(v_state->'timers', '[]'::jsonb);
  v_timer jsonb;
  v_found boolean;
  v_status text;
begin
  if p_type = 'session_renamed' then
    return jsonb_set(v_state, '{name}', to_jsonb(p_payload->>'name'), true);
  elsif p_type = 'timers_reordered' then
    return jsonb_set(v_state, '{timer_order}', coalesce(p_payload->'timer_ids', '[]'::jsonb), true);
  elsif p_type = 'repeat_config_set' then
    return jsonb_set(v_state, '{repeat_config}', p_payload, true);
  elsif p_type = 'timer_added' then
    v_timer := jsonb_build_object(
      'id', p_timer_id, 'name', coalesce(p_payload->>'name', 'Timer'),
      'status', 'waiting', 'laps', '[]'::jsonb, 'config', coalesce(p_payload->'config', '{}'::jsonb)
    );
    return jsonb_set(
      jsonb_set(v_state, '{timers}', v_timers || v_timer, true),
      '{timer_order}', coalesce(v_state->'timer_order', '[]'::jsonb) || to_jsonb(p_timer_id), true
    );
  elsif p_type = 'timer_removed' then
    return jsonb_set(
      jsonb_set(v_state, '{timers}', (select coalesce(jsonb_agg(t), '[]'::jsonb) from jsonb_array_elements(v_timers) t where t->>'id' <> p_timer_id::text), true),
      '{timer_order}', (select coalesce(jsonb_agg(id), '[]'::jsonb) from jsonb_array_elements(coalesce(v_state->'timer_order', '[]'::jsonb)) id where id #>> '{}' <> p_timer_id::text), true
    );
  end if;

  select value into v_timer from jsonb_array_elements(v_timers) where value->>'id' = p_timer_id::text;
  v_found := found;
  if not v_found then raise exception 'TIMER_NOT_FOUND'; end if;
  if p_type = 'timer_renamed' then
    v_timer := jsonb_set(v_timer, '{name}', to_jsonb(p_payload->>'name'), true);
  elsif p_type = 'start' then
    v_timer := jsonb_set(jsonb_set(v_timer, '{status}', '"running"'::jsonb, true), '{started_at}', to_jsonb(p_recorded_at), true);
  elsif p_type = 'pause' then
    v_timer := jsonb_set(v_timer, '{status}', '"stopped"'::jsonb, true);
  elsif p_type = 'complete' then
    v_timer := jsonb_set(v_timer, '{status}', '"complete"'::jsonb, true);
  elsif p_type = 'reset' then
    v_timer := jsonb_set(jsonb_set(v_timer, '{status}', '"waiting"'::jsonb, true), '{laps}', '[]'::jsonb, true);
  elsif p_type = 'lap' then
    v_status := coalesce(v_timer->>'status', 'waiting');
    if v_status <> 'running' then raise exception 'TIMER_NOT_RUNNING'; end if;
    v_timer := jsonb_set(v_timer, '{laps}', coalesce(v_timer->'laps', '[]'::jsonb) || jsonb_build_object('recorded_at', p_recorded_at, 'payload', p_payload), true);
  else
    raise exception 'INVALID_EVENT_TYPE';
  end if;
  return jsonb_set(v_state, '{timers}', (select jsonb_agg(case when t->>'id' = p_timer_id::text then v_timer else t end) from jsonb_array_elements(v_timers) t), true);
end;
$$;

create or replace function create_shared_session(p_name text, p_display_name text)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_owner_id text := auth.uid()::text;
  v_code text;
  v_session_id uuid;
  v_participant_id uuid;
  v_attempts int := 0;
begin
  if v_owner_id is null then raise exception 'UNAUTHENTICATED'; end if;
  if char_length(trim(p_name)) not between 1 and 80 then raise exception 'INVALID_NAME'; end if;
  if char_length(trim(p_display_name)) not between 1 and 30 then raise exception 'INVALID_DISPLAY_NAME'; end if;
  loop
    v_code := generate_shared_session_code();
    begin
      insert into shared_sessions(owner_id, name, code, expires_at, state)
      values (v_owner_id, trim(p_name), v_code, now() + interval '4 hours', jsonb_build_object('name', trim(p_name), 'timers', '[]'::jsonb, 'timer_order', '[]'::jsonb, 'repeat_config', null))
      returning id into v_session_id;
      exit;
    exception when unique_violation then
      v_attempts := v_attempts + 1;
      if v_attempts > 10 then raise exception 'CODE_GENERATION_FAILED'; end if;
    end;
  end loop;
  insert into shared_session_participants(session_id, display_name, client_id, is_owner)
  values (v_session_id, trim(p_display_name), gen_random_uuid(), true) returning id into v_participant_id;
  return json_build_object('session_id', v_session_id, 'participant_id', v_participant_id, 'code', v_code, 'session_name', trim(p_name));
end;
$$;

create or replace function join_shared_session(p_code text, p_display_name text, p_client_id uuid)
returns json language plpgsql security definer set search_path = public as $$
declare v_session shared_sessions; v_participant_id uuid;
begin
  select * into v_session from shared_sessions where code = upper(trim(p_code)) for update;
  if not found or v_session.expires_at < now() or v_session.status in ('stopped', 'closed') then raise exception 'SESSION_NOT_JOINABLE'; end if;
  if char_length(trim(p_display_name)) not between 1 and 30 then raise exception 'INVALID_DISPLAY_NAME'; end if;
  select id into v_participant_id from shared_session_participants where session_id = v_session.id and client_id = p_client_id;
  if found then return json_build_object('session_id', v_session.id, 'participant_id', v_participant_id, 'session_name', v_session.name, 'code', v_session.code); end if;
  if (select count(*) from shared_session_participants where session_id = v_session.id) >= 10 then raise exception 'SESSION_FULL'; end if;
  insert into shared_session_participants(session_id, display_name, client_id) values (v_session.id, trim(p_display_name), p_client_id) returning id into v_participant_id;
  return json_build_object('session_id', v_session.id, 'participant_id', v_participant_id, 'session_name', v_session.name, 'code', v_session.code);
end;
$$;

create or replace function record_session_event(
  p_session_id uuid, p_participant_id uuid, p_timer_id uuid, p_type text,
  p_payload jsonb, p_client_recorded_at timestamptz, p_client_event_id uuid
) returns json language plpgsql security definer set search_path = public as $$
declare v_session shared_sessions; v_participant shared_session_participants; v_event shared_session_events; v_state jsonb; v_status text;
begin
  select * into v_participant from shared_session_participants where id = p_participant_id and session_id = p_session_id;
  if not found then raise exception 'UNAUTHORIZED'; end if;
  select * into v_event from shared_session_events where id = p_client_event_id;
  if found then
    if v_event.session_id <> p_session_id then raise exception 'UNAUTHORIZED'; end if;
    return row_to_json(v_event);
  end if;
  select * into v_session from shared_sessions where id = p_session_id for update;
  if not found then raise exception 'SESSION_NOT_FOUND'; end if;
  if v_session.status = 'closed' or v_session.expires_at < now() then raise exception 'SESSION_CLOSED'; end if;
  if p_type not in ('start', 'pause', 'lap', 'reset', 'complete', 'timer_added', 'timer_removed', 'timer_renamed', 'timers_reordered', 'session_renamed', 'repeat_config_set') then raise exception 'INVALID_EVENT_TYPE'; end if;
  -- The five-argument legacy overload may initialize its one default timer
  -- for any existing participant, preserving the prior shared stopwatch
  -- contract. Other structural changes remain owner-only.
  if p_type in ('timer_added', 'timer_removed', 'timer_renamed', 'timers_reordered', 'session_renamed', 'repeat_config_set')
    and not v_participant.is_owner
    and not (
      p_type = 'timer_added'
      and coalesce(p_payload->>'legacy_default_timer', 'false') = 'true'
      and jsonb_array_length(coalesce(v_session.state->'timers', '[]'::jsonb)) = 0
    ) then
    raise exception 'UNAUTHORIZED';
  end if;
  if p_type in ('timer_added', 'timer_removed', 'timer_renamed', 'start', 'pause', 'lap', 'reset', 'complete') and p_timer_id is null then raise exception 'TIMER_REQUIRED'; end if;
  if p_type = 'timer_added' and exists (select 1 from jsonb_array_elements(coalesce(v_session.state->'timers', '[]'::jsonb)) t where t->>'id' = p_timer_id::text) then raise exception 'TIMER_ALREADY_EXISTS'; end if;
  if p_type in ('timer_removed', 'timer_renamed', 'start', 'pause', 'lap', 'reset', 'complete') and not exists (select 1 from jsonb_array_elements(coalesce(v_session.state->'timers', '[]'::jsonb)) t where t->>'id' = p_timer_id::text) then raise exception 'TIMER_NOT_FOUND'; end if;
  if p_type = 'timers_reordered' and not jsonb_path_exists(coalesce(p_payload, '{}'::jsonb), '$.timer_ids') then raise exception 'INVALID_TIMER_ORDER'; end if;
  if p_type in ('timer_renamed', 'session_renamed') and char_length(trim(p_payload->>'name')) not between 1 and 80 then raise exception 'INVALID_NAME'; end if;
  v_state := reduce_shared_session_state(v_session.state, p_type, p_timer_id, coalesce(p_payload, '{}'::jsonb), p_client_recorded_at);
  insert into shared_session_events(id, session_id, actor_participant_id, timer_id, type, payload, client_recorded_at)
  values (p_client_event_id, p_session_id, p_participant_id, p_timer_id, p_type, coalesce(p_payload, '{}'::jsonb), p_client_recorded_at) returning * into v_event;
  v_status := case when exists (select 1 from jsonb_array_elements(coalesce(v_state->'timers', '[]'::jsonb)) t where t->>'status' = 'running') then 'running'
                   when jsonb_array_length(coalesce(v_state->'timers', '[]'::jsonb)) > 0 and not exists (select 1 from jsonb_array_elements(v_state->'timers') t where t->>'status' = 'waiting') then 'stopped'
                   else 'waiting' end;
  update shared_sessions set name = case when p_type = 'session_renamed' then p_payload->>'name' else name end,
    state = jsonb_set(jsonb_set(v_state, '{sequence}', to_jsonb(v_event.sequence), true), '{status}', to_jsonb(v_status), true), sequence = v_event.sequence, status = v_status,
    expires_at = case when p_type in ('start', 'lap') then least(greatest(expires_at, now() + interval '30 minutes'), created_at + interval '12 hours') else expires_at end
  where id = p_session_id;
  return row_to_json(v_event);
end;
$$;

create or replace function get_session_state(p_session_id uuid, p_participant_id uuid)
returns json language plpgsql security definer set search_path = public as $$
declare v_session shared_sessions;
begin
  if not exists (select 1 from shared_session_participants where id = p_participant_id and session_id = p_session_id) then raise exception 'UNAUTHORIZED'; end if;
  select * into v_session from shared_sessions where id = p_session_id;
  if not found then raise exception 'SESSION_NOT_FOUND'; end if;
  return json_build_object('session_id', v_session.id, 'session_name', v_session.name, 'code', v_session.code, 'status', v_session.status, 'expires_at', v_session.expires_at, 'sequence', v_session.sequence, 'state', v_session.state,
    't0_server', (select client_recorded_at from shared_session_events where session_id = v_session.id and type = 'start' order by sequence desc limit 1),
    'participants', (select coalesce(json_agg(json_build_object('id', id, 'display_name', display_name, 'is_owner', is_owner, 'joined_at', joined_at) order by joined_at), '[]'::json) from shared_session_participants where session_id = p_session_id),
    'events', (select coalesce(json_agg(json_build_object('id', id, 'event_type', case type when 'complete' then 'stop' else type end, 'client_recorded_at', client_recorded_at, 'actor_participant_id', actor_participant_id, 'sequence', sequence, 't0_server', case when type = 'start' then client_recorded_at else null end) order by sequence), '[]'::json) from shared_session_events where session_id = p_session_id));
end;
$$;

-- Keep the original single-timer client contract available while the
-- multi-timer clients are rolled out. It records events through the canonical
-- reducer using a lazily-created default timer; new clients use the seven
-- argument overload above directly.
create or replace function record_session_event(
  p_session_id uuid, p_participant_id uuid, p_event_type text,
  p_client_recorded_at timestamptz, p_client_event_id uuid
) returns json language plpgsql security definer set search_path = public as $$
declare
  v_session shared_sessions;
  v_timer_id uuid;
  v_event json;
  v_type text;
begin
  if p_event_type not in ('start', 'lap', 'stop', 'reset') then raise exception 'INVALID_EVENT_TYPE'; end if;
  select * into v_session from shared_sessions where id = p_session_id;
  if not found then raise exception 'SESSION_NOT_FOUND'; end if;
  select (timer->>'id')::uuid into v_timer_id from jsonb_array_elements(coalesce(v_session.state->'timers', '[]'::jsonb)) timer limit 1;
  if v_timer_id is null then
    if p_event_type <> 'start' then raise exception 'TIMER_NOT_FOUND'; end if;
    v_timer_id := gen_random_uuid();
    perform record_session_event(p_session_id, p_participant_id, v_timer_id, 'timer_added', jsonb_build_object('name', 'Timer', 'legacy_default_timer', true), p_client_recorded_at, gen_random_uuid());
  end if;
  v_type := case when p_event_type = 'stop' then 'complete' else p_event_type end;
  v_event := record_session_event(p_session_id, p_participant_id, v_timer_id, v_type, '{}'::jsonb, p_client_recorded_at, p_client_event_id);
  return json_build_object(
    'id', (v_event ->> 'id'),
    'event_type', p_event_type,
    'client_recorded_at', (v_event ->> 'client_recorded_at'),
    'actor_participant_id', (v_event ->> 'actor_participant_id'),
    'sequence', ((v_event ->> 'sequence')::bigint),
    't0_server', (case when p_event_type = 'start' then p_client_recorded_at else null end)
  );
end;
$$;

create or replace function close_shared_session(p_session_id uuid)
returns json language plpgsql security definer set search_path = public as $$
declare v_session shared_sessions;
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED'; end if;
  select * into v_session from shared_sessions where id = p_session_id for update;
  if not found then raise exception 'SESSION_NOT_FOUND'; end if;
  if v_session.owner_id <> auth.uid()::text then raise exception 'UNAUTHORIZED'; end if;
  update shared_sessions set status = 'closed', state = jsonb_set(state, '{status}', '"closed"'::jsonb, true) where id = p_session_id returning * into v_session;
  return row_to_json(v_session);
end;
$$;

create or replace function delete_shared_session(p_session_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED'; end if;
  if not exists (select 1 from shared_sessions where id = p_session_id and owner_id = auth.uid()::text) then raise exception 'UNAUTHORIZED'; end if;
  delete from shared_sessions where id = p_session_id;
end;
$$;

create or replace function get_shared_session_results(p_code text)
returns json language plpgsql security definer set search_path = public as $$
declare v_session shared_sessions;
begin
  select * into v_session from shared_sessions where code = upper(trim(p_code));
  if not found or (v_session.status not in ('stopped', 'closed') and v_session.expires_at >= now()) then raise exception 'RESULTS_NOT_AVAILABLE'; end if;
  return json_build_object('session', json_build_object('name', v_session.name, 'code', v_session.code, 'status', v_session.status, 'created_at', v_session.created_at, 'sequence', v_session.sequence, 'state', v_session.state),
    'participants', (select coalesce(json_agg(json_build_object('display_name', display_name, 'is_owner', is_owner) order by joined_at), '[]'::json) from shared_session_participants where session_id = v_session.id),
    'events', (select coalesce(json_agg(json_build_object('id', e.id, 'timer_id', e.timer_id, 'type', e.type, 'payload', e.payload, 'client_recorded_at', e.client_recorded_at, 'server_received_at', e.server_received_at, 'sequence', e.sequence, 'actor_name', p.display_name) order by e.sequence), '[]'::json) from shared_session_events e join shared_session_participants p on p.id = e.actor_participant_id where e.session_id = v_session.id));
end;
$$;

create or replace function get_shared_session_live_view(p_code text)
returns json language plpgsql security definer set search_path = public as $$
declare v_session shared_sessions;
begin
  select * into v_session from shared_sessions where code = upper(trim(p_code));
  if not found or v_session.expires_at < now() then raise exception 'LIVE_VIEW_NOT_AVAILABLE'; end if;
  return json_build_object('session', json_build_object('name', v_session.name, 'code', v_session.code, 'status', v_session.status, 'sequence', v_session.sequence, 'state', v_session.state, 't0_server', (select client_recorded_at from shared_session_events where session_id = v_session.id and type = 'start' order by sequence desc limit 1)),
    'participants', (select coalesce(json_agg(json_build_object('display_name', display_name, 'is_owner', is_owner) order by joined_at), '[]'::json) from shared_session_participants where session_id = v_session.id),
    'events', (select coalesce(json_agg(json_build_object('event_type', case e.type when 'complete' then 'stop' else e.type end, 'client_recorded_at', e.client_recorded_at, 'actor_name', p.display_name, 'sequence', e.sequence) order by e.sequence), '[]'::json) from shared_session_events e join shared_session_participants p on p.id = e.actor_participant_id where e.session_id = v_session.id));
end;
$$;

revoke all on function create_shared_session(text, text), join_shared_session(text, text, uuid), record_session_event(uuid, uuid, uuid, text, jsonb, timestamptz, uuid), record_session_event(uuid, uuid, text, timestamptz, uuid), get_session_state(uuid, uuid), close_shared_session(uuid), delete_shared_session(uuid), get_shared_session_results(text), get_shared_session_live_view(text) from public;
grant execute on function create_shared_session(text, text), close_shared_session(uuid), delete_shared_session(uuid) to authenticated;
grant execute on function join_shared_session(text, text, uuid), record_session_event(uuid, uuid, uuid, text, jsonb, timestamptz, uuid), record_session_event(uuid, uuid, text, timestamptz, uuid), get_session_state(uuid, uuid), get_shared_session_results(text), get_shared_session_live_view(text) to anon, authenticated;

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'shared_session_events') then
    alter publication supabase_realtime add table shared_session_events;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'shared_session_participants') then
    alter publication supabase_realtime add table shared_session_participants;
  end if;
end $$;

select cron.schedule('shared_sessions_expiry', '0 * * * *', $$
  update shared_sessions set status = 'stopped', state = jsonb_set(state, '{status}', '"stopped"'::jsonb, true)
  where status in ('running', 'waiting') and expires_at < now();
  delete from shared_sessions where status = 'stopped' and expires_at < now() - interval '30 days';
$$);
