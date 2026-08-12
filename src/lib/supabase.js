// The browser's Supabase client, or null.
//
// Null is a supported state, not a broken one: with no Supabase project
// configured Selflight runs entirely in this browser, exactly as it did before
// there were accounts. That keeps `npm run dev` a one-step affair and lets the
// appearance suite run without any backend at all.

import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const hasSupabase = Boolean(url && anonKey);

export const supabase = hasSupabase
  ? createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        // The magic-link and confirmation emails come back with the session in
        // the URL fragment; pick it up and then tidy the address bar.
        detectSessionInUrl: true
      }
    })
  : null;

// The anon key is designed to ship to browsers — every table it can reach is
// guarded by row-level security keyed to the signed-in user. The service-role
// key is the one that must never leave the server, and it is only read in
// api/, never here.
export async function accessToken() {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

export function friendlyAuthError(error) {
  const message = error?.message || "";
  if (/invalid login credentials/i.test(message)) return "That email and password don't match an account.";
  if (/email not confirmed/i.test(message)) return "Check your inbox and confirm your email first.";
  if (/user already registered/i.test(message)) return "There's already an account with that email. Sign in instead.";
  if (/password should be at least/i.test(message)) return "Use at least six characters for the password.";
  if (/rate limit|too many/i.test(message)) return "Too many attempts. Give it a minute.";
  if (/redirect/i.test(message)) return "This site's URL isn't allowed in your Supabase auth settings yet.";
  return message || "Something went wrong signing in.";
}
