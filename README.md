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

**Connectors** attach remote MCP servers so Selflight can use their tools mid-chat.

**Customize** sets tone, answer length, thinking depth, what to call you, and standing
instructions — all folded into the system prompt on the server.

**Design** switches palettes (including two dark ones, a low-stimulation option, and a
high-contrast option), text size, and reduced motion.

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

## How it's put together

| Path | What it does |
| --- | --- |
| `api/chat.js` | Calls the model, assembles tools and connectors, streams replies and tool activity back as server-sent events. Also builds pages and generates titles. |
| `src/App.jsx` | Layout, chat state, and the send/stream/retry cycle. |
| `src/lib/api.js` | Browser side of the stream. |
| `src/lib/storage.js` | Chats, settings, and connectors in `localStorage`. |
| `src/lib/themes.js` | Palettes, applied as CSS variables. |
| `src/lib/artifacts.js` | Pulls code blocks out of replies. |
| `src/components/panels/` | Artifacts, Build, Connectors, Customize, Design. |

## Things you'll probably want to change

Near the top of `api/chat.js`:

- **`BASE_PROMPT`** — Selflight's personality and rules. The highest-leverage text in
  the project; editing it changes the product more than any UI change will.
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
