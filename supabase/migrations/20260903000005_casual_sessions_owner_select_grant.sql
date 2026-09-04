-- Fix: "My Sessions" list (web SessionHistory + native HomeScreen) queries
-- `casual_sessions` directly via supabase.from("casual_sessions").select(...).
-- That table was created in 20260830000001_casual_stopwatch_sessions.sql with
-- RLS enabled but *no* table-level GRANT, on the assumption that all access
-- would go through security-definer RPCs. Issue #182 later added a direct
-- select for the owner's session list, which has been failing with Postgres
-- error 42501 ("permission denied for table casual_sessions") ever since —
-- RLS alone does not substitute for the base GRANT that PostgREST checks.
--
-- The existing "owner can manage own sessions" RLS policy already scopes
-- every row to `owner_id = auth.uid()::text`, so granting SELECT to
-- authenticated is safe: a signed-in user can still only see their own rows.
grant select on casual_sessions to authenticated;

-- Also missing: casual_sessions was never added to the supabase_realtime
-- publication, so the existing `casual_sessions_owner` postgres_changes
-- subscription (web + native) never received live updates. Follow the same
-- pattern as 20260829000001_realtime_publication.sql.
do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'casual_sessions'
  ) then
    alter publication supabase_realtime add table casual_sessions;
  end if;
end $$;
