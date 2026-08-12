// verify-merge-keeps-mark.mjs — joining two tables must not throw away a table's mark.
//
// THE GAP THIS EXISTS FOR (T3 floor sweep, 2026-08-10). A table can be marked 👑 VIP / 🏠 Family /
// 🤝 Owner's guest (mig 166). Merging closes the higher-numbered table's party, and
// `clear_table_tag_on_close` deletes a mark when its party ends — correct for a table that has
// finished, wrong for one that has just joined another bill. So the mark vanished silently, and the
// on-the-house handler's careful "the mark may sit on ANY member of a merged party" lookup could
// never find anything: a Family table that merged lost the free-of-charge settle it exists for.
//
// Migration 312 rescues the row across the close. This checks the whole chain statically, because
// each half can be right while the mark still disappears:
//   1. the migration reads the child's tag BEFORE the close and re-inserts it AFTER,
//   2. the shape is right (ON CONFLICT DO NOTHING, so it can never fail the merge),
//   3. clear_table_tag_on_close is still in place (the fix must not have been "solved" by removing
//      the trigger — a table that genuinely finishes must still lose its mark),
//   4. the panel asks the PARTY for the comp mark, not one table (partyTag), so the button the
//      server would accept is actually offered,
//   5. the on-the-house route still searches the whole party.
//
// Read-only and offline — it reads files, never the database. `npm run verify:merge-keeps-mark`
import { readFileSync, existsSync, readdirSync } from "node:fs";

const ROOT = process.cwd();
let pass = true;
const ok = (m, d = "") => console.log(`  ok   ${m}${d ? " — " + d : ""}`);
const bad = (m, d = "") => { pass = false; console.log(`  FAIL ${m}${d ? " — " + d : ""}`); };
const check = (m, cond, why = "") => (cond ? ok(m) : bad(m, why));
const read = (rel) => (existsSync(`${ROOT}/${rel}`) ? readFileSync(`${ROOT}/${rel}`, "utf8") : "");

console.log("\nA MERGE MUST KEEP THE TABLE'S MARK\n");

// ── 1 · the migration ───────────────────────────────────────────────────────────────────────
const migDir = `${ROOT}/supabase/migrations`;
const migFile = readdirSync(migDir).find((f) => /^312_/.test(f));
check("migration 312 exists", !!migFile, "the fix has no migration");
const mig = migFile ? readFileSync(`${migDir}/${migFile}`, "utf8") : "";

// The rescue only works in this ORDER: SELECT the tag, THEN close, THEN put it back.
const iSelect = mig.indexOf("SELECT * INTO v_kid_tag");
const iClose = mig.indexOf("SET status = 'closed'");
const iInsert = mig.indexOf("INSERT INTO table_tags");
check("it reads the child's mark before closing the party", iSelect > -1 && iClose > -1 && iSelect < iClose,
  "read it AFTER the close and the trigger has already deleted it");
check("it puts the mark back after the close", iInsert > -1 && iInsert > iClose,
  "an insert before the close is deleted by the trigger a moment later");
check("the re-insert can never fail the merge", /INSERT INTO table_tags[\s\S]{0,400}ON CONFLICT[\s\S]{0,80}DO NOTHING/.test(mig),
  "without ON CONFLICT DO NOTHING a stray row would abort a merge that has already moved the money");
check("it still records WHO merged (mig 308 is not undone)", /p_actor/.test(mig) && /merged_by/.test(mig));
check("the function keeps its REVOKE/GRANT", /REVOKE ALL ON FUNCTION lfh_staff_merge_tables/.test(mig)
  && /GRANT EXECUTE ON FUNCTION lfh_staff_merge_tables[\s\S]{0,80}service_role/.test(mig),
  "a new Postgres function is PUBLIC-executable by default (the mig 038/267 lesson)");
check("the lowest table still holds the bill", /THE MAIN TABLE IS ALWAYS THE LOWEST NUMBER/.test(mig));

// ── 2 · the trigger is still doing its real job ─────────────────────────────────────────────
const mig166 = read("supabase/migrations/166_table_tags_khata.sql");
check("clear_table_tag_on_close still exists", /CREATE TRIGGER clear_table_tag_on_close/.test(mig166),
  "the mark must still be cleared when a party genuinely FINISHES — the fix is scoped to merges");

// ── 3 · the panel asks the PARTY, not one table ─────────────────────────────────────────────
const app = read("public/panels/editor/app.js");
check("the manager panel has partyTag()", /function partyTag\(/.test(app));
check("the payment sheet offers On the house from the PARTY's mark", /onHouse: \[.*\]\.includes\(partyTag\(t\)\)/.test(app),
  "asking tagForTable(t) hides a button the server would accept when the mark sits on a partner table");

// ── 4 · the server still searches the whole party ───────────────────────────────────────────
const route = read("app/api/editor/[...path]/route.ts");
const onHouse = route.slice(route.indexOf('c === "on-the-house"'), route.indexOf('c === "on-the-house"') + 2500);
check("the on-the-house route looks at the parent AND its children", /table_merges[\s\S]{0,300}child_table/.test(onHouse)
  && /\.in\("table_number"/.test(onHouse),
  "narrow this back to one table and a merged family loses their comp again");

console.log(pass
  ? "\n✅ PASS — a merge keeps the mark, and a finished table still loses it"
  : "\n❌ FAIL — joining two tables can throw away a VIP / Family / Owner's-guest mark");
process.exit(pass ? 0 : 1);
