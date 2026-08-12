# Selflight

A minimal AI chat app — sidebar of recent conversations, streaming replies, keyboard-first.

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

## How it's put together

| Path | What it does |
| --- | --- |
| `api/chat.js` | Calls the model and streams the reply back as server-sent events. Also generates chat titles. |
| `src/App.jsx` | Layout, chat state, and the send/stream/retry cycle. |
| `src/lib/api.js` | Browser side of the stream — parses SSE, hands text to the UI. |
| `src/lib/storage.js` | Saves chats to `localStorage`. |
| `src/components/` | Sidebar, message rendering, composer. |

## Things you'll probably want to change

All in `api/chat.js`, near the top:

- **`SYSTEM_PROMPT`** — Selflight's personality and rules. This is the highest-leverage
  file in the project; editing it changes the product more than any UI change will.
- **`MODEL`** — `claude-opus-5` is the most capable. Switch to `claude-sonnet-5` for
  roughly half the cost per token, or `claude-haiku-4-5` for a fraction of it.
- **`EFFORT`** — how much the model thinks before answering. `medium` keeps chat
  snappy; `high` gives better answers on hard questions and costs more.
- **`CONTEXT_WINDOW`** — how many past messages get resent each turn. Cost scales with
  this, because the whole conversation is re-read on every reply.

## What isn't here yet

Deliberately left out to keep the first version small:

- **Accounts.** Chats live in one browser's `localStorage`. Adding auth plus a database
  is what turns this into a product people can log into on two devices.
- **Billing.** No Stripe, no plans, no usage limits.
- **Dark mode.**
- **File and image uploads.**

## Cost

You pay per message, not per user. A conversational reply runs a few cents on
`claude-opus-5` and well under one cent on `claude-haiku-4-5`. Longer threads cost
more than short ones, because every turn resends the history — `CONTEXT_WINDOW` is
the dial that bounds it.
