// The line a phrase was found in, centred on the phrase.
//
// A search result showing the first ninety characters of a long message usually
// doesn't contain the thing you searched for, which makes it useless as a
// result — you have to open the chat to find out whether it's the right one.
// This is small enough to look obviously correct and wasn't: the first version
// cut on a fixed offset and sliced words in half at both ends.

export function excerpt(text, needle, width = 90) {
  const body = String(text || "").replace(/\s+/g, " ").trim();
  if (body.length <= width) return body;

  const phrase = String(needle || "");
  const at = phrase ? body.toLowerCase().indexOf(phrase.toLowerCase()) : -1;

  // No match to centre on — a title matched, or the database's stemmer found
  // "running" from "run". The opening is the next best thing.
  if (at === -1) return `${trimEnd(body.slice(0, width))}…`;

  // A third before, two thirds after: what follows a phrase usually says more
  // about it than what precedes it.
  const from = Math.max(0, at - Math.floor(width / 3));
  const to = Math.min(body.length, from + width);
  const slice = body.slice(from, to);

  return `${from > 0 ? "…" : ""}${from > 0 ? trimStart(slice) : slice}${to < body.length ? "…" : ""}`;
}

// Drop a half-word at the cut, but only when there's a whole one left. Cutting
// "…nformation" to "…" loses the result entirely.
function trimStart(slice) {
  const space = slice.indexOf(" ");
  return space > 0 && space < 15 ? slice.slice(space + 1) : slice;
}

function trimEnd(slice) {
  const space = slice.lastIndexOf(" ");
  return space > slice.length - 15 ? slice.slice(0, space) : slice;
}
