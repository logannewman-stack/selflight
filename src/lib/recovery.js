// What a Supabase auth email leaves in the address bar when it lands.
//
// A password-reset link does something surprising: it signs the person in. By
// the time the app renders there is a valid session, so the obvious code path —
// "there's a user, show them the chat" — drops them straight into the app with
// the forgotten password still in place. They're locked out again next time and
// nothing looked broken, which is the worst shape a bug can take.
//
// So the landing has to be recognised. Two things make that awkward, and both
// are why this is a function rather than one regex at the call site:
//
//   1. The two auth flows put it in different places. The implicit flow returns
//      `#access_token=…&type=recovery`; PKCE returns `?code=…`. Errors follow
//      the same split.
//   2. The client tidies the address bar as soon as it has read it, so whatever
//      reads this has to run on the first render or find nothing.
//
// The event is still the primary signal — `onAuthStateChange` fires
// PASSWORD_RECOVERY, and under PKCE the URL carries no `type` at all. This is
// the belt to that pair of braces, and the only thing that catches an expired
// link, which fires no event because no session is ever established.

const paramsIn = (part) => new URLSearchParams(part.replace(/^[#?]/, ""));

/**
 * @param {string} href a full URL, normally window.location.href
 * @returns {{recovery: boolean, error: string|null}}
 */
export function readAuthRedirect(href = "") {
  const text = String(href);
  const hash = text.includes("#") ? text.slice(text.indexOf("#") + 1) : "";
  // Anything after `#` is the fragment, so a `?` inside it isn't a query.
  const beforeHash = text.includes("#") ? text.slice(0, text.indexOf("#")) : text;
  const query = beforeHash.includes("?") ? beforeHash.slice(beforeHash.indexOf("?") + 1) : "";

  const found = [paramsIn(hash), paramsIn(query)];
  const first = (key) => found.map((p) => p.get(key)).find(Boolean) || null;

  // `type` is also `magiclink`, `signup` and `invite` — none of which want the
  // set-a-password screen, and one of which is the ordinary way in.
  const recovery = first("type") === "recovery";

  // Supabase's own wording is already plain ("Email link is invalid or has
  // expired"), so it's passed through rather than replaced with a guess about
  // which of the several causes it was.
  // URLSearchParams has already turned `+` back into a space and undone the
  // percent-encoding, so what comes out is the sentence Supabase wrote.
  const error = first("error_description") || first("error_code") || first("error") || null;

  // An error and a recovery type arrive together on an expired reset link: the
  // link says what it was for, and then says it didn't work. The error wins —
  // there's no session, so there's nothing to set a password on.
  return { recovery: recovery && !error, error };
}
