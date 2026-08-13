-- Connecting a service by signing into it, rather than by pasting a token.
--
-- Safe to run on any version and safe to run twice: every statement checks
-- first. Run it in the Supabase SQL editor after 0001 and 0002.
--
-- What it adds is small: a connector now remembers which service it came from
-- and whose account it is, and a stored token can carry an expiry and the
-- refresh token that outlives it.

-- Which service this row was created from — 'github', 'vercel', 'linear',
-- 'notion'. Null for the hand-added MCP servers that came before this, which is
-- how the two kinds tell themselves apart.
alter table public.connectors
  add column if not exists provider text;

-- Whose account it is, for display only: a GitHub login, a Notion workspace
-- name. Never a token, and never anything the person hasn't already seen.
alter table public.connectors
  add column if not exists account text;

-- One connection per service per person, so signing in again replaces the
-- token instead of leaving two rows racing to answer for the same account.
-- Partial, because the hand-added connectors have no provider and there can be
-- as many of those as you like.
create unique index if not exists connectors_user_provider_idx
  on public.connectors (user_id, provider)
  where provider is not null;

-- Access tokens from an OAuth exchange can expire; the ones from the four
-- services above currently don't, but storing this now means the refresh path
-- can be added later without a migration in the middle of an outage.
alter table public.connector_secrets
  add column if not exists refresh_token text;

alter table public.connector_secrets
  add column if not exists expires_at timestamptz;

-- No policies are added here on purpose. connector_secrets has row-level
-- security on and none at all, which is what makes it unreadable by every
-- signed-in user including the token's owner. A refresh token belongs in
-- exactly the same place as the access token it renews.

do $$
declare
  missing text;
begin
  select string_agg(format('%s.%s', t, c), ', ')
    into missing
  from (values
    ('connectors', 'provider'),
    ('connectors', 'account'),
    ('connector_secrets', 'refresh_token'),
    ('connector_secrets', 'expires_at')
  ) as needed(t, c)
  where not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = needed.t and column_name = needed.c
  );

  if missing is null then
    raise notice 'Selflight connections are ready.';
  else
    raise exception 'Still missing: %', missing;
  end if;
end;
$$;
