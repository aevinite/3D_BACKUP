#!/usr/bin/env node
/* verify:one-phone-number — ONE ANSWER TO "WHICH GUEST IS THIS NUMBER?", IN ALL THREE PLACES.
 *
 * WHY (T11, sweep #8, 2026-09-07). Three files answered this question and none of them agreed:
 *
 *   lfh_phone10()                    (SQL, mig 227)  knew 4 shapes
 *   norm() in billcustomer.js        (browser)       knew the same 4, "mirroring" the SQL by hand
 *   the printed bill in billdoc.js   (paper)         knew 2 — it peeled 91 and 0, printed the rest raw
 *
 * So one guest could be matched by the database, missed by the sheet, and printed unparsed on the
 * paper handed back to them. billcustomer.js's own comment said a constant here and a constant
 * there drifting is "silent and expensive" — and then drifted.
 *
 * There is now ONE definition in JS (phone10 in billdoc.js) and one in SQL, and this guard holds
 * them together. It asserts:
 *   1. phone10() gives the right answer for every shape, and never guesses at one it cannot read;
 *   2. norm() DELEGATES rather than keeping a second copy;
 *   3. the SQL carries the identical CASE ladder;
 *   4. the box's typing cap is the longest shape phone10 can identify — the exact constant that
 *      silently ate a digit when the fifth shape was added.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const BILLDOC = createRequire(import.meta.url)(join(ROOT, "public/panels/billdoc.js"));

let fails = 0;
const ok = (m) => console.log(`  ok   ${m}`);
const bad = (m, d) => { fails++; console.log(`  FAIL ${m}`); if (d) console.log(`         ${d}`); };

// ── 1. every shape, and the ones it must NOT guess at ────────────────────────────────────────
const SHAPES = [
  ["9876543210", "9876543210", "the national number"],
  ["919876543210", "9876543210", "the country code, no prefix"],
  ["+91 98765 43210", "9876543210", "the country code, written out"],
  ["09876543210", "9876543210", "the trunk prefix"],
  ["0919876543210", "9876543210", "both"],
  ["00919876543210", "9876543210", "the international form (mig 379)"],
  ["0091 98765 43210", "9876543210", "…written out"],
];
const shapeBad = SHAPES.filter(([raw, want]) => BILLDOC.phone10(raw) !== want)
  .map(([raw, want, why]) => `${why}: "${raw}" → "${BILLDOC.phone10(raw)}", not "${want}"`);
shapeBad.length ? bad(`phone10 does not read ${shapeBad.length} of the ${SHAPES.length} shapes`, shapeBad.join(" · "))
  : ok(`phone10 reads all ${SHAPES.length} shapes a guest number arrives in`);

// A number it cannot identify must come back as the DIGITS, never as a wrong ten.
const NOTANUMBER = ["", "12345", "999999999999999", "abc", "+91", "98765432109876"];
const guessed = NOTANUMBER.filter((x) => { const r = BILLDOC.phone10(x); return r.length === 10 && String(x).replace(/\D/g, "") !== r; });
guessed.length ? bad("phone10 guesses at a number it cannot identify", guessed.map((x) => `"${x}" → "${BILLDOC.phone10(x)}"`).join(" · "))
  : ok("…and never guesses at one it cannot identify");

// ── 2. the browser DELEGATES; it does not keep a second copy ─────────────────────────────────
const CUST = read("public/panels/billcustomer.js");
const normBody = /function norm\(s\)\s*\{([\s\S]*?)\n  \}/.exec(CUST)?.[1] ?? "";
if (!/LFH_BILLDOC[\s\S]{0,80}phone10/.test(normBody)) bad("norm() in billcustomer.js no longer delegates to phone10", "a second copy of the rule is back, and it will drift");
else if (/length === 12|length === 13|length === 14|slice\(0, 2\)/.test(normBody)) bad("norm() delegates AND keeps its own ladder", "two answers, one question");
else ok("norm() delegates to the one definition instead of mirroring it");
// …and nothing else re-implements it either.
const copies = ["public/panels/billdoc.js", "public/panels/editor/app.js", "public/panels/tablet/app.js", "public/panels/kitchen/app.js", "lib/billCustomer.ts"]
  .filter((f) => { try { return /length === 13 && [\s\S]{0,40}"091"|left\(x, 3\) = '091'/.test(read(f)) && f !== "public/panels/billdoc.js"; } catch { return false; } });
copies.length ? bad(`${copies.join(", ")} carries its own copy of the ladder`) : ok("no panel or route re-implements the ladder");

// ── 3. the SQL says exactly the same thing ───────────────────────────────────────────────────
const SQL = ["227_bill_customer.sql", "379_a_guest_number_written_the_international_way.sql"]
  .map((f) => { try { return read("supabase/migrations/" + f); } catch { return ""; } }).join("\n");
const latest = SQL.lastIndexOf("CREATE OR REPLACE FUNCTION lfh_phone10");
const body = latest < 0 ? "" : SQL.slice(latest, SQL.indexOf("$$;", latest));
const LADDER = [[10, null], [12, "91"], [11, "0"], [13, "091"], [14, "0091"]];
const missing = LADDER.filter(([n, pre]) => !new RegExp(`length\\(x\\) = ${n}` + (pre ? `[\\s\\S]{0,60}'${pre}'` : "")).test(body));
missing.length ? bad(`the SQL knows ${LADDER.length - missing.length} of the ${LADDER.length} shapes phone10 does`,
  `the browser would find a guest the database then misses: ${missing.map(([n]) => n + " digits").join(", ")}`)
  : ok(`lfh_phone10 carries the same ${LADDER.length} shapes as phone10`);

// ── 4. the typing cap is the longest shape, not a number somebody remembered ─────────────────
const cap = Number(/const MAX_TYPED = (\d+)/.exec(CUST)?.[1]);
const longest = Math.max(...LADDER.map(([n]) => n));
if (!Number.isFinite(cap)) bad("billcustomer.js has no named MAX_TYPED", "the cap is a magic number in the input handler again — that is what ate a digit");
else if (cap !== longest) bad(`the box holds ${cap} digits but phone10 reads up to ${longest}`, `a ${longest}-digit number loses its last digit as it is typed, and the guest is never found`);
else ok(`the box holds ${cap} digits — the longest shape phone10 can identify`);
/* STRIP THE COMMENTS FIRST. The obituary above MAX_TYPED quotes the very thing this check
   forbids — "it was written straight into the input handler as `.slice(0, 13)`" — and the first
   version of this check read that sentence and called it a live fault. A guard must judge the
   CODE, never the note explaining why the code is what it is. Line comments come off before block
   comments, or a "/*" sitting inside a "//" line hides the rest of the file. */
const codeOnly = (t) => t.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
if (/slice\(0, 1[0-9]\)/.test(codeOnly(CUST))) bad("a hard-coded digit cap is back in billcustomer.js", "use MAX_TYPED");
else ok("…and no hard-coded cap has crept back in");

console.log(fails ? `\n❌ verify:one-phone-number — ${fails} problem(s)` : "\n✅ verify:one-phone-number — one answer to 'which guest is this number?', in the browser, on the paper and in the database");
process.exit(fails ? 1 : 0);
