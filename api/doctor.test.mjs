// The health check has to fail when the database is behind the app — that's the
// whole reason it exists. It once didn't: `messages` gained three columns, the
// check looked for one of them, and a database missing the other two reported
// itself healthy while every chat opened empty.
//
// So the invariant worth holding isn't "the check works", it's "the check knows
// about every column a repair migration can add". The migrations are the list;
// this reads them and holds the checker to it.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { RECENT_COLUMNS } from "./doctor.js";

const root = path.resolve(import.meta.dirname, "..");
const migrations = path.join(root, "supabase/migrations");

const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

// Every `alter table public.<t> add column if not exists <c>` in every
// migration after the first — which is exactly the set of columns a database
// created earlier can be missing.
function repairedColumns() {
  const found = [];
  for (const file of fs.readdirSync(migrations).sort()) {
    if (!file.endsWith(".sql") || file.startsWith("0001")) continue;
    const sql = fs.readFileSync(path.join(migrations, file), "utf8");
    const pattern =
      /alter\s+table\s+public\.(\w+)\s+add\s+column\s+if\s+not\s+exists\s+(\w+)/gi;
    for (const [, table, column] of sql.matchAll(pattern)) found.push({ table, column, file });
  }
  return found;
}

test("the repair migrations add columns", () => {
  // Guards the tests below: a regex that quietly matched nothing would make
  // every assertion here vacuously true.
  assert.ok(repairedColumns().length >= 7, "expected repairs to cover at least seven columns");
});

test("the health check knows every column a repair can add", () => {
  const known = new Set(RECENT_COLUMNS.map(([table, column]) => `${table}.${column}`));
  for (const { table, column } of repairedColumns()) {
    assert.ok(
      known.has(`${table}.${column}`),
      `${table}.${column} is repairable but unchecked — a database missing it would pass`
    );
  }
});

test("each checked column names the migration that actually adds it", () => {
  const repaired = repairedColumns();
  for (const [table, column, migration] of RECENT_COLUMNS) {
    const match = repaired.find((r) => r.table === table && r.column === column);
    assert.ok(match, `${table}.${column} is checked but no migration adds it`);
    assert.equal(
      match.file,
      migration,
      `${table}.${column} points at ${migration} but is added by ${match.file}`
    );
  }
});

test("a fresh install gets everything a repaired one does", () => {
  // 0001 is the canonical schema; the repairs exist only for databases created
  // before it grew. If a column is missing from 0001, every *new* project is
  // born broken and the repair migration is load-bearing forever.
  const init = read("supabase/migrations/0001_init.sql");
  for (const { table, column } of repairedColumns()) {
    // `\n);` at the start of a line ends the definition. Matching on "anything
    // but a semicolon" would be tighter, and wrong — a comment inside the
    // table body is allowed to contain one, and one of them does.
    const declared = new RegExp(
      `create table if not exists public\\.${table}\\s*\\(([\\s\\S]*?)\\n\\);`
    ).exec(init);
    assert.ok(declared, `0001 doesn't create public.${table}`);
    assert.match(
      declared[1],
      new RegExp(`^\\s*${column}\\b`, "m"),
      `public.${table}.${column} is repairable but missing from 0001 — new projects would lack it`
    );
  }
});

test("the app reads every column the repairs add", () => {
  // A column in a repair that nothing reads is dead weight. The reverse — a
  // column the app reads that no migration adds — is the original bug, and it's
  // what the schema contract test in supabase/tests catches.
  const source = read("src/lib/store.js") + read("api/_supabase.js") + read("api/oauth.js");
  for (const { table, column } of repairedColumns()) {
    assert.ok(
      source.includes(column),
      `nothing in the app reads or writes ${table}.${column} — is the repair stale?`
    );
  }
});

test("the browser check reports which columns are missing, not just that some are", () => {
  // The setup panel renders the names and the migration to run; before this the
  // endpoint never sent them, so that branch could never run and the advice was
  // "something's wrong".
  const source = read("api/doctor.js");
  assert.match(source, /report\.missingColumns\s*=/, "the report must name the missing columns");
  assert.match(source, /report\.repairWith\s*=/, "and which migration fixes them");
  assert.match(
    source,
    /if \(missingColumns\.length\) report\.state = "broken"/,
    "missing columns must make the report say broken — every read and write that touches them fails"
  );
});

test("both doctors check the same list", () => {
  // scripts/doctor.mjs imports RECENT_COLUMNS rather than keeping its own copy,
  // which is the only way the two can't drift.
  assert.match(read("scripts/doctor.mjs"), /import \{ RECENT_COLUMNS \} from "\.\.\/api\/doctor\.js"/);
});
