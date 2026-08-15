# Accounts, in about ten minutes

Polstar works with no backend at all — everything sits in one browser. This
folder is what turns it into something people sign into, with their chats and
settings following them between devices.

Two things change once it's set up:

- **Signing in becomes required.** Without it, the first person to find your URL
  spends your Perplexity credits. There is also a per-user monthly token cap —
  see [Spending](#spending) for what to set it to.
- **Connector tokens leave the browser.** They go into a table nobody can read —
  see [Where the tokens live](#where-the-tokens-live).

## 1. Make a project

[supabase.com](https://supabase.com) → **New project**. The free tier is plenty
for testing. Pick a region near you; it's where the database physically is.

## 2. Run the migration

Supabase dashboard → **SQL Editor** → **New query**. Paste the whole of
[`migrations/0001_init.sql`](migrations/0001_init.sql) and run it. It creates
eight tables and locks every one of them to its owner.

With the [Supabase CLI](https://supabase.com/docs/guides/cli) instead:

```bash
supabase link --project-ref <your-ref>
supabase db push
```

## 3. Collect three values

Dashboard → **Project Settings** → **API**.

| Where it goes | Value | Notes |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | Project URL | Public. |
| `VITE_SUPABASE_ANON_KEY` | `anon` `public` key | Public by design — every table it can reach is guarded by row-level security. |
| `SUPABASE_SERVICE_ROLE_KEY` | `service_role` `secret` key | **Bypasses all security.** Server only. Never prefix it with `VITE_`. |

The `VITE_` prefix is not decoration: Vite compiles those two into the JavaScript
it ships to browsers and refuses to ship anything else. That's what keeps the
service-role key on the server.

Locally, add them to `.env.local`. On Vercel, **Settings → Environment
Variables**, then redeploy — Vite bakes them in at build time, so a variable
added after a build isn't in it.

## 4. Point auth at your site

Dashboard → **Authentication** → **URL Configuration**. Set **Site URL** to
where the app runs (`http://localhost:5173` while developing) and add your
production URL to **Redirect URLs**. Sign-in links come back to these addresses,
and Supabase refuses to redirect anywhere not on the list.

While testing, **Authentication → Providers → Email** → turn off *Confirm email*.
Accounts then work the moment you create them. Turn it back on before anyone
real signs up.

## Check it worked

```bash
./supabase/tests/run.sh    # or: npm run test:schema
```

This builds a throwaway database from the migration on a local Postgres — it
never touches your project — and checks two things.

**That the policies isolate people.** It creates two accounts, has one write
chats, messages, palettes, connectors and settings, then becomes the other and
tries to read them, rename them, delete them, and forge rows owned by the first.
38 assertions, including that a signed-out request sees nothing and that deleting
an account takes its data with it.

**That the app's queries match the schema.** Every Supabase call names its
columns as strings, so a typo fails at runtime in someone's browser. The check
reads the source, pulls out every table and column the code asks for, and
compares them against the real database.

## Already set up, and chats open empty?

The app gained columns after the first version of the schema, so a database
created earlier fails every message read and write. Chats keep their titles in
the sidebar and lose their contents — which is what "the history doesn't work"
usually means.

Supabase → **SQL Editor** → run
[`migrations/0002_repair.sql`](migrations/0002_repair.sql). It adds only what's
missing, is safe to run twice, and leaves your existing chats alone. It prints
`Polstar schema is up to date.` when it's done.

`npm run doctor` names the missing columns, and so does the app's own setup
screen.

## Where the tokens live

An MCP connector's auth token is the one genuinely dangerous thing here. It sits
in `connector_secrets`, which has row-level security enabled and **no policies at
all**. Policies are what grant access under RLS, so with none defined no
signed-in user can read that table — not the token's owner, not anyone. Only the
service-role key reaches it, which means only `api/`.

So a token goes in through `api/connectors.js` and comes out only inside a
request to Anthropic. The interface can offer to replace it or remove it, and
can say whether one exists, but cannot show it — because there is no query the
browser can run that would return it. The test suite asserts exactly this,
including from the owner's own session.

## Spending

Every model call writes a row to `usage_events` with its token counts. The server
adds up the current calendar month before answering and refuses past the cap:

```
SELFLIGHT_MONTHLY_TOKEN_CAP=2000000   # per user, per month. 0 removes it.
```

### What a message costs

Perplexity bills two ways at once: per token, and a per-request fee when a reply
actually searches the web. Polstar's thinking-depth setting moves both, because
on Sonar the depth of an answer *is* the cost of it.

| Depth | Model | Tokens (in / out per M) | Search fee | Per message |
| --- | --- | --- | --- | --- |
| Quick | `sonar` | $1 / $1 | ~$5 per 1,000 | **~0.8¢** |
| Balanced *(default)* | `sonar-pro` | $3 / $15 | ~$10 per 1,000 | **~2.6¢** |
| Deep | `sonar-reasoning-pro` | $2 / $8 | ~$14 per 1,000 | **~2.4¢** |

Those per-message figures assume a mid-length conversation: ~4,600 tokens billed
per turn, of which about 90% is input. Input dominates because every turn resends
the thread — `CONTEXT_WINDOW` in `api/prompt.js` is 40 messages, and halving it
roughly halves the input cost of long conversations.

Two things worth noticing in that table. Deep is not the expensive one — Sonar Pro
charges $15 per million output tokens against Reasoning Pro's $8. And search fees
are a third of the bill at these volumes, which is why requests go out with
`enable_search_classifier` set: a reply that doesn't need to search doesn't pay to.

### What a person costs

| | Messages / month | Cost / month |
| --- | --- | --- |
| Tried it, moved on | ~20 | ~$0.50 |
| Real tester, a few times a week | ~120 | **~$3** |
| Daily heavy use | ~300 | ~$7.50 |
| Hits the 2M cap | ~430 | ~$11 *(the ceiling)* |

So the cap is not a budget. It's a circuit breaker for a runaway script or a
shared login — set high enough that using the product normally never touches it,
because a wall in the middle of an evaluation gets you feedback about your billing
rather than your product. **The budget is how many people you invite.**

A six-week test with 20 people lands near **$90**, and cannot exceed about **$330**
with the cap in place. Budget $150–200 and you have room to be wrong.

If that's still more than you want to spend, the lever with the least downside is
the default depth: `depth: "quick"` in `DEFAULT_SETTINGS` (`src/lib/storage.js`)
cuts the per-message cost to about a third. Anyone who wants better answers can
move their own setting up.

Prices were checked in August 2026 and are Perplexity's published rates for the
API, not a resale. Confirm them at
[perplexity.ai pricing](https://docs.perplexity.ai/getting-started/pricing) before
you rely on the totals — they move.

### Watching it

Check this weekly during a test — it's how you find out you were wrong about any
of the above while it's still cheap to be wrong. Usage per person, this month:

```sql
select u.email,
       sum(e.input_tokens)  as input,
       sum(e.output_tokens) as output
from usage_events e
join auth.users u on u.id = e.user_id
where e.created_at >= date_trunc('month', now())
group by u.email
order by output desc;
```

Clients can read their own usage and nothing else — they cannot write or delete
it, so the history can't be forged or erased from a browser.

## What's in the schema

| Table | Holds |
| --- | --- |
| `profiles` | Display name. Created automatically on signup. |
| `user_settings` | The whole Settings panel as one JSON document. |
| `palettes` | Colour packages you've written. |
| `chats` / `messages` | Conversations, with the sources each reply was built from. Messages are keyed by position, so regenerating a reply replaces it rather than appending a second one. |
| `connectors` | MCP servers: name, URL, on/off, and whether a token exists. |
| `connector_secrets` | The tokens. Unreadable by anyone but the server. |
| `usage_events` | One row per model call. |

## If something isn't working

**"Your session expired. Sign in again."** — the browser has a session the server
won't accept. Usually `SUPABASE_SERVICE_ROLE_KEY` belongs to a different project
than `VITE_SUPABASE_URL`.

**Sign-in link goes to the wrong place** — Site URL in step 4.

**Signed in but no chats, and the console says permission denied** — the migration
didn't run, or ran against a different project.

**Everything works but nothing persists between refreshes** — the app is in
local mode, meaning it can't see `VITE_SUPABASE_URL` or `VITE_SUPABASE_ANON_KEY`.
Restart `npm run dev` after editing `.env.local`; Vite reads it at startup.
