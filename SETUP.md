# Getting Polstar running, end to end

Eleven steps, in the order they have to happen. Each one ends with a way to know
it worked, because a step that silently half-worked is what costs the afternoon.

Run `npm run doctor` at any point. It checks every layer and prints the fix for
whatever is broken, so it's the fastest answer to "why isn't this working."

---

## 1 · Get the code running

```bash
git clone https://github.com/logannewman-stack/selflight.git
cd selflight
git checkout claude/llm-from-scratch-gvmxce
npm install
npm run dev
```

**Working when:** http://localhost:5173 shows the Polstar interface. Typing a
message gets an error about a missing API key — that's step 2, and it means the
front end and the server are both alive.

---

## 2 · Add the Perplexity key

Get one at [console.perplexity.ai](https://console.perplexity.ai) — **Billing** tab
to add a card and buy credit, **API Keys** tab to generate the key. Start with
**$20** and leave **Automatic Top Up** off: then $20 is a ceiling rather than a
starting balance.

```bash
cp .env.example .env.local
```

Open `.env.local` and set `PERPLEXITY_API_KEY=pplx-...`

```bash
npm run doctor
```

**Working when:** all three models come back green with a latency figure. That's a
real call to each — if `sonar-pro` doesn't answer here, it won't answer in the app,
and the doctor will say whether the problem is the key, the credit, or a model name
that moved.

Restart `npm run dev` (Vite reads `.env.local` at startup) and send a message.

**Working when:** you get a streamed reply with **Sources** listed underneath it.
Sources are the proof it really searched rather than answering from memory.

> Everything from here is optional. Polstar is fully usable at this point — it
> just stores everything in your browser and has no sign-in. Steps 3–8 add
> accounts, which is what makes it shareable.

---

## 3 · Create the Supabase project

[supabase.com](https://supabase.com) → **New project**. Free tier is plenty.

- **Name:** selflight
- **Database password:** generate one and save it somewhere. You won't need it for
  Polstar, but you'll want it later and it isn't shown again.
- **Region:** nearest you.

Provisioning takes a couple of minutes.

---

## 4 · Run the migration

**SQL Editor** → **New query**. Paste the entire contents of
`supabase/migrations/0001_init.sql` and hit **Run**.

**Working when:** it says Success and **Table Editor** lists eight tables:
`profiles`, `user_settings`, `palettes`, `chats`, `messages`, `connectors`,
`connector_secrets`, `usage_events`.

If you get an error, read which line. Running it twice is safe.

---

## 5 · Copy the three keys

**Project Settings** → **API**.

| Copy this | Into `.env.local` as |
| --- | --- |
| Project URL | `VITE_SUPABASE_URL` |
| `anon` `public` | `VITE_SUPABASE_ANON_KEY` |
| `service_role` `secret` | `SUPABASE_SERVICE_ROLE_KEY` |

Two rules, both load-bearing:

- **Never put `VITE_` in front of the service-role key.** That prefix is what tells
  Vite to compile a value into the JavaScript sent to browsers. The service-role key
  bypasses every security rule in the database.
- **All three from the same project.** Mixing keys from two projects produces a
  sign-in that loops forever with no useful error. The doctor catches this one.

```bash
npm run doctor
```

**Working when:** all eight tables found, schema current, and under **Security**:
"The public key reads nothing without a session."

That second line is the important one. It's the doctor using your public key —
the one that ships to every browser — to try to read other people's data, and
failing.

---

## 6 · Point authentication at your app

**Authentication** → **URL Configuration**:

- **Site URL:** `http://localhost:5173`
- **Redirect URLs:** add `http://localhost:5173`, and your Vercel URL once you have
  it (step 9).

Sign-in links come back to these addresses. Supabase refuses to redirect anywhere
not on the list, which is a good rule that will confuse you once.

**Authentication** → **Providers** → **Email**: turn **Confirm email** *off* for
now. Accounts then work the instant you create them, instead of waiting on a
message. Turn it back on before real people sign up.

---

## 7 · Make an account and check it sticks

Restart `npm run dev`. You should now get a sign-in screen.

1. **Create an account** with any email and a password.
2. Send a message.
3. Open **Settings** → **Appearance** and change the palette and a font.
4. **Hard-refresh** the page.

**Working when:** you're still signed in, the chat is in the sidebar, and your
palette survived. In Supabase's **Table Editor**, `chats` and `messages` have rows
and `user_settings` holds your design choices as JSON.

Then the check that matters: open a **private window**, create a *second* account,
and confirm it sees an empty sidebar. Two accounts, no leakage.

---

## 8 · Push the branch

Vercel deploys a branch. Either merge this one to `main`:

```bash
git checkout main
git merge claude/llm-from-scratch-gvmxce
git push origin main
```

…or leave it and set the production branch in Vercel's settings at step 9.

---

## 9 · Deploy

[vercel.com](https://vercel.com) → **Add New** → **Project** → import
`logannewman-stack/selflight`. Vercel detects Vite and the `api/` folder on its own —
change none of the build settings.

Before the first deploy, **Environment Variables**. Add all five:

```
PERPLEXITY_API_KEY
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
SELFLIGHT_MONTHLY_TOKEN_CAP        2000000
```

Deploy. Then go back to Supabase → **Authentication** → **URL Configuration** and
add the Vercel URL to **Redirect URLs**, and make it the **Site URL**.

> **If you change an environment variable later, redeploy.** Vite compiles the
> `VITE_` ones into the build. Changing one without rebuilding changes nothing.

---

## 10 · Check the deployment

Vercel serves every deployment over https with a valid certificate, and renews it
itself — there is nothing to set up. That matters beyond the padlock: browsers
only hand out a microphone on a secure origin, so dictation works on your Vercel
address and on `localhost`, and nowhere else. Pointing a phone at your laptop's
IP over plain http will never get a microphone, whatever the browser.

```bash
npm run doctor -- https://your-app.vercel.app
```

**Working when:**

- ✓ Answering, on Perplexity
- ✓ A model key is set on the server
- ✓ **Refuses to answer without a sign-in**

That last line is the one to care about. It means the doctor tried to spend your
credit anonymously and was turned away. If it warns instead, the Supabase variables
didn't reach Vercel — fix that before you share the URL with anyone.

Then sign in on the real URL and send a message.

---

## 11 · Let people in, and watch what it costs

Anyone can now create an account at your URL. There's no invite system, so who has
the link *is* the access control.

Once a week, Supabase → **SQL Editor**:

```sql
select u.email,
       count(*)                                   as calls,
       sum(e.input_tokens + e.output_tokens)      as tokens,
       round(sum(e.input_tokens) / 1e6 * 3
           + sum(e.output_tokens) / 1e6 * 15, 2)  as approx_usd
from usage_events e
join auth.users u on u.id = e.user_id
where e.created_at >= date_trunc('month', now())
group by u.email
order by tokens desc;
```

`npm run doctor` prints the same totals in one line if you'd rather.

**Set a credit limit at Perplexity and turn off auto-recharge.** That's the only
ceiling that cannot be exceeded — the per-user cap stops one person running away
with it, but a prepaid balance is what stops everyone at once.

---

## When something breaks

Run `npm run doctor` first. Beyond that:

| What you see | What it is |
| --- | --- |
| "No model API key is set" | `.env.local` missing or `npm run dev` not restarted after editing it. Vite reads it at startup. |
| "Perplexity rejected the request: …" | Passed through verbatim from the API — usually a model name that moved. `TIERS` in `api/prompt.js`. |
| Sign-in loops, or "Your session expired" | The anon and service-role keys are from different projects. The doctor names both. |
| Sign-in link opens the wrong site | **Site URL** in step 6. |
| Signed in, but no chats and console says permission denied | The migration didn't run, or ran on a different project. |
| Nothing persists across refresh | The app is in local mode — it can't see the two `VITE_` variables. Restart the dev server. |
| A style change does nothing | Tailwind's dev cache. `rm -rf node_modules/.vite` and restart. |

## Checking the things that don't announce themselves

```bash
npm test                 # 50 tests: the prompt, the auth gate, the Perplexity stream
npm run test:schema      # builds a throwaway database, has two users attack each other's rows
npm run verify:appearance # every design control, against real computed styles and pixels
```

The schema one is worth running once after step 4, on your own machine, to see the
32 isolation checks pass against a real Postgres. It never touches your project.
