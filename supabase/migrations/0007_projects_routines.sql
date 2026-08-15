-- Projects, and routines.
--
-- Safe to run on any version and safe to run twice. Run it in the Supabase SQL
-- editor after 0001.
--
-- A project is a folder with a memory: chats belong to it, and its instructions
-- go into the system prompt for every one of them. "You are helping with the
-- Q3 launch, here's the context" said once instead of at the top of every chat.
--
-- A routine is the same thing on a timer. It holds a prompt, when to run it,
-- and where the answer goes. Deliberately not a node graph: three questions —
-- when, what, where — because the people this is for are not going to wire a
-- canvas together, and almost everything they'd want from one is a scheduled
-- question with the answer sent somewhere.

/* -------------------------------- projects ------------------------------- */

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  -- Folded into the system prompt for every chat in the project. Capped in the
  -- application at 4000 characters, which is a page and a half of context.
  instructions text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists projects_user_idx on public.projects (user_id, updated_at desc);

-- Deleting a project keeps its conversations; they just stop being in it. The
-- alternative is a delete that silently takes a month of chats with it.
alter table public.chats
  add column if not exists project_id uuid references public.projects (id) on delete set null;

create index if not exists chats_project_idx on public.chats (project_id, updated_at desc);

/* -------------------------------- routines ------------------------------- */

create table if not exists public.routines (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- A routine can belong to a project, and then it inherits its instructions
  -- exactly as a chat in that project would.
  project_id uuid references public.projects (id) on delete set null,

  name text not null,
  prompt text not null,

  -- When. `every` is the cadence; the rest qualify it.
  every text not null default 'day',
  -- Minutes past midnight in `zone`. 480 is 08:00.
  at_minute integer not null default 480,
  -- 0 = Sunday, for every = 'week'.
  weekday integer,
  -- 1..28 only, for every = 'month' — no routine should silently skip February.
  day_of_month integer,
  -- An IANA name. Stored rather than an offset so 8am stays 8am across a
  -- daylight-saving change instead of drifting to 7 or 9.
  zone text not null default 'UTC',

  -- Where the answer goes. Any combination of "chat", "email", "webhook".
  deliver jsonb not null default '["chat"]'::jsonb,
  email text,
  webhook text,

  enabled boolean not null default true,
  -- The scheduler reads this and nothing else, so a cadence change takes effect
  -- by rewriting one column.
  next_run_at timestamptz,
  last_run_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint routines_every_known check (every in ('hour', 'day', 'weekday', 'week', 'month')),
  constraint routines_minute_in_day check (at_minute between 0 and 1439),
  constraint routines_weekday_valid check (weekday is null or weekday between 0 and 6),
  constraint routines_day_valid check (day_of_month is null or day_of_month between 1 and 28)
);

-- The scheduler's only query: what is due. Partial, because a disabled routine
-- is never due and there's no reason to walk it.
create index if not exists routines_due_idx
  on public.routines (next_run_at)
  where enabled;

create index if not exists routines_user_idx on public.routines (user_id, created_at);

/* ------------------------------ what happened ---------------------------- */

-- One row per firing, kept whether it worked or not. A routine that quietly
-- stopped producing anything is the failure mode worth being able to see, and
-- "it ran and returned nothing" looks identical to "it never ran" without this.
create table if not exists public.routine_runs (
  id uuid primary key default gen_random_uuid(),
  routine_id uuid not null references public.routines (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  -- Null when delivery didn't include a chat, or the chat write failed.
  chat_id uuid references public.chats (id) on delete set null,
  status text not null default 'ok',
  -- The first line of the answer, so a list of runs is readable without
  -- opening each one.
  summary text,
  detail text,
  delivered jsonb not null default '[]'::jsonb,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cost_micros bigint not null default 0,
  ms integer,
  created_at timestamptz not null default now(),

  constraint routine_runs_status_known check (status in ('ok', 'failed', 'skipped'))
);

create index if not exists routine_runs_routine_idx
  on public.routine_runs (routine_id, created_at desc);

/* ------------------------------- who sees what --------------------------- */

alter table public.projects enable row level security;
alter table public.routines enable row level security;
alter table public.routine_runs enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['projects', 'routines', 'routine_runs']
  loop
    execute format('drop policy if exists own_rows on public.%I', t);
    execute format(
      'create policy own_rows on public.%I for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id)',
      t
    );
  end loop;
end;
$$;

/* --------------------------------- verify -------------------------------- */

do $$
declare
  missing text;
begin
  select string_agg(format('%s.%s', t, c), ', ')
    into missing
  from (values
    ('projects', 'instructions'),
    ('chats', 'project_id'),
    ('routines', 'next_run_at'),
    ('routines', 'zone'),
    ('routine_runs', 'summary')
  ) as needed(t, c)
  where not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = needed.t and column_name = needed.c
  );

  if missing is not null then
    raise exception 'Still missing: %', missing;
  end if;
  raise notice 'Polstar has projects and routines.';
end;
$$;
