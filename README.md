# Selflight

A minimal AI workspace — chat with web access and connectors on the left, a
canvas for what gets built on the right, and a code workspace when you want to
build a page from a sentence.

Vite + React on the front end, serverless functions on the back, Postgres
underneath when you want accounts. The model is called from the server so the
API key never reaches the browser, which is what makes this safe to put on a
public URL.

**Setting this up for real?** [SETUP.md](SETUP.md) is the eleven-step version, from
clone to a deployed URL with accounts, and `npm run doctor` checks every layer and
prints the fix for whatever is broken.

## Run it locally

```bash
npm install
cp .env.example .env.local     # then paste your Perplexity API key into it
npm run dev
npm run doctor                 # confirms the key actually works
```

Open http://localhost:5173. `npm run dev` serves the front end *and* the `/api`
functions, so there's nothing else to start.

Get a key at https://console.perplexity.ai. Without one the app loads and
says the key is missing instead of failing silently.

That's the whole setup. Everything is stored in your browser and there's no sign-in.

## Which model answers

**Perplexity** by default. Its Sonar models answer from a live web search rather
than from training data, so replies stay current and arrive with their sources
attached — which the thread shows under each answer. Thinking depth in Customize
picks the model and how widely it reads: `sonar` for quick, `sonar-pro` for
balanced, `sonar-reasoning-pro` for deep.

**Claude** if you set `ANTHROPIC_API_KEY` instead. Dearer, doesn't search by
default, but it's the one that supports MCP connectors and writes replies long
enough for the Code workspace to build a substantial page. Set both keys and
Perplexity wins, so the cheaper one is never a surprise.

The difference is contained in `api/providers/`. The interface asks the server
what it can do and stops offering the rest — the connectors panel says so plainly
rather than accepting a token that will never be used.

## Accounts

Add a Supabase project and the same app grows accounts: sign-in, chats and
settings that follow you between devices, connector tokens kept server-side, and
a per-user monthly spend cap. **[supabase/README.md](supabase/README.md)** is the
ten-minute version.

The one thing worth knowing up front: once a project is configured, **signing in
is required**. Without that, the first person to find your URL spends your
Perplexity credit.

## Deploy

Push to GitHub and import the repo at vercel.com — it detects Vite and the `api/`
folder on its own. Then **Project → Settings → Environment Variables**:

| Variable | |
| --- | --- |
| `PERPLEXITY_API_KEY` | Required — or `ANTHROPIC_API_KEY` for Claude instead. |
| `TRANSCRIBE_API_KEY` | Optional. Dictation in Firefox, which has no speech recognition of its own. |
| `VITE_SUPABASE_URL` | For accounts. |
| `VITE_SUPABASE_ANON_KEY` | For accounts. Public by design. |
| `SUPABASE_SERVICE_ROLE_KEY` | For accounts. Server only — never prefix it with `VITE_`. |
| `SELFLIGHT_MONTHLY_TOKEN_CAP` | Optional, defaults to 2,000,000 per user per month. |

Redeploy after adding them: Vite bakes the `VITE_` ones into the build, so a
variable added after a build isn't in it.

**https is automatic** and worth knowing about, because browsers only hand out a
microphone on a secure origin. Dictation works on the deployed address and on
`localhost`; a plain-http address — a laptop's IP on the local network, say — can
never get one. `npm run doctor -- https://your-app` says which of those you're on.

## What's in it

**Chat** with streaming replies, markdown, auto-generated titles, and history that
survives a refresh — reopening lands you back in the conversation you were reading, not on
a blank one. Signed out, that history is this browser's; signed in, it's the database, and
it follows you between devices. The bar under the composer carries the controls worth having in reach
while you type: web search on or off, and **Iris 6.0** with its effort setting — Quick,
Balanced or Deep, each showing roughly what a message costs, because that's the setting
that decides the bill.

**Dictation.** The microphone in the composer turns speech into text. Chrome, Edge and
Safari recognise it in the browser — free, and words appear live as you talk. Firefox has
no speech recognition at all, so it records instead and posts the audio to
`/api/transcribe`, which needs a `TRANSCRIBE_API_KEY` (Whisper is about $0.006 a minute;
Groq's is a fraction of that). Set one and dictation works for everybody; leave it unset
and the button simply doesn't appear in Firefox rather than failing there. Either way the
text lands in the message box to edit before sending.

**Thinking out loud.** After you send a message, what the model is doing appears above the
answer in quiet, light text — the searches it runs, and on the Deep tier the reasoning it
writes before committing to anything. It scrolls itself while the reply is being written,
then folds to a single line ("Thought for 6s") once the answer arrives, because by then you
want the answer. Click it to read the reasoning again; it's kept with the message, so it's
still there when you reopen the chat a week later.

Only `sonar-reasoning-pro` — the **Deep** setting — writes its reasoning down, so that's the
default. It costs about the same as Balanced: $2/$8 per million against Sonar Pro's $3/$15
roughly cancels the deeper search fee. Set thinking depth to Quick or Balanced and the
narration falls back to the searches alone.

**Web search** is on by default, and on Perplexity it's how answers get written at
all — the sources each reply used are listed underneath it, collapsed past four.
Turning it off asks the model to answer from training data alone, which is faster
and cheaper but knows nothing recent.

**Artifacts.** Code and pages written during a chat collect in the right panel.
HTML and SVG get a live preview; everything gets copy, download, and open-in-a-tab.
Previews run in a sandboxed frame with no access to the app around them.

**Code** (the Home/Code switch in the sidebar) is a build workspace. Describe a page,
watch it get written, see it run, edit the code by hand, and keep asking for changes.
The output is one self-contained HTML file.

**Settings** is one panel with three tabs, reached from the account chip at the bottom
left. **Assistant** sets tone, answer length, thinking depth, what to call you, and
standing instructions — all folded into the system prompt on the server. **Connectors**
attaches remote MCP servers and toggles web search and fetch. **Appearance** is where the
interface is yours to shape:

| Group | Options |
| --- | --- |
| Colour packages | Six built-in palettes, match-system light/dark pairing, nine accent colours *or any colour you pick*, a **main colour** that re-tints the whole interface, plus your own packages — see below |
| Typefaces | 25 faces, chosen separately for interface, replies, and code |
| Typography | Text size, weight, line spacing, letter spacing, paragraph spacing, heading size, reduced motion |
| Layout | Density, conversation width, corner rounding, bubble or plain user messages |
| Code | Code size, wrap long lines, line numbers |
| Behaviour | Send with Enter or ⌘+Enter, open artifacts automatically |

Everything applies instantly, persists, and has a reset that leaves your chats,
instructions, and saved packages alone.

### Recolouring the whole app from one pick

**Main colour** in Appearance is the quick version of a palette. Pick a colour and every
surface and text colour is derived from it — panels, borders, code background, primary and
secondary text — and a dark enough choice flips the app to a dark theme on its own. Contrast
ratios for the pairs that matter appear underneath, so an unreadable choice can't be made
quietly.

The ratios that generate those surfaces aren't invented: they're the ones that reproduce the
hand-made palettes almost exactly when fed Paper's page colour or Midnight's. That's why a
colour you pick lands in the same relationships a designer would have reached for, and why
the hue carries through the greys rather than leaving them flatly neutral.

Accent is separate, and the last swatch in the row opens a colour picker — the nine presets
are a starting point, not the whole set.

### Writing your own colour package

Design → **New package**, or the pencil on any palette (a built-in gets duplicated so the
presets stay intact). You get every colour token the app uses — surfaces, text, accent,
message bubbles, and all seven code colours — each as a swatch and a hex field, previewing
live as you type. Nothing is stored until you save.

Two things make it usable rather than fiddly:

- **Start from** loads every colour from an existing palette. Turning a light theme dark by
  hand means editing ten tokens through an unreadable middle state; rebasing onto a dark
  preset and changing the accent takes two clicks.
- **Readability** shows WCAG contrast ratios for the pairs that matter and flags anything
  under AA. It warns rather than blocks — it's your palette — but you'll know.

A package is plain JSON. Copy it, download it, or paste someone else's into **Import**;
hex and `"r g b"` both work, as does a bare map of colours.

**Naming.** Selflight is the product and the assistant; **Iris 6.0** is what it runs on. The
same split as an app and its model, so the version can move without renaming the product
every time it improves — and so nobody has to learn what `sonar-reasoning-pro` is to
understand what they're talking to. Both live in `src/lib/brand.js`.

## Saying it instead of clicking

Type — or dictate — `make the background sage`, `open settings`, `bigger text`,
`use Lora`, `be more direct`. It happens immediately, and no message is sent.

Nothing about this is voice-specific. The microphone writes into the composer, so
anything you can type you can say, and both take the same path through
`src/lib/commands.js`.

It's parsed **locally**, not by asking the model. That's three things at once:
instant where a round trip is a second of watching nothing happen, free where
every parsed message would otherwise cost about 2.4¢, and deterministic, so
"open settings" always opens settings rather than usually.

The real design problem is the false positive. "Change the tone of this email to
be more direct" contains every word the tone rule looks for, and swallowing it
would cost someone their actual question. Three things hold that down:

- Rules only fire on a known target, and only with something asking for it.
- Questions are never acted on, nor are sentences aimed at a document — a
  demonstrative in front of a piece of writing (`this email`, `my bio`) means the
  work, not the window it's shown in.
- Since neither guard is perfect, every command shows what it changed with
  **Undo** and **Send as a message** beside it. A wrong guess costs one press.

The false positives in `commands.test.mjs` were found by running realistic
messages through the parser rather than by imagining them. "I need to lose
weight" moved the font weight. "The paper I read said dark mode saves battery"
switched themes. Both are regression tests now.

```bash
npm test                  # the parser, including everything it must leave alone
npm run verify:commands   # a real browser: pixels change, no message is sent,
                          # the model isn't called, Undo restores, questions get through
```

## Design system

Worth knowing before you change styles, because these are decisions rather than defaults.

**Type.** Geist for the interface, Geist Mono for code, Source Serif 4 for the wordmark.
One modular scale (`text-2xs` through `text-3xl`) with line-height and letter-spacing baked
into each step, so vertical rhythm holds instead of drifting per component. The catalogue in
`src/lib/fonts.js` holds 25 faces, and only the three defaults ship in `index.html` — the
rest are fetched the first time someone selects one, so a big library costs nothing until
it's used. Atkinson Hyperlegible and Lexend are in there for legibility research reasons
rather than fashion.

**Colour.** Every colour is a CSS variable, so switching a theme is one style write
rather than a re-render — and it's why user-authored packages are first-class rather than
overrides: a saved package is the same shape as a built-in. Each palette carries its own
shadows *and* its own syntax-highlighting colours, so a light theme never inherits a dark
code block, which is the usual tell of a theme system that wasn't finished.

**Code.** `highlight.js` core with a curated language set rather than the full bundle,
mapped to palette variables. Blocks show their language and line count, collapse past 22
lines, and copy in one click.

**Motion and focus.** Transitions are short and eased-out. Keyboard users get a visible
focus ring on every control; pointer users don't. Reduced motion is both a setting and an
honoured OS preference.

**One gotcha while developing.** Tailwind output is cached by the dev server, so editing
`tailwind.config.js` — adding a token, renaming a variable — can leave `npm run dev`
serving the previous CSS while the production build is already correct. If a style change
appears to do nothing, `rm -rf node_modules/.vite` and restart before assuming the code is
wrong.

## Connecting an account

Settings → Connectors → **Connect**. Somebody signs into GitHub, Vercel, Linear
or Notion, comes back, and Selflight holds a token for that account. They never
have to find an API key.

The one-time cost is yours, not theirs: every provider requires the *application*
to be registered before it can act for anyone. That's about five minutes per
service, done once, and then it works for everybody who uses your deployment.

1. Register an app with the provider — the panel links straight to the page.
2. Set the callback URL to `https://your-app.vercel.app/api/oauth?action=callback`.
   It has to match exactly; a trailing slash is a different URL to most of them.
3. Put the client id and secret in Vercel and redeploy:

   | Service | Variables |
   | --- | --- |
   | GitHub | `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` |
   | Vercel | `VERCEL_CLIENT_ID`, `VERCEL_CLIENT_SECRET`, `VERCEL_INTEGRATION_SLUG` |
   | Linear | `LINEAR_CLIENT_ID`, `LINEAR_CLIENT_SECRET` |
   | Notion | `NOTION_CLIENT_ID`, `NOTION_CLIENT_SECRET` |

A service with nothing set doesn't appear as a button you can press and watch
fail — it appears as a row naming the variables it's waiting for and linking to
where to get them. Add one at a time; the others carry on working.

Run [`supabase/migrations/0003_connections.sql`](supabase/migrations/0003_connections.sql)
if your database predates this. `npm run doctor` says whether it does, and names
the columns.

**Worth knowing before you set any of it up.** A connected account reaches the
model through MCP, and MCP is an Anthropic protocol — Perplexity's API has no
equivalent. On Perplexity the sign-in works and the token is stored safely, but
nothing can call it yet. Set `ANTHROPIC_API_KEY` and every connected account
becomes usable in the conversation immediately. The Connectors panel says so too,
rather than leaving you to find out.

### How the return leg knows who you are

The awkward part of OAuth in a single-page app is that the provider sends the
browser back with a plain redirect, which carries no session. Putting the user id
in the URL would let anyone attach a connection to anyone's account.

So the *start* of the flow — which is authenticated — writes the user id into a
ten-minute `HttpOnly` cookie signed with the service-role key, and the callback
trusts nothing else. A forged or edited cookie fails the signature check; so does
one signed with a different deployment's key. `api/oauth.test.mjs` asserts both,
along with the truncated and empty-signature cases.

The token that comes back never reaches a browser. It goes straight into
`connector_secrets`, described below.

## Connectors: read this before adding one

Anthropic's API opens the connection to an MCP server, not your browser. Two
consequences:

- The server must be a **public HTTPS endpoint**. A server on your own machine is
  unreachable, and the app will tell you so rather than failing quietly.
- Hosted MCP servers usually want an **OAuth bearer token**, not the service's normal
  API key. Those are different auth systems and the API key generally won't work.

Connector support is a beta on the Anthropic API. If your key doesn't have it enabled,
Selflight says so in the thread and answers without the connector instead of failing
the message. The same fallback applies to web search.

Signed out, a token you enter is stored in your browser's `localStorage` and sent
to your own serverless function, which forwards it to the API.

Signed in, it never touches the browser's storage. It goes to `api/connectors.js`
and into a table with row-level security on and no policies at all — which means
no signed-in user can read it, the owner included, because there is no query that
would return it. Only the service-role key reaches that table. The panel can
replace a token or remove it, and can say whether one exists, but cannot show it.

## Proving the settings actually do something

Reasonable question for a panel with this many switches. Two suites answer it, and you can
run both yourself.

**The Assistant and Connectors settings reach the model.** `api/prompt.js` builds the exact
request pieces — system prompt, effort, tools, MCP servers — and `npm test` asserts on them
directly. No network, no API key, no dependencies:

```bash
npm test        # 58 tests
```

It checks that tone changes the prompt, that standing instructions are passed through
verbatim, that thinking depth becomes the `effort` parameter, that the web-search toggle
adds and removes a real tool, that a connector becomes an `mcp_servers` entry *and* the
matching toolset the API requires, that a paused connector is not sent at all, and that
failed turns are never replayed to the model.

Six of those are about the door being locked: with a Supabase project configured, a chat,
build, or title request without a valid session is refused with a 401 before the model is
ever reached. Delete the check and all six fail — which is the point of writing them.

Fifteen more drive the Perplexity provider against a stand-in HTTP server speaking Sonar's
wire format, because the streaming path is where things fail quietly. They cover the request
it builds, deltas and cumulative replies both arriving as one clean answer, `<think>` blocks
being stripped even when a tag splits across two chunks, sources surfacing once rather than
per frame, and the token counts the spend cap depends on coming back correct.

**The appearance settings reach the pixels.** For each control, `verify/appearance.mjs`
reads the computed style of a real element before and after — an actual paragraph, the
composer, a code block — and hashes a screenshot to confirm the rendering moved too:

```bash
npm run dev                      # in one terminal
npx playwright install chromium  # once
npm run verify:appearance        # in another
```

It prints a before/after table for all 21 controls. A decorative button would show an
unchanged computed style, an unchanged screenshot, or both.

Two things that suite taught me, in case you extend it: a newly-chosen typeface has to be
fetched before it paints, so the computed font-family changes a beat before the pixels do —
wait on `document.fonts.load()` or the check races. And the conversation lives in a scroll
container, so screenshotting that element captures only the visible slice; the fixture is
kept short enough to fit on screen, and the hash covers the whole viewport.

**The database keeps its promises.** If you've set up accounts, `npm run test:schema`
builds a throwaway database from the migration on a local Postgres — never your project —
and checks that the row-level policies isolate two real users, and that every column the
app's queries name actually exists. 32 assertions and a schema cross-check; details in
[supabase/README.md](supabase/README.md#check-it-worked).

## How it's put together

| Path | What it does |
| --- | --- |
| `api/chat.js` | Who's asking, what they may spend, and the event stream back to the browser. Hands the conversation itself to a provider. |
| `api/provider.js` | Picks the provider from whichever key is set. |
| `api/providers/` | `perplexity.js` and `anthropic.js` — everything that differs between the two lives here. |
| `api/prompt.js` | Turns settings into the system prompt, the model tier, tools, and MCP servers. Tested by `api/prompt.test.mjs`. |
| `api/_supabase.js` | Service-role client, session verification, connector lookup, the spend cap. |
| `api/connectors.js` | The only route a connector token passes through. |
| `api/capabilities.js` | What this deployment's model can do, so the interface stops offering the rest. |
| `api/transcribe.js` | Audio in, words out, for browsers that can't do it themselves. |
| `src/App.jsx` | Layout, chat state, auth, and the send/stream/retry cycle. |
| `src/lib/api.js` | Browser side of the stream. |
| `src/lib/store.js` | One data interface over two backings — this browser, or Postgres. Nothing above it knows which. |
| `src/lib/storage.js` | The browser backing: chats, settings, and connectors in `localStorage`. |
| `supabase/` | Schema, setup guide, and the tests that prove the policies work. |
| `src/lib/themes.js` | Palettes, applied as CSS variables. |
| `src/lib/artifacts.js` | Pulls code blocks out of replies. |
| `src/components/panels/` | Settings (Assistant / Appearance / Connectors tabs), Artifacts, Build, and the palette editor. |
| `src/lib/dictation.js` | Speech to text, through the browser. Tested by `dictation.test.mjs`. |
| `src/components/Logo.jsx` | The mark and the lockup. |
| `verify/appearance.mjs` | Measures every appearance control against real computed styles and pixels. |
| `scripts/doctor.mjs` | `npm run doctor` — checks the key, the schema, what the public key can read, and a deployment. |

## Things you'll probably want to change

All in `api/prompt.js`:

- **`BASE_PROMPT`** — Selflight's personality and rules. The highest-leverage text in
  the project; editing it changes the product more than any UI change will.
- **`TIERS`** — which Sonar model each thinking depth uses, and how much of the web it
  reads. This is the main cost dial, because Perplexity charges a per-request fee that
  scales with search depth.
- **`CONTEXT_WINDOW`** — how many past messages get resent each turn. Input is about 90%
  of the bill, so halving this roughly halves the cost of long conversations.

Thinking depth is exposed to the user in **Customize** rather than hard-coded; its default
is in `DEFAULT_SETTINGS` in `src/lib/storage.js`.

## What isn't here yet

- **Billing.** No Stripe and no plans — just a token cap per user per month.
- **File and image uploads.**
- **Artifact history across chats.** The canvas shows the current conversation only.
- **Password reset.** Supabase can send the email; the screen for it isn't built.
- **Sharing.** Every row belongs to exactly one person, by design. Shared chats would
  mean new policies, not just new UI.

## Cost

You pay per message, not per user. On Perplexity a balanced reply runs about **2.6¢**
and a quick one about **0.8¢** — token charges plus a per-request fee when the reply
actually searches. A real tester using it a few times a week comes to roughly **$3 a
month**; a six-week trial with 20 people lands near **$90** and can't exceed about
**$330** with the cap in place.

The full arithmetic, the per-depth table, and the query for who spent what are in
[supabase/README.md → Spending](supabase/README.md#spending). Every call is recorded in
`usage_events`, and the server stops answering past `SELFLIGHT_MONTHLY_TOKEN_CAP`.
