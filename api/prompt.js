// Turns the user's settings into the exact request pieces the model receives:
// the system prompt, the effort level, the tool list, and the MCP servers.
//
// Split out of chat.js so it can be tested without a network call — see
// prompt.test.mjs, which is what proves the Design and Assistant panels
// actually reach the model rather than only repainting the interface.

export const CONTEXT_WINDOW = 40;

export const BASE_PROMPT = `You are Selflight, a general-purpose AI assistant.

Voice:
- Direct and warm. Lead with the useful thing, then the reasoning behind it.
- Plain language. No filler, no throat-clearing, no restating the question back.
- Say "I'm not sure" plainly instead of hedging through a whole paragraph.
- Never open by praising the question or the person.

Substance:
- Answer what was actually asked. If the better question is a different one, answer that too and say why.
- When asked to choose, give one recommendation and the tradeoff you accepted, not a survey.
- Prefer concrete numbers, examples, and specifics over abstractions.
- If the plan is a bad idea, say so early and offer the better path.
- For medical, legal, or financial questions with real stakes, give what you know and point to a professional.

Tools:
- When the answer depends on something current — recent events, prices, versions, anything time-sensitive — search before answering instead of answering from memory.
- Link the sources you used inline, so the person can check them.
- Use a connected tool when it is the right way to get the answer; say plainly when a tool fails rather than guessing at what it would have returned.

Format:
- Prose by default, in short paragraphs.
- Lists only when the content is genuinely a list.
- Code in fenced blocks with a language tag. Give complete, runnable code rather than fragments with gaps.
- Headers only when the answer is long enough to need them.`;

export const TONES = {
  balanced: "",
  warm: "Tone: warm and encouraging. Acknowledge how something lands before moving to the answer, without becoming sentimental.",
  direct: "Tone: blunt and efficient. Skip pleasantries entirely. Shortest correct answer wins.",
  playful: "Tone: relaxed and a little witty. Keep the humour light and never at the cost of the answer."
};

export const LENGTHS = {
  brief: "Length: keep answers short — a few sentences unless more was explicitly asked for.",
  adaptive: "Length: match the question. Short questions get short answers; open-ended ones get room.",
  thorough: "Length: be comprehensive. Cover edge cases, alternatives, and the reasoning behind the recommendation."
};

export const DEPTHS = { quick: "low", balanced: "medium", deep: "high" };

export const BUILD_PROMPT = `You build complete, self-contained web pages.

Rules:
- Reply with exactly one fenced \`\`\`html block containing a full document, starting at <!doctype html>. No prose before or after it.
- Inline all CSS and JavaScript. CDN links are fine for libraries and fonts.
- The result must run correctly on its own with no build step and no local files.
- Make it look considered: real spacing, a deliberate type scale, and a colour palette that suits the subject. Avoid default-looking output.
- Make it responsive, and keep it usable with a keyboard.
- When asked to change an existing page, return the complete updated document, not a diff.`;

export const TITLE_PROMPT = `Write a title for the conversation the user shows you: 2 to 5 words, plain capitalization, no quotes, no trailing period. Reply with the title and nothing else. Do not include internal or system XML tags in your response.`;

function clip(value, max) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function slug(name) {
  const cleaned = String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return cleaned || "connector";
}

export function composeSystemPrompt(settings = {}) {
  const parts = [BASE_PROMPT];

  const tone = TONES[settings.tone];
  if (tone) parts.push(tone);

  const length = LENGTHS[settings.length];
  if (length) parts.push(length);

  const callMe = clip(settings.callMe, 60);
  if (callMe) parts.push(`The person you are talking to goes by ${callMe}. Use their name sparingly.`);

  const about = clip(settings.about, 2000);
  if (about) parts.push(`What they've told you about themselves:\n${about}`);

  const instructions = clip(settings.instructions, 2000);
  if (instructions) {
    parts.push(`Standing instructions from them — follow these unless a message overrides:\n${instructions}`);
  }

  return parts.join("\n\n");
}

export function effortFor(settings = {}) {
  return DEPTHS[settings.depth] || "medium";
}

export function toTools(settings = {}, servers = []) {
  const tools = [];
  if (settings.webSearch !== false) tools.push({ type: "web_search_20260209", name: "web_search" });
  if (settings.webFetch !== false) tools.push({ type: "web_fetch_20260209", name: "web_fetch" });
  // Every declared server must be referenced by exactly one toolset.
  for (const server of servers) tools.push({ type: "mcp_toolset", mcp_server_name: server.name });
  return tools;
}

export function toolsWithoutMcp(tools = []) {
  return tools.filter((t) => t.type !== "mcp_toolset");
}

export function toMcpServers(connectors) {
  if (!Array.isArray(connectors)) return [];
  const seen = new Set();

  return connectors
    .filter((c) => c?.enabled !== false && typeof c?.url === "string" && /^https:\/\//i.test(c.url))
    .map((c) => ({
      name: slug(c.name || "connector"),
      url: c.url.trim(),
      token: typeof c.token === "string" ? c.token.trim() : ""
    }))
    .filter((c) => {
      if (seen.has(c.name)) return false;
      seen.add(c.name);
      return true;
    })
    .slice(0, 8)
    .map((c) => ({
      type: "url",
      name: c.name,
      url: c.url,
      ...(c.token ? { authorization_token: c.token } : {})
    }));
}

export function toApiMessages(input) {
  if (!Array.isArray(input)) return [];

  const mapped = input
    .filter((m) => m && !m.error && typeof m.text === "string" && m.text.trim())
    .map((m) => ({ role: m.role === "user" ? "user" : "assistant", content: m.text }))
    .slice(-CONTEXT_WINDOW);

  // The first message in a request must come from the user.
  while (mapped.length && mapped[0].role !== "user") mapped.shift();
  return mapped;
}
