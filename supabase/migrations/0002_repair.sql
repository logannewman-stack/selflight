-- Brings an existing database up to date.
--
-- Run this in the Supabase SQL editor if Polstar was set up before these
-- columns existed. It is safe to run on any version, and safe to run twice:
-- every statement checks first.
--
-- The symptom it fixes is chats that appear in the sidebar but open empty, and
-- new messages that never come back after a refresh. Underneath, the app asks
-- for columns the table doesn't have, every read and write fails, and — until
-- the version of the app that ships alongside this file — nothing said so.

alter table public.messages
  add column if not exists sources jsonb not null default '[]'::jsonb;

alter table public.messages
  add column if not exists thinking text;

alter table public.messages
  add column if not exists thought_ms integer;

-- Added at the same time as accounts, but listed here too: a database created
-- from a draft of the schema may predate it.
alter table public.connectors
  add column if not exists has_token boolean not null default false;

-- Confirms the repair worked, rather than leaving you to guess.
do $$
declare
  missing text;
begin
  select string_agg(needed, ', ')
    into missing
  from unnest(array['sources', 'thinking', 'thought_ms']) as needed
  where not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'messages' and column_name = needed
  );

  if missing is null then
    raise notice 'Polstar schema is up to date.';
  else
    raise exception 'Still missing on public.messages: %', missing;
  end if;
end;
$$;
