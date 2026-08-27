// verify-rota-clash.mjs — two managers editing the WAITER ROTA: first save wins, and the loser is
// told in words.
//
// THE BUG THIS EXISTS FOR (T3 sweep, 2026-08-07). `saveWaiterTables` replaces ONE waiter's WHOLE
// table list and carried no `expect`, so two managers editing Settings → Access during a shift
// change both saw "Saved ✓" and the second one's list silently replaced the first's. The rota then
// routes tables to a waiter nobody meant to give them, and `table-sections` appeared in neither of
// verify:clash's lists, so nothing recorded the decision either.
//
// The gate itself (lib/clash.ts → expectClash) already existed and needed no server change — the
// whole fix is one expectation at the call site. This proves the expectation is actually honoured
// on this endpoint, which is the part a reading cannot tell you: the gate sits at one point in the
// POST dispatcher, and a handler that returns before it would ignore the header silently.
//
//   node scripts/verify-rota-clash.mjs                              # dev server on :4937
//   node scripts/verify-rota-clash.mjs --base https://3-d-backup.vercel.app
//
// It restores the rota it found, on success OR failure.
import fs from "node:fs";
import { loginAs } from "./sweep/login.mjs";
import { chromium } from "playwright";
import { requireUp } from "./sweep/appUp.mjs";

const ARG = (f, d) => { const i = process.argv.indexOf(f); return i > -1 ? process.argv[i + 1] : d; };
const B = ARG("--base", "http://localhost:4937");
// Nothing answering = "could not run" (exit 2), said in plain words — never a raw ECONNREFUSED
// stack, which reads as "this guard is broken". (sweep #6 / T28, 2026-08-22)
await requireUp(B, "the rota walk");
const env = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const g = (k) => (env.match(new RegExp("^" + k + "=(.+)$", "m")) || [])[1]?.trim();
const REF = ARG("--db", "wnsfcizclkbobwzcxqsf"), RID = "00000000-0000-0000-0000-000000000001";
const q = async (sql) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: "POST", headers: { Authorization: "Bearer " + g("SUPABASE_ACCESS_TOKEN"), "content-type": "application/json" },
    body: JSON.stringify({ query: sql }) });
  const t = await r.text(); if (!r.ok) throw new Error(t.slice(0, 200)); return JSON.parse(t);
};
let fails = 0;
const check = (n, ok, d = "") => { console.log(`  ${ok ? "ok  " : "FAIL"} ${n}${d ? " — " + d : ""}`); if (!ok) fails++; };

console.log(`\nWAITER ROTA — FIRST SAVE WINS — ${B}\n`);
const waiter = (await q(`select id, username, assigned_tables from staff_users
  where restaurant_id='${RID}' and role='tablet' order by username limit 1`))[0];
if (!waiter) { console.log("  no waiter on this restaurant — nothing to test"); process.exit(0); }
const original = waiter.assigned_tables || [];
console.log(`  · waiter ${waiter.username} holds ${original.length} table(s)`);

const browser = await chromium.launch();
const ctx = await browser.newContext();
await loginAs(ctx, "manager", B, { username: "diagm1", password: "diag-mgr-2026", route: "/manager" });
const post = async (tables, expectFrom) => {
  const res = await ctx.request.post(`${B}/api/editor/table-sections?restaurant_id=${RID}`, {
    headers: {
      "content-type": "application/json",
      // What the panel's api() sends: the action id, and the expectation the SCREEN was showing.
      "X-LFH-Action-Id": "rota-clash-" + Math.random().toString(36).slice(2),
      ...(expectFrom ? { "X-LFH-Expect": JSON.stringify({ table: "staff_users", id: waiter.id, fields: { assigned_tables: expectFrom } }) } : {}),
    },
    data: { user_id: waiter.id, tables },
  });
  let body = null; try { body = await res.json(); } catch {}
  return { status: res.status(), body };
};

try {
  // Manager 1 saves [4,5] from what the screen was showing. Nobody has touched it → it lands.
  const first = await post([4, 5], original);
  check("manager 1's save lands (their expectation matched)", first.status >= 200 && first.status < 300, `HTTP ${first.status}`);
  const after1 = (await q(`select assigned_tables from staff_users where id='${waiter.id}'`))[0].assigned_tables || [];
  check("…and the rota really changed", String([...after1].sort()) === String([4, 5]), JSON.stringify(after1));

  // Manager 2's screen still shows the OLD list. Their save must be REFUSED, not silently applied.
  const second = await post([9], original);
  check("manager 2's stale save is REFUSED with 409", second.status === 409, `HTTP ${second.status}`);
  const plain = second.body && second.body.clash && second.body.clash.plain;
  check("…and the refusal carries a sentence, not just a code", !!plain && !/^[a-z_]+$/.test(plain), plain ? `"${String(plain).slice(0, 70)}"` : "no clash.plain");
  const after2 = (await q(`select assigned_tables from staff_users where id='${waiter.id}'`))[0].assigned_tables || [];
  check("…and manager 1's rota SURVIVED (first save wins)", String([...after2].sort()) === String([4, 5]), JSON.stringify(after2));

  // The order of the list is not a change: [5,4] must not read as a clash against [4,5].
  const reorder = await post([5, 4], [4, 5]);
  check("re-saving the same rota in a different ORDER is not a clash", reorder.status >= 200 && reorder.status < 300, `HTTP ${reorder.status}`);

  // ── THE HALF THAT ACTUALLY BITES ────────────────────────────────────────────────────────────
  // Everything above sends the header by hand, so it passes whether or not the PANEL sends one —
  // and the panel not sending one was the whole bug. (The "green tests ≠ the screen is right" rule:
  // the server half was never broken; the call site was.)
  //
  // So check the DEPLOYED panel file, not the local source: does the app.js this site is actually
  // serving carry the expectation at the rota's call site? That also answers "is the fix live",
  // which a local grep cannot. Driving the screen itself was tried and is not usable here — the
  // rota editor sits behind the `edit_settings|table_assign` grant and the diag manager does not
  // hold it, so there is no button to click for this role.
  const src = await (await fetch(`${B}/panels/editor/app.js`)).text();
  const site = src.slice(src.indexOf("async function saveWaiterTables"), src.indexOf("async function saveWaiterTables") + 2200);
  check("the DEPLOYED panel has the rota save", site.length > 100);
  check("…and it sends an expectation (this is the fix, live)", /expect:\s*\{[^}]*staff_users/.test(site),
    /expect:/.test(site) ? "expect present" : "NO expect at the call site — the rota can be overwritten silently");
  check("…naming assigned_tables as the field it edited from", /assigned_tables/.test(site) && /fields:/.test(site));
} finally {
  // THE RESTORE IS THE ONE WRITE THAT MUST NOT FAIL, SO IT RETRIES AND IT SHOUTS.
  //
  // Measured 2026-08-27 (sweep #7 / T28): every check above passed, and then this line itself threw
  // `Connection terminated due to connection timeout` from the SQL endpoint. Being inside `finally`
  // saved nothing — the restore is what timed out — so the run ended with the waiter holding the
  // TWO tables this test gave them instead of their real thirty. On a manager's Tables floor that
  // is a waiter who has silently lost 28 tables, and the guard exited claiming a fault in the app.
  //
  // Three tries with a short back-off, then a line nobody can miss with the exact SQL to run by
  // hand. A cleanup that can quietly not happen is not a cleanup.
  let restored = null, lastErr = "";
  for (let i = 0; i < 3 && restored === null; i++) {
    if (i) await new Promise((r) => setTimeout(r, 1500 * i));
    try {
      await q(`update staff_users set assigned_tables='{${original.join(",")}}' where id='${waiter.id}'`);
      restored = (await q(`select assigned_tables from staff_users where id='${waiter.id}'`))[0].assigned_tables || [];
    } catch (e) { lastErr = String(e.message || e).slice(0, 160); }
  }
  if (restored === null) {
    fails++;
    console.log(`\n  ❌ COULD NOT PUT ${waiter.username}'S ROTA BACK after 3 tries — ${lastErr}`);
    console.log(`     They are left holding the test's tables, not their own. Run this by hand:`);
    console.log(`     update staff_users set assigned_tables='{${original.join(",")}}' where id='${waiter.id}';`);
  } else {
    console.log(`  · restored ${waiter.username} to ${restored.length} table(s)`);
  }
  await browser.close();
}
console.log(`\n${fails ? `❌ ${fails} check(s) failed` : "✅ PASS — the rota cannot be overwritten behind someone's back"}\n`);
process.exit(fails ? 1 : 0);
