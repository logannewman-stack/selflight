-- Does the row-level security in 0001_init.sql actually isolate two users?
-- Runs as A, then as B, then as the server's service role, and records what each
-- one could see and do.

\set A '11111111-1111-1111-1111-111111111111'
\set B '22222222-2222-2222-2222-222222222222'

create schema if not exists t;
drop table if exists t.results;
create table t.results (n serial, label text, pass boolean, detail text);
grant usage on schema t to anon, authenticated, service_role;
grant all on t.results to anon, authenticated, service_role;
grant all on sequence t.results_n_seq to anon, authenticated, service_role;

create or replace function t.check(label text, pass boolean, detail text default '')
returns void language sql as $$
  insert into t.results (label, pass, detail) values (label, pass, detail);
$$;

-- Some reads are stopped by a missing grant and some by a policy. Either is a
-- pass; the point is that nothing comes back. Without this the grant-layer
-- refusals would abort the statement and quietly drop the check.
create or replace function t.blocked(label text, query text)
returns void language plpgsql as $$
declare n bigint;
begin
  execute query into n;
  perform t.check(label, n = 0, n || ' row(s) came back');
exception when others then
  perform t.check(label, true, sqlerrm);
end;
$$;

/* ------------------------------ two signups ----------------------------- */

insert into auth.users (id, email, raw_user_meta_data)
values (:'A', 'a@example.com', '{"display_name":"Ann"}'::jsonb),
       (:'B', 'b@example.com', '{}'::jsonb);

select t.check('signup trigger creates a profile',
  (select count(*) from public.profiles) = 2,
  (select count(*)::text from public.profiles));
select t.check('signup trigger creates a settings row',
  (select count(*) from public.user_settings) = 2,
  (select count(*)::text from public.user_settings));
select t.check('display_name comes across from signup metadata',
  (select display_name from public.profiles where id = :'A') = 'Ann');

/* ------------------------------- A works -------------------------------- */

select set_config('request.jwt.claims', json_build_object('sub', :'A')::text, false);
set role authenticated;

select t.check('auth.uid() resolves to the signed-in user', auth.uid() = :'A'::uuid);

insert into public.chats (id, user_id, title)
values ('aaaaaaaa-0000-0000-0000-000000000001', :'A', 'A first chat');
insert into public.messages (chat_id, position, user_id, role, content)
values ('aaaaaaaa-0000-0000-0000-000000000001', 0, :'A', 'user', 'hello from A');
insert into public.palettes (user_id, name, vars) values (:'A', 'A palette', '{}'::jsonb);
insert into public.connectors (id, user_id, name, url)
values ('cccccccc-0000-0000-0000-000000000001', :'A', 'Linear', 'https://mcp.linear.app/sse');
update public.user_settings set settings = '{"tone":"direct"}'::jsonb where user_id = :'A';

select t.check('A can read back their own chat', (select count(*) from public.chats) = 1);
select t.check('A can read back their own message', (select count(*) from public.messages) = 1);
select t.check('A sees only their own settings row', (select count(*) from public.user_settings) = 1);
select t.check('A sees only their own profile', (select count(*) from public.profiles) = 1);
select t.check('the settings write landed',
  (select settings ->> 'tone' from public.user_settings) = 'direct');

-- A message should move the chat up the recents list.
select t.check('a new message touches the chat timestamp',
  (select updated_at > created_at from public.chats where id = 'aaaaaaaa-0000-0000-0000-000000000001'));

do $$
begin
  insert into public.chats (user_id, title) values ('22222222-2222-2222-2222-222222222222', 'forged');
  perform t.check('A cannot create a chat owned by B', false, 'the insert was allowed');
exception when others then
  perform t.check('A cannot create a chat owned by B', true, sqlerrm);
end $$;

/* ------------------------------- B looks --------------------------------- */

reset role;
select set_config('request.jwt.claims', json_build_object('sub', :'B')::text, false);
set role authenticated;

select t.check('B cannot see A''s chats', (select count(*) from public.chats) = 0,
  (select count(*)::text from public.chats));
select t.check('B cannot see A''s messages', (select count(*) from public.messages) = 0,
  (select count(*)::text from public.messages));
select t.check('B cannot see A''s palettes', (select count(*) from public.palettes) = 0);
select t.check('B cannot see A''s connectors', (select count(*) from public.connectors) = 0);
select t.check('B cannot see A''s settings', (select count(*) from public.user_settings) = 1,
  'B sees exactly one settings row: their own');
select t.check('B cannot see A''s profile',
  (select count(*) from public.profiles where id = :'A') = 0);

with attempt as (update public.chats set title = 'vandalised' returning 1)
select t.check('B cannot rename A''s chat', (select count(*) from attempt) = 0);

with attempt as (delete from public.messages returning 1)
select t.check('B cannot delete A''s messages', (select count(*) from attempt) = 0);

/* --------------------------- connector tokens ---------------------------- */

-- The token table has RLS on and no policies, so no signed-in user reaches it —
-- only the server's service-role key does.
do $$
begin
  insert into public.connector_secrets (connector_id, user_id, token)
  values ('cccccccc-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'tok_stolen');
  perform t.check('a signed-in user cannot write a connector token', false, 'the insert was allowed');
exception when others then
  perform t.check('a signed-in user cannot write a connector token', true, sqlerrm);
end $$;

reset role;
select set_config('request.jwt.claims', json_build_object('sub', :'A')::text, false);
set role service_role;

insert into public.connector_secrets (connector_id, user_id, token)
values ('cccccccc-0000-0000-0000-000000000001', :'A', 'tok_real');
select t.check('the server can store a connector token',
  (select count(*) from public.connector_secrets) = 1);

set role authenticated;
select t.blocked('the owner cannot read their own connector token back',
  'select count(*) from public.connector_secrets');

/* ------------------------------- failures ------------------------------- */

-- Same treatment as the token table, for a different reason: nobody should be
-- able to enumerate the ways the product breaks from a browser, or to plant an
-- entry that sends the repair workflow somewhere of their choosing.
set role service_role;
insert into public.failures (kind, severity, summary, fingerprint)
values ('model', 'error', 'a model call failed', 'fp-test-0001');
select t.check('the server can record a failure',
  (select count(*) from public.failures) = 1);

set role authenticated;
select t.blocked('a signed-in user cannot read the failure log',
  'select count(*) from public.failures');
select t.blocked('nor plant an entry in it',
  'insert into public.failures (kind, summary, fingerprint) values (''model'', ''forged'', ''fp-forged'')');

/* ------------------------------- own keys ------------------------------- */

-- Somebody on the bring-your-own-key plan is trusting us with a credential that
-- spends their money. Same treatment as a connector token: unreadable, and not
-- plantable either — a forged row would route their traffic through our key.
set role service_role;
insert into public.user_keys (user_id, provider, key)
values (:'A', 'perplexity', 'pplx-not-a-real-key');
select t.check('the server can store somebody''s own API key',
  (select count(*) from public.user_keys) = 1);

set role authenticated;
select t.blocked('the owner cannot read their own API key back',
  'select count(*) from public.user_keys');
select t.blocked('nor plant one for somebody else',
  'insert into public.user_keys (user_id, provider, key) values (''00000000-0000-0000-0000-000000000009'', ''perplexity'', ''stolen'')');

/* -------------------------------- usage --------------------------------- */

set role service_role;
insert into public.usage_events (user_id, model, input_tokens, output_tokens)
values (:'A', 'a-model', 1200, 800);

set role authenticated;
select t.check('a user can read their own usage',
  (select count(*) from public.usage_events) = 1);

do $$
begin
  insert into public.usage_events (user_id, kind) values ('11111111-1111-1111-1111-111111111111', 'chat');
  perform t.check('a user cannot forge usage', false, 'the insert was allowed');
exception when others then
  perform t.check('a user cannot forge usage', true, sqlerrm);
end $$;

select t.blocked('a user cannot erase their usage history',
  'with a as (delete from public.usage_events returning 1) select count(*) from a');

reset role;
select set_config('request.jwt.claims', json_build_object('sub', :'B')::text, false);
set role authenticated;
select t.check('B cannot see A''s usage', (select count(*) from public.usage_events) = 0);

/* ------------------------------ no claims -------------------------------- */

reset role;
select set_config('request.jwt.claims', '', false);
set role anon;
select t.blocked('a request with no session sees nothing',
  'select count(*) from public.chats');

/* ------------------------------- cascade -------------------------------- */

reset role;
delete from auth.users where id = :'A';
select t.check('deleting the account removes their chats',
  (select count(*) from public.chats) = 0);
select t.check('deleting the account removes their messages',
  (select count(*) from public.messages) = 0);
select t.check('deleting the account removes their connector tokens',
  (select count(*) from public.connector_secrets) = 0);
select t.check('deleting the account removes their profile',
  (select count(*) from public.profiles where id = :'A') = 0);
select t.check('B is untouched by A''s deletion',
  (select count(*) from public.profiles where id = :'B') = 1);

/* -------------------------------- report -------------------------------- */

\pset border 2
select n, case when pass then 'PASS' else 'FAIL' end as result, label,
       left(replace(detail, e'\n', ' '), 44) as detail
from t.results order by n;

select count(*) filter (where pass) || '/' || count(*) || ' checks passed' as summary
from t.results;

select case when count(*) = 0 then 'ok' else 'FAILURES: ' || string_agg(label, '; ') end as verdict
from t.results where not pass;
