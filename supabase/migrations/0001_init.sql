-- Selflight schema.
--
-- Run this in the Supabase SQL editor, or with the Supabase CLI:
--   supabase db push
--
-- Every table is row-level-secured against auth.uid(), so one signed-in user
-- can only ever see their own rows — enforced by the database rather than by
-- application code that might forget a WHERE clause.

/* ------------------------------- profiles ------------------------------- */

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now(),
  -- 'free', 'pro', 'byok', 'team'. Null reads as free, so an account created
  -- before plans existed never gets an unlimited allowance by accident.
  plan text,
  plan_since timestamptz
);

/* ------------------------------- settings ------------------------------- */

-- The whole Design/Assistant panel state, as one document. It's read as a unit
-- and written as a unit, and its shape changes as the app grows, so a column
-- per option would be churn for nothing.
create table if not exists public.user_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

/* ---------------------------- colour packages --------------------------- */

create table if not exists public.palettes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  vars jsonb not null,
  dark boolean not null default false,
  swatch jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists palettes_user_idx on public.palettes (user_id, created_at desc);

/* -------------------------------- chats --------------------------------- */

create table if not exists public.chats (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null default 'New chat',
  -- Ordered ahead of updated_at in the sidebar, so a pinned chat stays at the
  -- top however long ago it was last touched.
  pinned boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists chats_user_idx on public.chats (user_id, updated_at desc);
create index if not exists chats_user_pinned_idx
  on public.chats (user_id, pinned desc, updated_at desc);

-- Keyed by position rather than an identity column, because the client holds the
-- authoritative thread: regenerating a reply replaces turn 5 rather than adding
-- a turn 6, so the browser needs to be able to overwrite a position outright.
create table if not exists public.messages (
  chat_id uuid not null references public.chats (id) on delete cascade,
  position integer not null,
  -- Denormalised so the row-level policy is a plain comparison rather than a
  -- subquery into chats on every read.
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('user', 'selflight')),
  content text not null,
  -- What a search-grounded reply was built from: [{title, url}]. Kept with the
  -- message, because an answer reopened a week later without its citations is
  -- just an assertion.
  sources jsonb not null default '[]'::jsonb,
  -- The reasoning the model wrote before answering, and how long it took. Worth
  -- keeping for the same reason as the sources: it's how you judge the answer.
  thinking text,
  thought_ms integer,
  -- A failed turn is kept so the thread still shows what happened, but it is
  -- never replayed to the model.
  error boolean not null default false,
  -- Full text, not `ilike '%…%'`. A LIKE scan is fine for a hundred messages
  -- and unusable at a hundred thousand. Generated rather than maintained by a
  -- trigger, so it can never drift from the content it indexes.
  search tsvector generated always as (to_tsvector('english', coalesce(content, ''))) stored,
  created_at timestamptz not null default now(),
  primary key (chat_id, position)
);

create index if not exists messages_search_idx on public.messages using gin (search);
-- Finding which chat a phrase is in means grouping by chat, and that needs the
-- owner; the primary key is on (chat_id, position).
create index if not exists messages_user_idx on public.messages (user_id);

/* ------------------------------ connectors ------------------------------ */

create table if not exists public.connectors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  url text not null,
  enabled boolean not null default true,
  has_token boolean not null default false,
  -- Set when the row came from signing into a service ('github', 'vercel',
  -- 'linear', 'notion'); null for a server URL somebody typed in. That's how
  -- the two kinds tell themselves apart in the interface.
  provider text,
  -- Whose account, for display only: a GitHub login, a Notion workspace name.
  account text,
  created_at timestamptz not null default now()
);

create index if not exists connectors_user_idx on public.connectors (user_id);

-- One connection per service per person, so signing in again replaces the
-- token rather than leaving two rows answering for the same account. Partial,
-- because hand-added connectors have no provider and there can be any number.
create unique index if not exists connectors_user_provider_idx
  on public.connectors (user_id, provider)
  where provider is not null;

-- Tokens are deliberately a separate table with RLS on and *no policies*.
-- Policies are what grant access under RLS, so with none defined the anon and
-- authenticated roles can never read this table — not even for their own rows.
-- Only the service-role key used by api/chat.js bypasses RLS, so a token can
-- go in from the browser and be used server-side, but can never come back out.
create table if not exists public.connector_secrets (
  connector_id uuid primary key references public.connectors (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  token text not null,
  -- An OAuth exchange can hand back a token that expires and a second one that
  -- renews it. A refresh token is at least as sensitive as the access token,
  -- so it lives in exactly the same unreadable place.
  refresh_token text,
  expires_at timestamptz,
  updated_at timestamptz not null default now()
);

-- Someone on the bring-your-own-key plan spends their own money, so their key
-- gets exactly the same treatment as a connector token: RLS on, no policies,
-- reachable only by the service role.
create table if not exists public.user_keys (
  user_id uuid primary key references auth.users (id) on delete cascade,
  provider text not null,
  key text not null,
  updated_at timestamptz not null default now()
);

/* --------------------------------- usage -------------------------------- */

-- One row per model call, so a monthly cap can be enforced and a surprise bill
-- can be traced to a user rather than guessed at.
create table if not exists public.usage_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null default 'chat',
  model text,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  -- What it cost, in micro-dollars — millionths of a dollar, so 2.4c is 24000.
  -- An integer because money in a float drifts; bigint because a busy month
  -- overflows an int. Recorded at the moment of the call rather than derived
  -- later, since rates change and a cost recomputed at today's prices against
  -- last quarter's traffic looks precise and isn't.
  cost_micros bigint not null default 0,
  -- Whether the reply paid a per-request search fee. On Sonar that fee is over
  -- half the cost of a message, so a cost is not explainable without it.
  searched boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists usage_user_month_idx on public.usage_events (user_id, created_at desc);
create index if not exists usage_cost_idx on public.usage_events (created_at desc);

/* -------------------------------- failures ------------------------------- */

-- What went wrong, and — deliberately in the same table — the times the
-- assistant said it didn't know. One is a bug and the other is working as
-- intended, but both are evidence of where the product is weak, and separating
-- them would mean only ever looking at one.
create table if not exists public.failures (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  -- Nulled rather than cascaded on account deletion: the person goes, the
  -- record of what broke stays, unattached. No message content is stored here,
  -- so nothing of theirs is left in it.
  user_id uuid references auth.users (id) on delete set null,
  kind text not null,
  -- 'error' (they saw it fail), 'degraded' (it failed, the app recovered),
  -- 'unknown' (the assistant said it didn't know).
  severity text not null default 'error',
  summary text not null,
  detail text,
  context jsonb not null default '{}'::jsonb,
  recovered boolean not null default false,
  recovery text,
  status text not null default 'new',
  fingerprint text not null,
  seen integer not null default 1,
  last_seen_at timestamptz not null default now()
);

-- One open row per distinct failure. This is what stops a single broken
-- connector filing four hundred identical tickets overnight.
create unique index if not exists failures_open_fingerprint_idx
  on public.failures (fingerprint)
  where status in ('new', 'sent');

create index if not exists failures_status_idx on public.failures (status, created_at desc);
create index if not exists failures_user_idx on public.failures (user_id);

/* ------------------------------ row security ---------------------------- */

alter table public.profiles enable row level security;
alter table public.user_settings enable row level security;
alter table public.palettes enable row level security;
alter table public.chats enable row level security;
alter table public.messages enable row level security;
alter table public.connectors enable row level security;
alter table public.connector_secrets enable row level security;
alter table public.usage_events enable row level security;
alter table public.failures enable row level security;
alter table public.user_keys enable row level security;

do $$
declare
  t text;
begin
  -- Same shape for every user-owned table: you may do anything to your own
  -- rows and nothing at all to anyone else's.
  foreach t in array array['profiles', 'user_settings', 'palettes', 'chats', 'messages', 'connectors']
  loop
    execute format('drop policy if exists own_rows on public.%I', t);
    execute format(
      'create policy own_rows on public.%I for all to authenticated using (auth.uid() = %s) with check (auth.uid() = %s)',
      t,
      case when t = 'profiles' then 'id' else 'user_id' end,
      case when t = 'profiles' then 'id' else 'user_id' end
    );
  end loop;
end;
$$;

-- Usage is written by the server and read by the owner; a client must not be
-- able to forge or erase its own usage history.
drop policy if exists read_own_usage on public.usage_events;
create policy read_own_usage on public.usage_events
  for select to authenticated using (auth.uid() = user_id);

-- public.connector_secrets intentionally has no policies. See the comment above.

-- public.failures has none either, for the same reason and one more: nobody
-- should be able to enumerate the ways the product breaks from a browser. It's
-- written by the server and read by api/failures.js, which checks a shared
-- secret rather than a session.

/* -------------------------------- grants -------------------------------- */

-- Supabase already grants new public tables to these roles, but saying it here
-- means the schema stands on its own — and lets the token table be excluded
-- outright rather than only by policy.
grant select, insert, update, delete on
  public.profiles, public.user_settings, public.palettes,
  public.chats, public.messages, public.connectors
  to authenticated;

grant select on public.usage_events to authenticated;

revoke all on public.connector_secrets from anon, authenticated;
revoke all on public.failures from anon, authenticated;
revoke all on public.user_keys from anon, authenticated;

/* ------------------------------- new users ------------------------------ */

-- A profile and a settings row are created with the account so the app never
-- has to handle a signed-in user with nothing behind them.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, nullif(new.raw_user_meta_data ->> 'display_name', ''))
  on conflict (id) do nothing;

  insert into public.user_settings (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

/* ------------------------------ timestamps ------------------------------ */

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists chats_touch on public.chats;
create trigger chats_touch before update on public.chats
  for each row execute function public.touch_updated_at();

drop trigger if exists settings_touch on public.user_settings;
create trigger settings_touch before update on public.user_settings
  for each row execute function public.touch_updated_at();

drop trigger if exists palettes_touch on public.palettes;
create trigger palettes_touch before update on public.palettes
  for each row execute function public.touch_updated_at();

/* --------------------------- keep chats current -------------------------- */

-- Recents order by chats.updated_at, which should move when a message lands
-- rather than only when the title changes.
create or replace function public.touch_chat_on_message()
returns trigger
language plpgsql
as $$
begin
  update public.chats set updated_at = now() where id = new.chat_id;
  return new;
end;
$$;

drop trigger if exists messages_touch_chat on public.messages;
create trigger messages_touch_chat after insert or update on public.messages
  for each row execute function public.touch_chat_on_message();
