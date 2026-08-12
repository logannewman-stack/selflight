// The health check has to fail when the database is behind the app — that's the
// whole reason it exists. It once didn't: `messages` gained three columns, the
// checks looked for one of them, and a database missing the other two reported
// itself healthy while every chat opened empty.
//
// So the invariant worth holding isn't "the check works", it's "the check covers
// everything the repair migration can add". 0002_repair.sql is the list of
// columns a database can be missing; both doctors must look for all of them, and
// the app must actually read them — otherwise the repair is fixing nothing.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

// `alter table public.messages add column if not exists <name> ...`
function repairedColumns() {
  const sql = read("supabase/migrations/0002_repair.sql");
  const pattern =
    /alter\s+table\s+public\.messages\s+add\s+column\s+if\s+not\s+exists\s+(\w+)/gi;
  return [...sql.matchAll(pattern)].map((m) => m[1]);
}

// The array in `for (const column of [...])`, which is how both doctors ask.
function checkedColumns(file) {
  const found = /for \(const column of \[([^\]]+)\]\)/.exec(read(file));
  assert.ok(found, `${file} has no column loop — has the schema check been rewritten?`);
  return [...found[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

test("the repair migration adds columns", () => {
  // Guards the test itself: a regex that quietly matches nothing would make
  // every assertion below vacuously true.
  assert.ok(repairedColumns().length >= 3, "expected the repair to add at least three columns");
});

for (const file of ["api/doctor.js", "scripts/doctor.mjs"]) {
  test(`${file} checks every column the repair can add`, () => {
    const checked = checkedColumns(file);
    for (const column of repairedColumns()) {
      assert.ok(
        checked.includes(column),
        `${file} never checks messages.${column}, so a database missing it would pass`
      );
    }
  });
}

test("the app reads every column the repair adds", () => {
  // A column in the repair that nothing reads is dead weight; a column the app
  // reads that the repair doesn't add is the original bug, and the loop above
  // wouldn't catch it because the repair is the source of truth.
  const select = /\.from\("messages"\)\s*\.select\("([^"]+)"\)/.exec(read("src/lib/store.js"));
  assert.ok(select, "store.js no longer selects from messages by name");

  const columns = select[1].split(",").map((s) => s.trim());
  for (const column of repairedColumns()) {
    assert.ok(columns.includes(column), `nothing reads messages.${column} — is the repair stale?`);
  }
});

test("the browser check reports which columns are missing, not just that some are", () => {
  // The panel renders the names; before this the endpoint never sent them, so
  // that branch could never run and the advice was "something's wrong".
  const source = read("api/doctor.js");
  assert.match(source, /report\.missingColumns\s*=/, "the report must name the missing columns");
  assert.match(
    source,
    /if \(missingColumns\.length\) report\.state = "broken"/,
    "missing columns must make the report say broken — every message read and write fails"
  );
});
