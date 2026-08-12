// Turning a database failure into something a person can act on.
//
// This file exists because of a failure that actually happened: the app gained
// columns after the database was created, so every message read and write
// started failing — and the only sign was a console line nobody opens. Chats
// kept their titles in the sidebar and lost their contents, which reads as
// "the history doesn't work" and gives no clue what to do about it.
//
// Kept apart from store.js so it can be tested without a browser or a bundler.

export function explain(context, error = {}) {
  const detail = `${error.message || ""} ${error.details || ""} ${error.hint || ""}`;

  // The schema being behind the app. The one failure with an exact remedy, and
  // the one most likely to happen to anyone who set up before a release.
  if (error.code === "PGRST204" || /column .* does not exist|schema cache/i.test(detail)) {
    return {
      title: "Your database is missing a column this version needs",
      detail:
        "Open Supabase → SQL Editor and run supabase/migrations/0002_repair.sql. " +
        "It's safe to run twice, and it won't touch your existing chats.",
      // Nothing will save until it's fixed, so this shouldn't be scrollable away.
      fatal: true
    };
  }

  if (error.code === "42P01" || /relation .* does not exist/i.test(detail)) {
    return {
      title: "Your database hasn't been set up yet",
      detail: "Open Supabase → SQL Editor and run supabase/migrations/0001_init.sql.",
      fatal: true
    };
  }

  if (error.code === "42501" || /row-level security|permission denied/i.test(detail)) {
    return {
      title: "The database refused that",
      detail: "You may have been signed out. Try reloading, and sign in again.",
      fatal: false
    };
  }

  return {
    title: `Couldn't finish ${context}`,
    detail: error.message || "",
    fatal: false
  };
}
