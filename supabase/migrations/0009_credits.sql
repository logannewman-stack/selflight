-- Allowances in credits, not tokens.
--
-- Safe to run on any version and safe to run twice. Run it after 0005.
--
-- Tokens were the wrong unit to sell in. Nobody buys "2,300,000 tokens", and
-- worse, a token is not the same amount of money on every model: once the
-- Quick/Balanced/Deep dial started choosing between Haiku, Sonnet and Opus, an
-- account spending its whole allowance on Deep cost three and a half times more
-- than one spending it on Quick — for the same price.
--
-- A credit fixes that. Quick costs 1, Balanced 2, Deep 3, and those weights are
-- set so a credit costs roughly the same (1.0¢–1.2¢) whichever model it buys.
-- The allowance means the same thing however somebody chooses to spend it.
--
-- See api/_pricing.js for the weights and the plans, and pricing.test.mjs for
-- the test that fails when a rate change breaks the relationship.

alter table public.usage_events
  add column if not exists credits integer;

-- Existing rows keep a null rather than a backfilled guess: api/_supabase.js
-- estimates those from tokens at read time, and a null is honest about being
-- an estimate in a way that a written-in number is not.
comment on column public.usage_events.credits is
  'Credits charged for this call. Null on rows written before credits existed; estimated from tokens at read time.';

create index if not exists usage_credits_idx
  on public.usage_events (user_id, created_at desc)
  where credits is not null;

/* --------------------------------- verify -------------------------------- */

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'usage_events' and column_name = 'credits'
  ) then
    raise exception 'usage_events.credits is missing';
  end if;
  raise notice 'Polstar bills in credits.';
end;
$$;
