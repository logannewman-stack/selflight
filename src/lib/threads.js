// Making a chat open instantly.
//
// Tapping a chat used to do this: clear the thread, then wait for a database
// round trip. Between those two you get the empty state — logo, "What are you
// working on?", suggestion chips — which is not a loading state, it's a
// different screen. On a phone on mobile data that's most of a second of the
// app appearing to have lost your conversation.
//
// Three things fix it, in order of how much they help:
//
// 1. Remember. A chat you've already opened reopens with no wait at all, and
//    the fetch behind it only corrects the display if something changed
//    elsewhere. Stale-while-revalidate: show what you have, check quietly.
// 2. Guess. The sidebar warms a chat the moment a pointer touches the row —
//    which on a mouse is ~200ms before the click lands, and on a touchscreen is
//    the whole duration of the tap. Usually the fetch has finished before the
//    finger lifts.
// 3. Say so. When there genuinely is nothing yet, show the shape of a
//    conversation rather than the shape of an empty app.
//
// The cache lives in memory, not localStorage. Chats can be edited on another
// device, and a stale thread that survives a refresh is a bug report; one that
// survives a tap is a fast app.

const MAX_THREADS = 40;

/**
 * Creates a thread cache bound to one store. Making a new one per store means
 * signing out can't leave another account's conversations in memory — the whole
 * cache goes with the store it belongs to.
 */
export function createThreadCache(store) {
  const threads = new Map();
  // Fetches already in flight, so hovering a row twice doesn't ask twice, and
  // a tap that lands mid-prefetch joins the request already running.
  const pending = new Map();

  function remember(id, messages) {
    // Re-inserting moves a chat to the end of the Map's iteration order, which
    // is what makes the eviction below least-recently-used rather than random.
    threads.delete(id);
    threads.set(id, messages);

    while (threads.size > MAX_THREADS) {
      threads.delete(threads.keys().next().value);
    }
  }

  function fetch(id) {
    if (pending.has(id)) return pending.get(id);

    const request = store.chats
      .messages(id)
      .then((messages) => {
        remember(id, messages);
        return messages;
      })
      .finally(() => pending.delete(id));

    pending.set(id, request);
    return request;
  }

  // Reading a thread is what makes it recently used. Without this, eviction
  // ranks by when a chat was last *fetched* rather than last opened — so the
  // conversation you keep coming back to, which is always served from cache and
  // therefore never re-fetched, becomes the first one dropped.
  function touch(id) {
    if (!threads.has(id)) return null;
    const messages = threads.get(id);
    threads.delete(id);
    threads.set(id, messages);
    return messages;
  }

  return {
    /** What we already have, or null. Synchronous — that's the whole point. */
    peek(id) {
      return touch(id) ?? null;
    },

    /**
     * Starts loading a chat without waiting for it. Called on pointer-enter and
     * touch-start; the result is thrown away, because the point is the cache
     * entry it leaves behind.
     */
    warm(id) {
      if (!id || threads.has(id) || pending.has(id)) return;
      fetch(id).catch(() => {
        // A prefetch that fails is not an error anyone should see — the real
        // open will try again and report it properly if it fails too.
      });
    },

    /** The thread, from memory if we have it and from the store if we don't. */
    async load(id) {
      return touch(id) ?? (await fetch(id));
    },

    /**
     * Keeps the cache honest after a write. The browser holds the authoritative
     * thread while a turn is in flight, so this is the version that's *more*
     * current than the database's, not less.
     */
    update(id, messages) {
      if (id) remember(id, messages);
    },

    forget(id) {
      threads.delete(id);
      pending.delete(id);
    },

    /** Exposed for the tests; nothing in the app should need it. */
    size() {
      return threads.size;
    }
  };
}
