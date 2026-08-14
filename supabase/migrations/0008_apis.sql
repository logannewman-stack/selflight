-- Connect anything with an API.
--
-- Safe to run on any version and safe to run twice. Run it after 0001.
--
-- Until now a connector meant one thing: a remote MCP server. That covers the
-- handful of services that publish one and nothing else — which is not what
-- "connect it to everything" means. This adds a second kind: a base address and
-- a credential, turned into a tool the model can call.
--
-- The interesting columns are the ones that constrain it. `base_url` pins the
-- host, so the model chooses a path and never a destination. `methods` defaults
-- to read-only, so a connector can only change something if somebody said it
-- could. See api/_apis.js for what those two are actually holding back.

-- 'mcp' for a remote MCP server, 'http' for a plain REST API. Existing rows are
-- all the first kind, which is why the default is what it is.
alter table public.connectors
  add column if not exists kind text not null default 'mcp';

alter table public.connectors
  add column if not exists base_url text;

-- 'bearer' | 'header' | 'query' | 'none'. How the credential is presented.
alter table public.connectors
  add column if not exists auth_style text not null default 'bearer';

-- The header or parameter name, for the two styles that need one.
alter table public.connectors
  add column if not exists auth_name text;

-- What the model may do. Read-only unless somebody widens it: a model that can
-- DELETE by default is a model one confused turn away from a bad afternoon.
alter table public.connectors
  add column if not exists methods jsonb not null default '["GET","HEAD"]'::jsonb;

-- Told to the model in the tool description, so it knows what the thing is for
-- rather than guessing from a hostname.
alter table public.connectors
  add column if not exists description text;

alter table public.connectors
  add column if not exists docs text;

do $$
begin
  if not exists (
    select 1 from information_schema.constraint_column_usage
    where table_name = 'connectors' and constraint_name = 'connectors_kind_known'
  ) then
    alter table public.connectors
      add constraint connectors_kind_known check (kind in ('mcp', 'http'));
  end if;
end;
$$;

-- An http connector without an address is a tool that can't be called.
do $$
begin
  if not exists (
    select 1 from information_schema.constraint_column_usage
    where table_name = 'connectors' and constraint_name = 'connectors_http_has_base'
  ) then
    alter table public.connectors
      add constraint connectors_http_has_base
      check (kind <> 'http' or base_url is not null);
  end if;
end;
$$;

-- A provider used to mean exactly one connector. Google is four — Gmail,
-- Calendar, Drive and Sheets are different hosts and so cannot share one
-- base address — so the key gains the service name.
drop index if exists public.connectors_user_provider_idx;

create unique index if not exists connectors_user_provider_name_idx
  on public.connectors (user_id, provider, name)
  where provider is not null;

/* --------------------------------- verify -------------------------------- */

do $$
declare
  missing text;
begin
  select string_agg(c, ', ') into missing
  from unnest(array['kind', 'base_url', 'auth_style', 'auth_name', 'methods', 'description']) as c
  where not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'connectors' and column_name = c
  );

  if missing is not null then
    raise exception 'Still missing on connectors: %', missing;
  end if;
  raise notice 'Selflight can connect to any API.';
end;
$$;
