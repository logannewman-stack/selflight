-- Subscriptions.
--
-- Safe to run on any version and safe to run twice. Run it after 0009.
--
-- `plan` has existed since 0001 and nothing has ever set it — it was a text
-- column somebody edited by hand. These columns are what connects it to money:
-- who this account is in Stripe, which subscription is paying for it, and when
-- the current period runs out.
--
-- The important one is `stripe_customer_id`. The webhook arrives knowing only a
-- Stripe customer, so without a way to look that up in one indexed query the
-- only options are a table scan or trusting an id out of the request — and the
-- second one is how somebody grants themselves a plan.

alter table public.profiles
  add column if not exists stripe_customer_id text;

alter table public.profiles
  add column if not exists stripe_subscription_id text;

-- When the paid period ends. Set from the subscription so the app can say "your
-- plan runs until the 4th" after somebody cancels, instead of dropping them to
-- free the moment they click cancel — they've paid for the rest of the month.
alter table public.profiles
  add column if not exists plan_until timestamptz;

-- The last Stripe event applied to this row. Stripe retries webhooks, and
-- events can arrive out of order — a `customer.subscription.updated` for an
-- upgrade can land after the `deleted` for the old subscription. Recording the
-- event id makes a repeat a no-op instead of a second write.
alter table public.profiles
  add column if not exists stripe_event_id text;

-- One Stripe customer maps to exactly one account. A unique index rather than a
-- plain one: two profiles sharing a customer means a webhook has two possible
-- answers to "whose plan is this", and it would pick whichever came back first.
create unique index if not exists profiles_stripe_customer_idx
  on public.profiles (stripe_customer_id)
  where stripe_customer_id is not null;

-- The profiles policy from 0001 lets somebody read their own row. That now
-- includes their plan and period end, which is what the billing screen shows.
-- It does not include write access — plans are only ever set by the service
-- role, from a Stripe webhook whose signature has been verified.

/* --------------------------------- verify -------------------------------- */

do $$
declare
  missing text;
begin
  select string_agg(c, ', ') into missing
  from unnest(array['stripe_customer_id', 'stripe_subscription_id', 'plan_until', 'stripe_event_id']) as c
  where not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = c
  );

  if missing is not null then
    raise exception 'Still missing on profiles: %', missing;
  end if;
  raise notice 'Polstar can take money.';
end;
$$;
