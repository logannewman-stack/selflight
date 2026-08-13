// The parser's job is to be right about a narrow thing. These tests are split
// accordingly: what it must understand, and — the longer list — what it must
// leave alone. A command that fires on a real message costs someone their
// question, which is far worse than a phrasing it doesn't know.

import test from "node:test";
import assert from "node:assert/strict";
import { BUILT_IN_THEMES } from "./themes.js";
import { parseCommand, clean } from "./commands.js";
import { findColor } from "./colors.js";

const ctx = {
  themes: BUILT_IN_THEMES,
  settings: { textSize: "md", lineSpacing: "normal", bodyWeight: "regular", darkTheme: "midnight", lightTheme: "paper" }
};

const run = (text) => parseCommand(text, ctx);

/* ------------------------------ what it does ----------------------------- */

test("the sentence this was built for", () => {
  // Spoken, verbatim, filler and all.
  const cmd = run("hey I want this LLM to be a tan color background");
  assert.ok(cmd, "should be read as a command");
  assert.equal(cmd.patch.baseColor, "#d2b48c");
  assert.match(cmd.say, /tan/i);
});

test("the short way of saying it", () => {
  assert.equal(run("make the background sage").patch.baseColor, "#9caa8b");
  assert.equal(run("make it navy").patch.baseColor, "#000080");
  assert.equal(run("set the app colour to terracotta").patch.baseColor, "#c96f4a");
});

test("multi-word colours beat their last word", () => {
  assert.equal(findColor("dark slate blue").hex, "#483d8b");
  assert.equal(run("make the background dark green").patch.baseColor, "#006400");
});

test("a hex code, since some people know exactly what they want", () => {
  assert.equal(run("set the background to #1e2430").patch.baseColor, "#1e2430");
  assert.equal(run("make the background #abc").patch.baseColor, "#aabbcc");
});

test("the accent is its own colour", () => {
  assert.equal(run("make the accent blue").patch.accent, "blue");
  assert.equal(run("accent should be terracotta").patch.accentCustom, "#c96f4a");
  // And it must not be mistaken for the background.
  assert.equal(run("make the accent blue").patch.baseColor, undefined);
});

test("light and dark", () => {
  assert.equal(run("dark mode").patch.theme, "midnight");
  assert.equal(run("switch to light").patch.theme, "paper");
  assert.equal(run("match my system").patch.matchSystem, true);
});

test("themes by name, including one the person wrote", () => {
  const mine = { id: "u1", name: "Ocean Deep", dark: true, vars: {}, custom: true };
  const cmd = parseCommand("switch to Ocean Deep", { ...ctx, themes: [...BUILT_IN_THEMES, mine] });
  assert.equal(cmd.patch.theme, "u1");
});

test("type size moves one notch at a time", () => {
  assert.equal(run("bigger text").patch.textSize, "lg");
  assert.equal(run("make the text smaller").patch.textSize, "sm");
  // And clamps rather than running off the end.
  assert.equal(parseCommand("bigger text", { ...ctx, settings: { textSize: "xl" } }).patch.textSize, "xl");
});

test("fonts by name", () => {
  assert.equal(run("use Lora").patch.replyFont, "lora");
  assert.equal(run("use Atkinson Hyperlegible").patch.uiFont, "atkinson");
  // A mono face changes code, not the interface.
  assert.equal(run("use JetBrains Mono").patch.codeFont, "jetbrains");
  assert.equal(run("use JetBrains Mono").patch.uiFont, undefined);
});

test("layout", () => {
  assert.equal(run("make it compact").patch.density, "compact");
  assert.equal(run("use the full width").patch.width, "full");
  assert.equal(run("square corners").patch.corners, "square");
  assert.equal(run("turn off bubbles").patch.bubbles, "plain");
});

test("how it answers", () => {
  assert.equal(run("be more direct").patch.tone, "direct");
  assert.equal(run("keep answers short").patch.length, "brief");
  assert.equal(run("think harder").patch.depth, "deep");
  assert.equal(run("turn off web search").patch.webSearch, false);
  assert.equal(run("call me Logan").patch.callMe, "Logan");
});

test("opening panels", () => {
  assert.deepEqual(run("open settings").open, { section: "settings", tab: "assistant" });
  assert.deepEqual(run("I want to edit the appearance").open, { section: "settings", tab: "appearance" });
  assert.deepEqual(run("show me the connectors").open, { section: "settings", tab: "connectors" });
  assert.deepEqual(run("open status").open, { section: "settings", tab: "status" });
});

test("acting on the app itself", () => {
  assert.equal(run("start a new chat").act, "newChat");
  assert.equal(run("sign me out").act, "signOut");
  assert.equal(run("close settings").act, "close");
});

/* ------------------------- what it must not touch ------------------------ */

test("questions are answered, never acted on", () => {
  const questions = [
    "what's a good background colour for a reading app?",
    "how do I make a tan background in CSS?",
    "why is dark mode easier on the eyes",
    "can you explain how accent colours work",
    "is tan a warm colour?",
    "what does thinking depth mean",
    "which font is best for dyslexia"
  ];
  for (const q of questions) assert.equal(run(q), null, `should have stayed a question: ${q}`);
});

test("talking about a colour is not asking for one", () => {
  const messages = [
    "write me a poem about a tan horse",
    "the walls of my kitchen are sage green and I hate them",
    "I want to know about dark mode in other apps",
    "summarise this article about the colour blue",
    "my dog is called Navy"
  ];
  for (const m of messages) assert.equal(run(m), null, `should have been sent as a message: ${m}`);
});

test("ordinary requests to the assistant, which share every keyword", () => {
  // Found by running real-sounding messages through the parser rather than by
  // imagining them. Each of these fired once.
  const work = [
    "change the tone of this email to be more direct", // tone, direct — about a document
    "rewrite my bio to be more playful",
    "i need to lose weight, give me a plan", // weight
    "the paper I read said dark mode saves battery", // paper, dark mode
    "make a plan for my week",
    "turn this list into a table",
    "use simpler words in this paragraph",
    "my start up is called Slate and I need a tagline", // slate
    "go deeper on the second point", // deeper
    "start a new project plan for Q4", // new
    "reset my expectations about this",
    "give me a tan line skincare routine", // tan
    "summarise the article about slate roofing"
  ];
  for (const m of work) assert.equal(run(m), null, `should have been sent as a message: ${m}`);
});

test("a long message is a message, whatever words are in it", () => {
  const long =
    "I'm building a reading app and I want to make the background tan but I'm not sure " +
    "whether that works with the serif font I picked, what do you think";
  assert.equal(run(long), null);
});

test("code and design talk stays out of it", () => {
  assert.equal(run("what's the hex code for tan"), null);
  assert.equal(run("how do I set a tan background in tailwind"), null);
});

test("an empty or absurd input is not a command", () => {
  assert.equal(run(""), null);
  assert.equal(run("   "), null);
  assert.equal(run("x".repeat(400)), null);
});

/* -------------------------------- cleaning ------------------------------- */

test("politeness and filler come off", () => {
  assert.equal(clean("Hey, could you please open settings?"), "open settings");
  assert.equal(clean("um, uh, make it darker"), "make it darker");
  assert.equal(clean("I want this app to be tan"), "tan");
});

test("spoken padding doesn't stop a command landing", () => {
  // Dictation gives no punctuation and leaves the throat-clearing in.
  assert.ok(run("um okay so can you please make the background cream thanks"));
  assert.ok(run("hey selflight open the appearance settings"));
});
