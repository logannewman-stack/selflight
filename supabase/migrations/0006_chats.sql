-- Pinning a chat, and searching inside one.
--
-- Safe to run on any version and safe to run twice. Run it in the Supabase SQL
-- editor after 0001.
--
-- Two things people expect from a chat list and didn't have: a way to keep the
-- conversation they return to at the top, and a way to find the one where they
-- discussed a thing. Sidebar search matched titles only, which finds a chat you
-- already remember the name of — the least useful case.

-- Ordered before updated_at in the sidebar, so a pinned chat stays put no
-- matter how long ago it was touched.
alter table public.chats
  add column if not exists pinned boolean not null default false;

create index if not exists chats_user_pinned_idx
  on public.chats (user_id, pinned desc, updated_at desc);

-- Full text, not `ilike '%…%'`. A LIKE scan is fine for a hundred messages and
-- unusable at a hundred thousand, and this is the sort of thing that's painful
-- to retrofit once there's traffic. Generated rather than trigger-maintained so
-- it can never drift from the content it indexes.
alter table public.messages
  add column if not exists search tsvector
  generated always as (to_tsvector('english', coalesce(content, ''))) stored;

create index if not exists messages_search_idx on public.messages using gin (search);

-- Finding *which chat* a phrase is in means grouping by chat, and the group-by
-- needs the owner. The existing index is on (chat_id, position).
create index if not exists messages_user_idx on public.messages (user_id);

do $$
declare
  missing text;
begin
  select string_agg(format('%s.%s', t, c), ', ')
    into missing
  from (values
    ('chats', 'pinned'),
    ('messages', 'search')
  ) as needed(t, c)
  where not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = needed.t and column_name = needed.c
  );

  if missing is not null then
    raise exception 'Still missing: %', missing;
  end if;
  raise notice 'Selflight chats can be pinned and searched.';
end;
$$;
