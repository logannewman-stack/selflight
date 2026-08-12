// Pulls substantial code blocks out of replies so they can be previewed,
// edited, and downloaded instead of just scrolled past.

const FENCE = /```([\w+-]*)\n([\s\S]*?)```/g;

// Short snippets belong inline in the message, not in the canvas.
const MIN_LINES = 4;

const EXTENSIONS = {
  html: "html",
  svg: "svg",
  javascript: "js",
  js: "js",
  jsx: "jsx",
  typescript: "ts",
  ts: "ts",
  tsx: "tsx",
  python: "py",
  py: "py",
  css: "css",
  json: "json",
  markdown: "md",
  md: "md",
  sql: "sql",
  sh: "sh",
  bash: "sh"
};

export function isRenderable(language) {
  return language === "html" || language === "svg";
}

export function extensionFor(language) {
  return EXTENSIONS[language] || "txt";
}

function titleFor(code, language, index) {
  const title = code.match(/<title>([^<]+)<\/title>/i)?.[1];
  if (title) return title.trim();

  const heading = code.match(/^\s*(?:\/\/|#|<!--)\s*(.{3,60}?)\s*(?:-->)?$/m)?.[1];
  if (heading) return heading.trim();

  const label = language ? language.toUpperCase() : "Snippet";
  return `${label} ${index + 1}`;
}

// Wraps bare SVG so it can be previewed on the theme's own background.
export function toDocument(artifact) {
  if (artifact.language === "svg") {
    return `<!doctype html><meta charset="utf-8"><style>html,body{height:100%;margin:0;display:grid;place-items:center;background:#fff}svg{max-width:100%;max-height:100%}</style>${artifact.code}`;
  }
  return artifact.code;
}

export function extractArtifacts(messages) {
  const found = [];

  messages.forEach((message, messageIndex) => {
    if (message.role !== "selflight" || !message.text) return;

    FENCE.lastIndex = 0;
    let match;
    while ((match = FENCE.exec(message.text)) !== null) {
      const language = (match[1] || "").toLowerCase();
      const code = match[2].replace(/\s+$/, "");
      if (code.split("\n").length < MIN_LINES) continue;

      found.push({
        id: `${messageIndex}-${found.length}`,
        language,
        code,
        title: titleFor(code, language, found.length),
        renderable: isRenderable(language)
      });
    }
  });

  return found;
}

// Build mode asks for a whole page; take the fenced block if there is one,
// otherwise assume the reply is already raw markup.
export function extractDocument(text) {
  const blocks = [...String(text || "").matchAll(FENCE)];
  if (blocks.length) {
    const html = blocks.find((b) => (b[1] || "").toLowerCase().startsWith("html"));
    return (html || blocks[0])[2].trim();
  }
  const trimmed = String(text || "").trim();
  return trimmed.startsWith("<") ? trimmed : "";
}
