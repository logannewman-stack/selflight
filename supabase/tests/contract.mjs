// Do the queries in the app match the tables in the migration?
//
// Every Supabase call names its columns as plain strings — in a select list, in
// an .eq(), in the object handed to .insert(). A typo in any of them fails at
// runtime, in a browser, as a console message nobody reads. This walks the
// source, pulls out every table and column the code actually asks for, and
// checks them against a real database built from 0001_init.sql.
//
// Run it through supabase/tests/run.sh, which supplies the schema dump.

import fs from "node:fs";
import path from "node:path";

const [dumpPath, ...roots] = process.argv.slice(2);
if (!dumpPath) {
  console.error("usage: node contract.mjs <schema-dump> <file-or-dir>...");
  process.exit(2);
}

/* ------------------------- what the database has ------------------------- */

// One "table.column" per line, from information_schema.
const columns = new Map();
for (const line of fs.readFileSync(dumpPath, "utf8").split("\n")) {
  const [table, column] = line.trim().split(".");
  if (!table || !column) continue;
  if (!columns.has(table)) columns.set(table, new Set());
  columns.get(table).add(column);
}

/* --------------------------- what the code asks -------------------------- */

function sources(target) {
  const stat = fs.statSync(target);
  if (!stat.isDirectory()) return [target];
  return fs
    .readdirSync(target)
    .filter((f) => /\.(js|jsx|mjs)$/.test(f))
    .map((f) => path.join(target, f));
}

// Grab the text from `.from("table")` up to the end of that chain, so columns
// are attributed to the right table even with several calls in one file.
function statements(code) {
  const found = [];
  const re = /\.from\(\s*["']([a-z_]+)["']\s*\)/g;
  let match;

  while ((match = re.exec(code))) {
    const start = match.index + match[0].length;
    // A chain ends at the next .from( or at a blank line followed by a
    // non-chained statement; the next .from( is the reliable half.
    re.lastIndex = start;
    const nextFrom = code.slice(start).search(/\.from\(\s*["']/);
    const end = nextFrom === -1 ? code.length : start + nextFrom;
    found.push({ table: match[1], body: code.slice(start, end) });
  }
  return found;
}

// PostgREST's own options, which share the call with the row being written —
// `.upsert(rows, { onConflict: "chat_id,position" })` — and are not columns.
const OPTIONS = new Set([
  "onConflict",
  "ignoreDuplicates",
  "defaultToNull",
  "count",
  "head",
  "returning"
]);

// The columns inside the object literal that follows insert/update/upsert.
function objectKeys(body, method) {
  const at = body.indexOf(`.${method}(`);
  if (at === -1) return [];

  const open = body.indexOf("{", at);
  if (open === -1) return [];

  let depth = 0;
  let close = open;
  for (; close < body.length; close++) {
    if (body[close] === "{") depth++;
    else if (body[close] === "}" && --depth === 0) break;
  }

  const literal = body.slice(open + 1, close);
  // Top-level keys only — a nested object is a jsonb value, not a column.
  const keys = [];
  let nesting = 0;
  for (const part of literal.split("\n")) {
    if (nesting === 0) {
      const key = /^\s*([a-z_][a-z0-9_]*)\s*:/i.exec(part);
      if (key && !OPTIONS.has(key[1])) keys.push(key[1]);
    }
    nesting += (part.match(/[{[]/g) || []).length - (part.match(/[}\]]/g) || []).length;
  }
  return keys;
}

const asked = [];

for (const root of roots.length ? roots : ["src/lib", "api"]) {
  for (const file of sources(root)) {
    const code = fs.readFileSync(file, "utf8");

    for (const { table, body } of statements(code)) {
      const add = (column) => asked.push({ file, table, column });

      // .select("a, b, c") — the count/head forms have no columns to check.
      for (const [, list] of body.matchAll(/\.select\(\s*["']([^"']+)["']\s*\)/g)) {
        for (const column of list.split(",")) {
          const name = column.trim();
          if (name && name !== "*") add(name);
        }
      }

      // Filters and ordering.
      for (const [, column] of body.matchAll(
        /\.(?:eq|neq|gt|gte|lt|lte|like|ilike|is|in|order)\(\s*["']([a-z_]+)["']/g
      )) {
        add(column);
      }

      // The upsert conflict target has to be real, or Postgres rejects it.
      for (const [, list] of body.matchAll(/onConflict:\s*["']([^"']+)["']/g)) {
        for (const column of list.split(",")) add(column.trim());
      }

      for (const method of ["insert", "update", "upsert"]) {
        for (const column of objectKeys(body, method)) add(column);
      }
    }
  }
}

/* -------------------------------- verdict -------------------------------- */

const problems = [];
const seen = new Set();

for (const { file, table, column } of asked) {
  const key = `${file}|${table}.${column}`;
  if (seen.has(key)) continue;
  seen.add(key);

  if (!columns.has(table)) {
    problems.push(`${file}: no table public.${table}`);
  } else if (!columns.get(table).has(column)) {
    problems.push(`${file}: public.${table} has no column "${column}"`);
  }
}

const tables = [...new Set(asked.map((a) => a.table))].sort();
console.log(
  `Checked ${seen.size} column references across ${tables.length} tables: ${tables.join(", ")}`
);

if (problems.length) {
  console.log(`\nMISMATCHES:\n- ${problems.join("\n- ")}`);
  process.exit(1);
}
console.log("Every column the app asks for exists in the schema.");
