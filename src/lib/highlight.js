// highlight.js core plus a curated language set. Registering only what an AI
// assistant actually emits keeps this a fraction of the full bundle.

import hljs from "highlight.js/lib/core";

import bash from "highlight.js/lib/languages/bash";
import css from "highlight.js/lib/languages/css";
import go from "highlight.js/lib/languages/go";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";

const LANGUAGES = {
  bash,
  css,
  go,
  java,
  javascript,
  json,
  markdown,
  python,
  rust,
  sql,
  typescript,
  xml,
  yaml
};

for (const [name, definition] of Object.entries(LANGUAGES)) {
  hljs.registerLanguage(name, definition);
}

hljs.registerAliases(["js", "jsx", "mjs", "cjs"], { languageName: "javascript" });
hljs.registerAliases(["ts", "tsx"], { languageName: "typescript" });
hljs.registerAliases(["html", "svg", "vue"], { languageName: "xml" });
hljs.registerAliases(["sh", "shell", "zsh"], { languageName: "bash" });
hljs.registerAliases(["py"], { languageName: "python" });
hljs.registerAliases(["yml"], { languageName: "yaml" });
hljs.registerAliases(["md"], { languageName: "markdown" });

// Past this size the highlight cost starts showing up as jank mid-stream, and
// nobody is reading a 40k-character block closely anyway.
const MAX_CHARS = 40000;

const LABELS = {
  javascript: "JavaScript",
  typescript: "TypeScript",
  xml: "HTML",
  css: "CSS",
  json: "JSON",
  python: "Python",
  bash: "Shell",
  sql: "SQL",
  markdown: "Markdown",
  yaml: "YAML",
  go: "Go",
  rust: "Rust",
  java: "Java"
};

export function labelFor(language) {
  if (!language) return "";
  const resolved = hljs.getLanguage(language);
  const name = resolved?.name?.toLowerCase();
  return LABELS[name] || LABELS[language] || language.toUpperCase();
}

export function highlight(code, language) {
  if (!code || code.length > MAX_CHARS) return null;

  try {
    if (language && hljs.getLanguage(language)) {
      return hljs.highlight(code, { language, ignoreIllegals: true }).value;
    }
    // No usable language tag — guessing beats rendering it flat.
    return hljs.highlightAuto(code, Object.keys(LANGUAGES)).value;
  } catch {
    return null;
  }
}
