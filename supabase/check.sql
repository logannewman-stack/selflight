-- Which Polstar migrations does this database already have?
--
-- Read-only: it looks at information_schema and nothing else. Safe to run on a
-- live project, and safe to run at any time.
--
-- Paste it into the Supabase SQL editor before applying a migration, so you
-- know what's actually missing rather than guessing. Each row names a file in
-- supabase/migrations; run any that say NOT APPLIED, in numerical order.
--
-- Every migration is written to be safe to run twice, so re-running one that is
-- already applied does nothing — this is for knowing, not for safety.

select
  m.file,
  case when m.present then 'already applied' else 'NOT APPLIED — run it' end as status
from (
  select '0002_repair.sql' as file,
         to_regclass('public.messages') is not null
         and exists (select 1 from information_schema.columns
                     where table_name='messages' and column_name='thinking') as present
  union all
  select '0003_connections.sql',
         exists (select 1 from information_schema.columns
                 where table_name='connectors' and column_name='provider')
  union all
  select '0004_failures.sql',
         to_regclass('public.failures') is not null
  union all
  select '0005_money.sql',
         exists (select 1 from information_schema.columns
                 where table_name='usage_events' and column_name='cost_micros')
  union all
  select '0006_chats.sql',
         exists (select 1 from information_schema.columns
                 where table_name='chats' and column_name='pinned')
  union all
  select '0007_projects_routines.sql',
         to_regclass('public.routines') is not null
  union all
  -- 0008 adds columns rather than a table, so this checks a column.
  select '0008_apis.sql',
         exists (select 1 from information_schema.columns
                 where table_name='connectors' and column_name='base_url')
  union all
  select '0009_credits.sql',
         exists (select 1 from information_schema.columns
                 where table_name='usage_events' and column_name='credits')
) m
order by m.file;
