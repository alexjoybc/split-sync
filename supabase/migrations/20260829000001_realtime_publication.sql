-- Explicitly add the key tables to the Supabase Realtime publication so
-- server-side postgres_changes filtering works for all clients including
-- anonymous spectators. Uses DO blocks to avoid errors if a table is
-- already in the publication.

do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'crossings'
  ) then
    alter publication supabase_realtime add table crossings;
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'races'
  ) then
    alter publication supabase_realtime add table races;
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'entries'
  ) then
    alter publication supabase_realtime add table entries;
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'race_entry_penalties'
  ) then
    alter publication supabase_realtime add table race_entry_penalties;
  end if;
end $$;
