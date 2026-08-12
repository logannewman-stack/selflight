// Proves the Assistant and Connectors settings actually change what gets sent
// to the model, rather than only repainting the interface.
//
//   node --test api/
//
// No dependencies and no network — it asserts on the exact request pieces
// api/chat.js hands to the SDK.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  BASE_PROMPT,
  composeSystemPrompt,
  effortFor,
  toApiMessages,
  toMcpServers,
  toTools
} from "./prompt.js";

test("tone reaches the system prompt", () => {
  const balanced = composeSystemPrompt({ tone: "balanced" });
  const direct = composeSystemPrompt({ tone: "direct" });
  const warm = composeSystemPrompt({ tone: "warm" });

  assert.notEqual(direct, balanced, "picking a tone must change the prompt");
  assert.match(direct, /blunt and efficient/);
  assert.match(warm, /warm and encouraging/);
  assert.doesNotMatch(balanced, /blunt and efficient/);
});

test("answer length reaches the system prompt", () => {
  assert.match(composeSystemPrompt({ length: "brief" }), /keep answers short/);
  assert.match(composeSystemPrompt({ length: "thorough" }), /be comprehensive/);
});

test("what you're called reaches the system prompt", () => {
  const prompt = composeSystemPrompt({ callMe: "Logan" });
  assert.match(prompt, /goes by Logan/);
});

test("standing instructions reach the system prompt verbatim", () => {
  const instructions = "Never end with a summary. Give me code first.";
  const prompt = composeSystemPrompt({ instructions });
  assert.ok(prompt.includes(instructions), "instructions must be passed through as written");
  assert.match(prompt, /Standing instructions/);
});

test("what you tell it about yourself reaches the system prompt", () => {
  const about = "I run a car detailing business and I'm learning to code.";
  assert.ok(composeSystemPrompt({ about }).includes(about));
});

test("long fields are clipped rather than sent unbounded", () => {
  const prompt = composeSystemPrompt({ instructions: "x".repeat(5000) });
  assert.ok(prompt.length < BASE_PROMPT.length + 2400, "instructions should cap around 2000 chars");
});

test("an empty Assistant tab leaves the base prompt untouched", () => {
  assert.equal(composeSystemPrompt({}), BASE_PROMPT);
  assert.equal(composeSystemPrompt({ tone: "balanced", length: undefined }), BASE_PROMPT);
});

test("thinking depth reaches the effort parameter", () => {
  assert.equal(effortFor({ depth: "quick" }), "low");
  assert.equal(effortFor({ depth: "balanced" }), "medium");
  assert.equal(effortFor({ depth: "deep" }), "high");
  assert.equal(effortFor({}), "medium", "an unset depth must still be valid");
});

test("web search and web fetch toggles add and remove real tools", () => {
  const both = toTools({ webSearch: true, webFetch: true });
  assert.deepEqual(
    both.map((t) => t.name),
    ["web_search", "web_fetch"]
  );

  assert.deepEqual(toTools({ webSearch: false, webFetch: true }).map((t) => t.name), ["web_fetch"]);
  assert.deepEqual(toTools({ webSearch: true, webFetch: false }).map((t) => t.name), ["web_search"]);
  assert.deepEqual(toTools({ webSearch: false, webFetch: false }), []);
});

test("a connector becomes an MCP server and a matching toolset", () => {
  const servers = toMcpServers([
    { name: "Linear", url: "https://mcp.linear.app/sse", token: "tok_123", enabled: true }
  ]);

  assert.equal(servers.length, 1);
  assert.deepEqual(servers[0], {
    type: "url",
    name: "linear",
    url: "https://mcp.linear.app/sse",
    authorization_token: "tok_123"
  });

  // The API rejects a server that no toolset references, so this pairing is
  // load-bearing rather than cosmetic.
  const tools = toTools({ webSearch: false, webFetch: false }, servers);
  assert.deepEqual(tools, [{ type: "mcp_toolset", mcp_server_name: "linear" }]);
});

test("a paused connector is not sent at all", () => {
  const servers = toMcpServers([
    { name: "linear", url: "https://mcp.linear.app/sse", enabled: false },
    { name: "notion", url: "https://mcp.notion.com/mcp", enabled: true }
  ]);
  assert.deepEqual(servers.map((s) => s.name), ["notion"]);
});

test("unreachable connector URLs are dropped before they reach the API", () => {
  assert.deepEqual(toMcpServers([{ name: "local", url: "http://localhost:9000/sse", enabled: true }]), []);
  assert.deepEqual(toMcpServers([{ name: "insecure", url: "http://example.com/sse", enabled: true }]), []);
});

test("duplicate connector names collapse so the toolset stays valid", () => {
  const servers = toMcpServers([
    { name: "My Server", url: "https://a.example.com/sse", enabled: true },
    { name: "my-server", url: "https://b.example.com/sse", enabled: true }
  ]);
  assert.equal(servers.length, 1, "two connectors cannot share one name");
});

test("a connector with no token omits the field rather than sending an empty one", () => {
  const [server] = toMcpServers([{ name: "open", url: "https://open.example.com/sse", enabled: true }]);
  assert.ok(!("authorization_token" in server));
});

test("history is trimmed and always starts with the user", () => {
  const long = Array.from({ length: 60 }, (_, i) => ({
    role: i % 2 === 0 ? "user" : "selflight",
    text: `turn ${i}`
  }));
  const sent = toApiMessages(long);

  assert.ok(sent.length <= 40, "context window must bound what is resent");
  assert.equal(sent[0].role, "user");
  assert.deepEqual([...new Set(sent.map((m) => m.role))].sort(), ["assistant", "user"]);
});

test("failed turns are not replayed to the model", () => {
  const sent = toApiMessages([
    { role: "user", text: "hello" },
    { role: "selflight", text: "Rate limited. Try again.", error: true }
  ]);
  assert.deepEqual(sent, [{ role: "user", content: "hello" }]);
});

test("every Assistant setting composes together", () => {
  const prompt = composeSystemPrompt({
    tone: "playful",
    length: "brief",
    callMe: "Logan",
    about: "Runs a detailing business.",
    instructions: "Skip the recap."
  });

  for (const fragment of [
    "relaxed and a little witty",
    "keep answers short",
    "goes by Logan",
    "Runs a detailing business.",
    "Skip the recap."
  ]) {
    assert.ok(prompt.includes(fragment), `missing: ${fragment}`);
  }
});
