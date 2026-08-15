-- Somewhere for the app to admit what went wrong.
--
-- Safe to run on any version and safe to run twice. Run it in the Supabase SQL
-- editor after 0001.
--
-- Two things feed this table. Failures: a model call that errored, a connector
-- that wouldn't answer, a database write that was refused. And, deliberately,
-- the times the assistant said it didn't know — which isn't a bug, but is the
-- most direct evidence there is of where the product is weak.

create table if not exists public.failures (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),

  -- Set to null rather than cascaded when an account is deleted. The person
  -- goes; the engineering record of what broke stays, unattached. Nothing in
  -- this table is message content, so there is nothing of theirs left in it.
  user_id uuid references auth.users (id) on delete set null,

  -- 'model', 'connector', 'store', 'transcribe', 'oauth', 'unknown'.
  kind text not null,
  -- 'error'    — it failed and the person saw that it failed
  -- 'degraded' — it failed and the app recovered; the person got an answer
  -- 'unknown'  — the assistant said it didn't know. Working as intended.
  severity text not null default 'error',

  summary text not null,
  detail text,

  -- Route, provider, model, which connectors were in play, how long it took.
  -- Never the conversation: a failure report that quotes what somebody asked
  -- turns a debugging aid into a transcript.
  context jsonb not null default '{}'::jsonb,

  -- What the app did about it by itself, and whether that worked.
  recovered boolean not null default false,
  recovery text,

  -- 'new' → picked up by the workflow → 'sent' → 'resolved' or 'wontfix'.
  status text not null default 'new',

  -- Same failure, same fingerprint. This is what stops one broken connector
  -- filing four hundred identical tickets overnight.
  fingerprint text not null,
  seen integer not null default 1,
  last_seen_at timestamptz not null default now()
);

create unique index if not exists failures_open_fingerprint_idx
  on public.failures (fingerprint)
  where status in ('new', 'sent');

create index if not exists failures_status_idx on public.failures (status, created_at desc);
create index if not exists failures_user_idx on public.failures (user_id);

-- Same treatment as connector_secrets: row-level security on and no policies at
-- all, so no signed-in user can read this table. It is written by the server and
-- read by the workflow through api/failures.js, which checks a shared secret.
-- A person shouldn't be able to enumerate the ways the product breaks, and a
-- browser has no reason to.
alter table public.failures enable row level security;
revoke all on public.failures from anon, authenticated;

do $$
begin
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'failures'
  ) then
    raise exception 'public.failures was not created';
  end if;
  raise notice 'Polstar failure log is ready.';
end;
$$;
