# Selflight

A minimal AI workspace — chat with web access and connectors on the left, a
canvas for what gets built on the right, and a code workspace when you want to
build a page from a sentence.

Vite + React on the front end, one serverless function on the back. The model is
called from the server so the API key never reaches the browser, which is what
makes this safe to put on a public URL.

## Run it locally

```bash
npm install
cp .env.example .env.local     # then paste your Anthropic API key into it
npm run dev
```

Open http://localhost:5173. `npm run dev` serves the front end *and* the `/api`
function, so there's nothing else to start.

Get a key at https://console.anthropic.com → API Keys. Without one the app loads
and says the key is missing instead of failing silently.

## Deploy

Push to GitHub and import the repo at vercel.com — it detects Vite and the `api/`
folder on its own. The only required setting:

**Project → Settings → Environment Variables → `ANTHROPIC_API_KEY`**

Redeploy after adding it.

## What's in it

**Chat** with streaming replies, markdown, auto-generated titles, and history that
survives a refresh.

**Web search and web fetch** are on by default. Selflight looks things up when the
answer depends on current information and tells you what it's doing while it works.

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
| Colour packages | Six built-in palettes, match-system light/dark pairing, nine accent colours, plus your own packages — see below |
| Typefaces | 25 faces, chosen separately for interface, replies, and code |
| Typography | Text size, weight, line spacing, letter spacing, paragraph spacing, heading size, reduced motion |
| Layout | Density, conversation width, corner rounding, bubble or plain user messages |
| Code | Code size, wrap long lines, line numbers |
| Behaviour | Send with Enter or ⌘+Enter, open artifacts automatically |

Everything applies instantly, persists, and has a reset that leaves your chats,
instructions, and saved packages alone.

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

Tokens you enter are stored in your browser's `localStorage` and sent to your own
serverless function, which forwards them to the API.

## Proving the settings actually do something

Reasonable question for a panel with this many switches. Two suites answer it, and you can
run both yourself.

**The Assistant and Connectors settings reach the model.** `api/prompt.js` builds the exact
request pieces — system prompt, effort, tools, MCP servers — and `npm test` asserts on them
directly. No network, no API key, no dependencies:

```bash
npm test        # 17 tests
```

It checks that tone changes the prompt, that standing instructions are passed through
verbatim, that thinking depth becomes the `effort` parameter, that the web-search toggle
adds and removes a real tool, that a connector becomes an `mcp_servers` entry *and* the
matching toolset the API requires, that a paused connector is not sent at all, and that
failed turns are never replayed to the model.

**The appearance settings reach the pixels.** For each control, `verify/appearance.mjs`
reads the computed style of a real element before and after — an actual paragraph, the
composer, a code block — and hashes a screenshot to confirm the rendering moved too:

```bash
npm run dev                      # in one terminal
npx playwright install chromium  # once
npm run verify:appearance        # in another
```

It prints a before/after table for all 18 controls. A decorative button would show an
unchanged computed style, an unchanged screenshot, or both.

Two things that suite taught me, in case you extend it: a newly-chosen typeface has to be
fetched before it paints, so the computed font-family changes a beat before the pixels do —
wait on `document.fonts.load()` or the check races. And the conversation lives in a scroll
container, so screenshotting that element captures only the visible slice; the fixture is
kept short enough to fit on screen, and the hash covers the whole viewport.

## How it's put together

| Path | What it does |
| --- | --- |
| `api/chat.js` | Calls the model, streams replies and tool activity back as server-sent events. Also builds pages and generates titles. |
| `api/prompt.js` | Turns settings into the system prompt, effort, tools, and MCP servers. Tested by `api/prompt.test.mjs`. |
| `src/App.jsx` | Layout, chat state, and the send/stream/retry cycle. |
| `src/lib/api.js` | Browser side of the stream. |
| `src/lib/storage.js` | Chats, settings, and connectors in `localStorage`. |
| `src/lib/themes.js` | Palettes, applied as CSS variables. |
| `src/lib/artifacts.js` | Pulls code blocks out of replies. |
| `src/components/panels/` | Settings (Assistant / Appearance / Connectors tabs), Artifacts, Build, and the palette editor. |
| `verify/appearance.mjs` | Measures every appearance control against real computed styles and pixels. |

## Things you'll probably want to change

`api/prompt.js`:

- **`BASE_PROMPT`** — Selflight's personality and rules. The highest-leverage text in
  the project; editing it changes the product more than any UI change will.
And in `api/chat.js`:

- **`MODEL`** — `claude-opus-5` is the most capable. `claude-sonnet-5` costs roughly
  half per token; `claude-haiku-4-5` a fraction of that.
- **`CONTEXT_WINDOW`** — how many past messages get resent each turn. Cost scales with
  this, because the whole conversation is re-read on every reply.

Thinking depth is exposed to the user in **Customize** rather than hard-coded.

## What isn't here yet

- **Accounts.** Everything lives in one browser's `localStorage`. Auth plus a database
  is what turns this into something people log into on two devices.
- **Billing.** No Stripe, no plans, no usage limits.
- **File and image uploads.**
- **Artifact history across chats.** The canvas shows the current conversation only.

## Cost

You pay per message, not per user. A conversational reply runs a few cents on
`claude-opus-5` and well under one cent on `claude-haiku-4-5`. Web searches and long
threads cost more, because every turn resends the history — `CONTEXT_WINDOW` and the
thinking-depth setting are the dials that bound it.
