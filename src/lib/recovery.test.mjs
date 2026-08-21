// The URLs a Supabase auth email actually lands on.
//
// These aren't invented shapes. Each is what the two flows produce, and the
// reason this file exists is that getting any of them wrong fails silently:
// miss the recovery landing and the app cheerfully shows the chat to somebody
// who came to change their password, and they discover they're still locked out
// a week later. Nothing throws, nothing logs, and it looks like it worked.

import test from "node:test";
import assert from "node:assert/strict";
import { readAuthRedirect } from "./recovery.js";

const SITE = "https://polstar.ai/";

test("the implicit flow's recovery landing is recognised", () => {
  const url = `${SITE}#access_token=eyJhbGci.abc&expires_in=3600&refresh_token=xyz&token_type=bearer&type=recovery`;
  assert.deepEqual(readAuthRedirect(url), { recovery: true, error: null });
});

test("an ordinary visit is not a recovery landing", () => {
  for (const url of [SITE, `${SITE}?utm_source=x`, `${SITE}#anchor`, ""]) {
    assert.equal(readAuthRedirect(url).recovery, false, url);
  }
});

test("the other email types are not recovery", () => {
  // The one that matters: a magic-link sign-in is the ordinary way in, and
  // sending it to the set-a-password screen would break signing in for
  // everybody who uses it.
  for (const type of ["magiclink", "signup", "invite", "email_change"]) {
    const url = `${SITE}#access_token=a&type=${type}`;
    assert.equal(readAuthRedirect(url).recovery, false, type);
  }
});

test("an expired link is an error, not a recovery", () => {
  // Both are present on a stale link — it says what it was for and then says it
  // didn't work. Treating it as a recovery would show a set-a-password form
  // with no session behind it, which fails on submit with "Auth session
  // missing!" and no explanation of the actual cause.
  const url =
    `${SITE}#error=access_denied&error_code=otp_expired` +
    "&error_description=Email+link+is+invalid+or+has+expired";

  assert.deepEqual(readAuthRedirect(url), {
    recovery: false,
    error: "Email link is invalid or has expired"
  });
});

test("the description is decoded rather than shown raw", () => {
  const { error } = readAuthRedirect(`${SITE}#error_description=Email%20link%20has%20expired`);
  assert.equal(error, "Email link has expired");
});

test("an error falls back to the code when there's no description", () => {
  assert.equal(readAuthRedirect(`${SITE}#error_code=otp_expired`).error, "otp_expired");
  assert.equal(readAuthRedirect(`${SITE}#error=access_denied`).error, "access_denied");
});

test("PKCE puts it in the query instead of the fragment", () => {
  // No `type` at all in this flow, which is why the PASSWORD_RECOVERY event
  // stays the primary signal and this is only the fallback.
  const { recovery, error } = readAuthRedirect(`${SITE}?code=b5f1c0de-1111-2222-3333-444455556666`);
  assert.equal(recovery, false);
  assert.equal(error, null);

  // Errors, though, do come back on the query here — and this is the case a
  // fragment-only reader would miss entirely.
  assert.equal(
    readAuthRedirect(`${SITE}?error=access_denied&error_description=Email+link+is+invalid`).error,
    "Email link is invalid"
  );
});

test("a question mark inside the fragment isn't mistaken for a query", () => {
  // `#...?next=/x` is a real shape once anything appends a return path, and
  // splitting on the first `?` would read the fragment as a query and lose the
  // recovery type sitting in front of it.
  const { recovery } = readAuthRedirect(`${SITE}#access_token=a&type=recovery&next=?back=/chat`);
  assert.equal(recovery, true);
});

test("the fragment wins when both carry the same key", () => {
  // Only reachable if something appended to the URL, but the fragment is where
  // the client itself wrote the answer, so it's the one to believe.
  const { error } = readAuthRedirect(`${SITE}?error_code=bad_query#error_code=otp_expired`);
  assert.equal(error, "otp_expired");
});

test("nothing thrown for junk", () => {
  for (const url of [undefined, null, "#", "?", "###", "not a url at all"]) {
    assert.doesNotThrow(() => readAuthRedirect(url), String(url));
  }
});
