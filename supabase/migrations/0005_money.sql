-- Counting money, not just tokens.
--
-- Safe to run on any version and safe to run twice. Run it in the Supabase SQL
-- editor after 0001.
--
-- usage_events has counted tokens since the beginning, and tokens are the wrong
-- unit for every decision that matters: whether a plan is profitable, which
-- tier somebody belongs on, what a heavy user is worth. This adds the cost of
-- each call at the moment it happens, and the plan each person is on.

-- Micro-dollars — millionths of a dollar, so 2.4¢ is 24000. An integer because
-- money in a float accumulates error, and a margin figure that drifts is worse
-- than no margin figure. bigint because a busy month overflows an int.
--
-- Recorded per call rather than derived later on purpose: rates change, and a
-- cost recomputed at today's prices against last quarter's traffic is a number
-- that looks precise and isn't.
alter table public.usage_events
  add column if not exists cost_micros bigint not null default 0;

-- Which model actually served it, and whether the reply paid a per-request
-- search fee. Both are already known at the call site and both are needed to
-- explain a cost after the fact.
alter table public.usage_events
  add column if not exists searched boolean not null default true;

-- 'free', 'pro', 'byok', 'team'. Null is read as free by the server, so an
-- account created before this migration behaves correctly rather than getting
-- an unlimited allowance by accident.
alter table public.profiles
  add column if not exists plan text;

-- When the current plan started, for proration and for answering "since when".
alter table public.profiles
  add column if not exists plan_since timestamptz;

-- Someone on the bring-your-own-key plan spends their own money, so their key
-- lives in the same unreadable place as a connector token rather than in the
-- browser. RLS is on with no policies; only the service role reaches it.
create table if not exists public.user_keys (
  user_id uuid primary key references auth.users (id) on delete cascade,
  provider text not null,
  key text not null,
  updated_at timestamptz not null default now()
);

alter table public.user_keys enable row level security;
revoke all on public.user_keys from anon, authenticated;

-- Answering "what did this month cost, per person" without a table scan.
create index if not exists usage_cost_idx on public.usage_events (created_at desc);

do $$
declare
  missing text;
begin
  select string_agg(format('%s.%s', t, c), ', ')
    into missing
  from (values
    ('usage_events', 'cost_micros'),
    ('usage_events', 'searched'),
    ('profiles', 'plan'),
    ('profiles', 'plan_since')
  ) as needed(t, c)
  where not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = needed.t and column_name = needed.c
  );

  if missing is not null then
    raise exception 'Still missing: %', missing;
  end if;

  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'user_keys'
  ) then
    raise exception 'public.user_keys was not created';
  end if;

  raise notice 'Polstar is counting money.';
end;
$$;
