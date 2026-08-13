// Attaching a file to a message.
//
// The pipeline from the composer to the model carries strings — every provider
// is handed `{ role, content }` with content a plain string. So an attachment
// here means text: the file is read in the browser, its contents go into the
// message, and the interface shows a chip instead of the wall of text so the
// conversation stays readable.
//
// That rules out images and PDFs until the providers can take image parts, and
// this file says so out loud rather than accepting the file and quietly sending
// nothing — which looks identical to working right up until the answer is about
// a file the model never saw.

// Roughly four characters to a token, so 40,000 characters is about 10,000
// tokens — two or three times a normal message, which is a lot but not absurd.
// Past that the reply costs more than the question was worth and the useful
// half of a long file is usually near the top anyway.
export const PER_FILE = 40_000;
export const TOTAL = 120_000;
export const MAX_FILES = 8;

// Extensions rather than MIME types: browsers report `text/plain` for some code
// files, `application/octet-stream` for others, and nothing at all for a few.
// The extension is what the person actually chose.
const TEXT_EXTENSIONS = [
  "txt", "md", "markdown", "rst", "log", "csv", "tsv",
  "json", "jsonl", "yaml", "yml", "toml", "ini", "env", "conf", "cfg", "properties",
  "html", "htm", "xml", "svg", "css", "scss", "sass", "less",
  "js", "jsx", "mjs", "cjs", "ts", "tsx", "vue", "svelte",
  "py", "rb", "go", "rs", "java", "kt", "kts", "swift", "c", "h", "cpp", "cc", "hpp",
  "cs", "php", "pl", "lua", "r", "scala", "clj", "ex", "exs", "erl", "hs", "dart",
  "sh", "bash", "zsh", "fish", "ps1", "bat",
  "sql", "graphql", "gql", "proto", "tf", "hcl",
  "gitignore", "dockerfile", "makefile", "lock", "diff", "patch"
];

// Things people will genuinely try, each with the reason it doesn't work yet.
// A specific refusal is worth writing out: "unsupported file type" tells you to
// give up, "I can't read PDFs yet" tells you to paste the text.
const KNOWN_UNREADABLE = {
  pdf: "PDFs aren't readable yet — copy the text out and paste it in.",
  doc: "Word documents aren't readable yet — copy the text out and paste it in.",
  docx: "Word documents aren't readable yet — copy the text out and paste it in.",
  xls: "Spreadsheets aren't readable yet — export it as CSV and attach that.",
  xlsx: "Spreadsheets aren't readable yet — export it as CSV and attach that.",
  ppt: "Slide decks aren't readable yet — copy the text out and paste it in.",
  pptx: "Slide decks aren't readable yet — copy the text out and paste it in.",
  zip: "Archives aren't readable — attach the files inside it instead.",
  tar: "Archives aren't readable — attach the files inside it instead.",
  gz: "Archives aren't readable — attach the files inside it instead.",
  png: "Images can't be read yet — the model this connects to only takes text.",
  jpg: "Images can't be read yet — the model this connects to only takes text.",
  jpeg: "Images can't be read yet — the model this connects to only takes text.",
  gif: "Images can't be read yet — the model this connects to only takes text.",
  webp: "Images can't be read yet — the model this connects to only takes text.",
  heic: "Images can't be read yet — the model this connects to only takes text.",
  mp3: "Audio files can't be read. Use the microphone to dictate instead.",
  wav: "Audio files can't be read. Use the microphone to dictate instead.",
  m4a: "Audio files can't be read. Use the microphone to dictate instead.",
  mp4: "Video files can't be read.",
  mov: "Video files can't be read."
};

export function extensionOf(name) {
  const clean = String(name || "").toLowerCase().trim();
  // `Dockerfile` and `Makefile` have no dot; the whole name is the type.
  if (!clean.includes(".")) return clean;
  return clean.split(".").pop();
}

export function readable(name) {
  const ext = extensionOf(name);
  return TEXT_EXTENSIONS.includes(ext);
}

/**
 * Why a file can't be attached, or null if it can.
 *
 * Separate from reading it, because this answers instantly and a person
 * dragging six files over the composer should see which ones will work before
 * anything is read.
 */
export function refuse(file) {
  const ext = extensionOf(file.name);

  if (KNOWN_UNREADABLE[ext]) return KNOWN_UNREADABLE[ext];
  if (!readable(file.name)) {
    return `I don't know how to read a .${ext} file. Text and code files work.`;
  }
  // 4MB of text is 1M tokens and would be refused by the model anyway; catching
  // it here means an instant answer instead of a slow one.
  if (file.size > 4_000_000) {
    return `${file.name} is ${Math.round(file.size / 1_000_000)}MB — too big to send. Attach the part that matters.`;
  }
  return null;
}

// Decoded bytes that aren't text. A .csv exported by something that wrote UTF-16
// arrives full of NULs and would otherwise be sent to the model as garbage.
function looksBinary(text) {
  // A NUL byte anywhere is decisive — no text file contains one.
  if (text.includes("\u0000")) return true;

  const sample = text.slice(0, 2000);
  if (!sample) return false;

  // Control characters other than tab, newline and carriage return, plus the
  // replacement character a decoder emits for bytes that weren't valid UTF-8.
  const odd = (sample.match(/[\u0000-\u0008\u000E-\u001F\uFFFD]/g) || []).length;
  return odd / sample.length > 0.05;
}

/**
 * Reads one file into an attachment, or explains why it couldn't.
 *
 * Truncation is reported rather than done quietly: a person who attaches a
 * 200,000-character log and gets an answer about the first fifth of it needs to
 * know that's what happened.
 */
export async function readOne(file) {
  const reason = refuse(file);
  if (reason) return { name: file.name, error: reason };

  let raw;
  try {
    raw = await file.text();
  } catch {
    return { name: file.name, error: `${file.name} couldn't be read off the disk.` };
  }

  if (looksBinary(raw)) {
    return { name: file.name, error: `${file.name} doesn't look like text once opened.` };
  }

  const truncated = raw.length > PER_FILE;
  return {
    name: file.name,
    size: file.size,
    chars: Math.min(raw.length, PER_FILE),
    truncated,
    text: truncated ? raw.slice(0, PER_FILE) : raw
  };
}

/**
 * Reads a batch, applying the caps across the whole set.
 *
 * Returns both what worked and what didn't, because a drop of five files where
 * two are PDFs should attach three and say why the other two are missing.
 */
export async function readAll(fileList, existing = []) {
  const files = [...fileList];
  const attached = [...existing];
  const errors = [];

  let total = existing.reduce((n, a) => n + (a.text?.length || 0), 0);

  for (const file of files) {
    if (attached.length >= MAX_FILES) {
      errors.push(`Only ${MAX_FILES} files at a time — ${file.name} wasn't attached.`);
      continue;
    }
    if (attached.some((a) => a.name === file.name)) {
      errors.push(`${file.name} is already attached.`);
      continue;
    }

    const result = await readOne(file);
    if (result.error) {
      errors.push(result.error);
      continue;
    }
    if (total + result.text.length > TOTAL) {
      errors.push(`${file.name} would make the message too long to send.`);
      continue;
    }

    total += result.text.length;
    attached.push(result);
  }

  return { attached, errors };
}

/* ------------------------- attachments in a message ----------------------- */

// A message with files in it is one string, because that's what every provider
// takes and what the messages table stores. The fence is deliberately explicit:
// the model is told what it's looking at, and the interface can find the same
// boundaries again to show chips instead of ten thousand characters of CSV.
const OPEN = "─── attached file:";
const CLOSE = "─── end of file:";

export function withAttachments(text, attachments = []) {
  if (!attachments.length) return text;

  const blocks = attachments.map((file) => {
    const note = file.truncated ? ` (first ${file.chars.toLocaleString()} characters)` : "";
    return `${OPEN} ${file.name}${note}\n${file.text}\n${CLOSE} ${file.name}`;
  });

  // The question last. A model reading a long file followed by "summarise this"
  // has the instruction fresh; the other order buries it.
  return [...blocks, String(text || "").trim()].filter(Boolean).join("\n\n");
}

/**
 * The inverse: what the person typed, and what was attached to it.
 *
 * Used for display, so a conversation shows "report.csv" and the sentence you
 * wrote rather than the file inlined into the bubble. Anything that doesn't
 * parse comes back as body text — a message that happens to contain the fence
 * shows as written rather than disappearing.
 */
export function splitAttachments(text) {
  const source = String(text || "");
  if (!source.includes(OPEN)) return { body: source, files: [] };

  const files = [];
  let body = "";
  let rest = source;

  while (rest.includes(OPEN)) {
    const start = rest.indexOf(OPEN);
    body += rest.slice(0, start);

    const headerEnd = rest.indexOf("\n", start);
    if (headerEnd === -1) break;

    const header = rest.slice(start + OPEN.length, headerEnd).trim();
    const name = header.replace(/\s*\(first [\d,]+ characters\)$/, "");
    const end = rest.indexOf(`${CLOSE} ${name}`, headerEnd);
    if (end === -1) break;

    files.push({
      name,
      truncated: header !== name,
      text: rest.slice(headerEnd + 1, end).replace(/\n$/, "")
    });
    rest = rest.slice(end + `${CLOSE} ${name}`.length);
  }

  return { body: (body + rest).trim(), files };
}

/**
 * The message with the fence lines taken out but the file contents left in.
 *
 * For search results, where the phrase somebody searched for may well be inside
 * an attached file. Dropping the file entirely would leave a hit whose snippet
 * doesn't contain the match; leaving the fence in wastes the width on "─── end
 * of file: server.log".
 */
export function plain(text) {
  const { body, files } = splitAttachments(text);
  return [...files.map((f) => f.text), body].filter(Boolean).join("\n").trim();
}

// "12 KB", "1.4 MB" — chip-sized, and never "0 KB" for a file that has content.
export function size(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1000) return `${n} B`;
  if (n < 1_000_000) return `${Math.max(1, Math.round(n / 1000))} KB`;
  return `${(n / 1_000_000).toFixed(1)} MB`;
}
