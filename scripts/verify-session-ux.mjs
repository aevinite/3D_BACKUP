// End-to-end check of the session UX changes (2026-06-12):
//   1. a partner whose join was DECLINED sees the "didn't let you in" screen
//      (not the forever-spinner) — exercises migration 033 + SessionGate poll;
//   2. "Another table" goes back to the scan-or-type screen with Scan QR + ✕;
//   3. the editor's make-head endpoint hands the table over (old head kicked);
//   4. the editor side panel has the everyday cards on top, Features at the bottom,
//      and the table panel offers a "👑 Head" transfer button.
// Reads secrets from .env.local itself and prints ONLY pass/fail lines — no keys.
// Usage: node scripts/verify-session-ux.mjs   (the unified app on :4000)
//
// ⚠️ WHAT THE T28 SWEEP FIXED AND WHAT IS STILL OWED (2026-08-22)
//
// FIXED, and each one was real:
//   1. IT COULD NOT NAVIGATE AT ALL. Two `page.goto("${BASE}/menu")` calls used DOUBLE QUOTES, so
//      the literal characters ${BASE}/menu went to Playwright and it answered "Cannot navigate to
//      invalid URL" — before the first assertion, every run. The same typo was in
//      verify-edge-cases.mjs, ten times. A guard that never runs is worse than no guard: it sits in
//      the list looking like cover. Backticks now.
//   2. IT WROTE TO EVERY RESTAURANT. The teardown matched `table_number=eq.9` with no tenant, so it
//      closed and soft-deleted table 9's session in every restaurant on the platform — Aangan, the
//      read-only control, included. Scoped to French House.
//   3. ITS FIXTURE COULD NOT INSERT. `sessions.restaurant_id` and `session_members.restaurant_id`
//      are NOT NULL with no default; all four inserts omitted them and died on 23502. Supplied.
//   4. TWO ASSERTIONS DEFENDED DELETED DESIGN. The `.floor-side` cards were removed WITH the side
//      panel by the owner on 2026-07-31, and `[data-quick-requests]` never fired at all — app.js
//      says so where its handler was deleted: "NO tile emits these" (T3 sweep, 2026-08-06). Both
//      retired, with the four joiner actions moved to where they now live (`.sx-mem` in the table
//      panel), which is what they were really testing.
//
// STILL OWED, and deliberately not guessed at: the floor-interaction section drives the TOP-LEVEL
// page, but the panel UI lives in an IFRAME (every other panel guard uses `frameLocator`). That
// section needs rebuilding against the iframe, and the two transfer assertions ("old head was
// kicked", "partner became the approved head") need checking one by one against the current
// make-head endpoint. This is the same debt the 2026-07-30 note below recorded; it is smaller now,
// and it is honest about what is left rather than crashing on the way there.
//
// ⚠️ PARTIALLY REPAIRED, STILL RED (2026-07-30). This script predates the 2026-06-13 merge of the
// four panel servers into ONE app. Repaired here: the :4001 references now point at :4000, the
// editor calls use the /api/editor/... prefix, auth uses the admin cookie, and the teardown
// closes + soft-deletes instead of hard-DELETEing (mig 190 forbids erasing an issued bill, and
// every session gets a bill_no, so the old teardown could never succeed). What REMAINS: its
// assertions still describe the pre-merge API and need reviewing one by one. No app bug has
// surfaced from it — the failures are the script's own staleness. Run it before trusting it.
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
// NOTE: the panels stopped being separate servers on 2026-06-13 — the editor's endpoints now
// live under /api/editor/... inside the ONE app on :4000. These calls were still using the old
// un-prefixed paths and answered 404, so the checks below had been failing for weeks. (2026-07-30)
import { createHash } from "node:crypto";
import { chromium } from "playwright";

// A guard that can only run when port 4000 happens to be up is a guard that gets skipped — and
// 4000 belongs to the human, so a parallel session or CI could never run this at all. Accept a
// target like every other guard here does. (2026-08-04 sweep.)
const BASE = (() => {
  const i = process.argv.indexOf("--base");
  return (i > -1 && process.argv[i + 1]) || process.env.VERIFY_BASE || "http://localhost:4000";
})().replace(/\/$/, "");


const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const env = Object.fromEntries(
  readFileSync(join(root, ".env.local"), "utf8").split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; })
);
const SB = env.NEXT_PUBLIC_SUPABASE_URL;
const SRK = env.SUPABASE_SERVICE_ROLE_KEY;
if (!SB || !SRK) { console.error("missing supabase env"); process.exit(1); }

const TABLE = "9"; // a quiet table for the test; everything is cleaned up at the end
// THE ONE RESTAURANT THIS MAY WRITE TO, AND IT WAS MISSING (T28 sweep, 2026-08-22).
// Two faults in one: `sessions.restaurant_id` and `session_members.restaurant_id` are NOT NULL with
// no default, so the fixture insert died on `23502` before the first assertion — the same fault
// found in verify-realtime.mjs and verify-cancelled-tile-parity.mjs, from the change that stopped
// every table guessing its restaurant. AND the teardown below matched `table_number=eq.9` with no
// restaurant at all, so it closed and soft-deleted table 9's session in EVERY restaurant on the
// platform, Aangan included — the read-only control. Both are scoped now.
const RID = "00000000-0000-0000-0000-000000000001"; // French House — the writable fixture tenant
let failures = 0;
const check = (ok, label) => { console.log(`${ok ? "✓" : "✗ FAIL"} ${label}`); if (!ok) failures++; };

// Tiny service-role REST helper (server-side only — the key never leaves this process).
const sb = async (method, path, body) => {
  const r = await fetch(`${SB}/rest/v1/${path}`, {
    method,
    headers: { apikey: SRK, Authorization: `Bearer ${SRK}`, "Content-Type": "application/json", Prefer: "return=representation" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status} ${t.slice(0, 200)}`);
  return t ? JSON.parse(t) : null;
};

// ── setup: a fresh open session with a head + an UNAPPROVED partner ──────────
const cleanup = async () => {
  // TEARDOWN FOLLOWS THE PRODUCT'S OWN RULE: a bill is never erased, it is closed/soft-deleted.
  // mig 190 blocks hard-DELETE of any "issued" session or order, and since every session gets a
  // daily bill_no stamped by trigger, that means EVERY session — so the old DELETE teardown could
  // never succeed and these scripts had been failing on a 23514 check violation before their first
  // assertion. Closing + soft-deleting clears the fixture off the floor exactly as the app would.
  // (2026-07-30)
  await sb("PATCH", `sessions?restaurant_id=eq.${RID}&table_number=eq.${TABLE}`, { status: "closed", closed_at: new Date().toISOString(), deleted_at: new Date().toISOString() });
  await sb("DELETE", `requests?restaurant_id=eq.${RID}&table_number=eq.${TABLE}`);
};
await cleanup(); // clear any leftovers from an earlier crashed run

const [sess] = await sb("POST", "sessions", { restaurant_id: RID, table_number: TABLE, status: "open", auto_approve: false, opened_by: "guest", opened_at: new Date().toISOString() });
const tok = (p) => p + Math.random().toString(36).slice(2) + Date.now().toString(36);
const headTok = tok("vh_"), guestTok = tok("vg_");
const [head] = await sb("POST", "session_members", { restaurant_id: RID, session_id: sess.id, name: null, token: headTok, role: "owner", approved: true });
const [guest] = await sb("POST", "session_members", { restaurant_id: RID, session_id: sess.id, name: "Verify Partner", token: guestTok, role: "guest", approved: false });

const browser = await chromium.launch();

// Dispatch the gate's "connect" event until its popup appears — a freshly-loaded
// dev page may hydrate a beat after first paint and silently lose earlier events.
const fireGate = async (page, table) => {
  await page.waitForSelector(".cat-group-head", { timeout: 20000 }); // menu rendered = React alive
  for (let i = 0; i < 6; i++) {
    await page.evaluate((t) => {
      window.dispatchEvent(new CustomEvent("lfh:session-do", { detail: { action: "connect", table: t, payload: {} } }));
    }, table);
    if (await page.waitForSelector(".sg-overlay", { timeout: 2000 }).catch(() => null)) return;
  }
  throw new Error("session gate never opened after 6 dispatches");
};

try {
  // Warm-up: force the dev server to compile /menu before any timed scenario.
  {
    const w = await browser.newContext();
    const wp = await w.newPage();
    // BACKTICKS, NOT DOUBLE QUOTES (T28 sweep, 2026-08-22). This read ``${BASE}/menu``, so the
    // literal five characters ${BAS…} were handed to goto() and Playwright answered "Cannot
    // navigate to invalid URL" — before the first assertion, on every run. The guard could not
    // run at all, and a guard that never runs is worse than no guard: it sits in the list looking
    // like cover. Line 117 had the same typo; line 159 always had it right.
    await wp.goto(`${BASE}/menu`, { waitUntil: "domcontentloaded" });
    await wp.waitForSelector(".cat-group-head", { timeout: 60000 });
    await w.close();
  }

  // ── 1+2: the declined partner's screen ─────────────────────────────────────
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`${BASE}/menu`, { waitUntil: "domcontentloaded" });
  // Plant the partner's session note + remembered table, exactly as a real join would.
  await page.evaluate(([t, token, memberId]) => {
    localStorage.setItem("lfh_session", JSON.stringify({ table: t, token, memberId, role: "guest" }));
    localStorage.setItem("lfh_table", t);
  }, [TABLE, guestTok, guest.id]);
  await page.reload({ waitUntil: "domcontentloaded" });
  // Ask the gate to connect — an unapproved member lands on the waiting screen.
  await fireGate(page, TABLE);
  await page.waitForSelector("text=Waiting for the table", { timeout: 8000 });
  check(true, "partner sees the waiting screen while unapproved");

  // The head declines: the member row gets removed=true (same thing the head's
  // phone or the editor's Deny does).
  await sb("PATCH", `session_members?id=eq.${guest.id}`, { removed: true });

  // Within a couple of polls the partner must see the DECLINED screen.
  await page.waitForSelector("text=didn't let you in", { timeout: 8000 });
  check(true, "declined partner sees 'didn't let you in' (no more forever-spinner)");
  await page.screenshot({ path: "verify-denied.png" });

  // "Another table" → back to scan-or-type, with the Scan QR option.
  await page.click("text=Another table");
  await page.waitForSelector("text=Which table are you at?", { timeout: 4000 });
  check(true, "'Another table' returns to the table screen");
  check(await page.isVisible("text=Scan QR"), "table screen offers Scan QR");
  // Typing a number must reveal the ✕ clear button, and ✕ must empty the box.
  await page.fill(".sg-input", "12");
  check(await page.isVisible(".sg-input-clear"), "✕ appears once a number is typed");
  await page.click(".sg-input-clear");
  check((await page.inputValue(".sg-input")) === "", "✕ clears the table number");
  await page.screenshot({ path: "verify-asktable.png" });
  await ctx.close();

  // ── 3: make-head endpoint (editor) ─────────────────────────────────────────
  // Bring the partner back (un-remove) so they can be promoted.
  await sb("PATCH", `session_members?id=eq.${guest.id}`, { removed: false });
  // The editor's API is behind the admin gate now (it used to be an open Express server on
  // :4001 with its own /login form and an EDITOR_PASSWORD). The gate reads a cookie holding
  // sha256(ADMIN_PASSWORD) — compute it directly so the password is never sent or printed, and
  // so this never burns a login attempt against the rate limit. (2026-07-30)
  const cookie = "lfh_staff_auth=" + createHash("sha256").update(env.ADMIN_PASSWORD || "").digest("hex");
  const mh = await fetch(`${BASE}/api/editor/members/${guest.id}/make-head`, {
    method: "POST", headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
  });
  check(mh.ok, `make-head endpoint answers ok (${mh.status})`);
  const members = await sb("GET", `session_members?session_id=eq.${sess.id}&select=id,role,approved,removed`);
  const oldHead = members.find((m) => m.id === head.id);
  const newHead = members.find((m) => m.id === guest.id);
  check(oldHead?.removed === true, "old head was kicked (removed)");
  check(newHead?.role === "owner" && newHead?.approved === true && newHead?.removed === false, "partner became the approved head");

  // ── 4: editor UI — side panel order + 👑 Head button ───────────────────────
  const ectx = await browser.newContext();
  if (cookie) {
    const [name, value] = cookie.split("=");
    await ectx.addCookies([{ name, value, url: BASE }]);
  }
  // A fresh UNAPPROVED joiner first, so the Requests card + tile Attend show up.
  await sb("POST", "session_members", { restaurant_id: RID, session_id: sess.id, name: "Second Guest", token: tok("vg2_"), role: "guest", approved: false });
  const ep = await ectx.newPage();
  await ep.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  // Get to the Tables (floor) view — its tab mentions "Tables".
  const tab = ep.locator("button, .tab, [role=tab]").filter({ hasText: /tables/i }).first();
  if (await tab.count()) await tab.click();
  // ── THE SIDE PANEL IS GONE — THESE CHECKS MOVED ONTO THE TILE (T28 sweep, 2026-08-22) ────────
  //
  // Two checks here waited on `.floor-side`: the order of its cards ("Features last") and the
  // joiner's four actions inside its Requests card. The owner DELETED that panel on 2026-07-31 —
  // editor/app.js says so where the cards used to be built: "The floor's three right-hand cards —
  // Requests, Needs and To accept — were deleted with the side panel itself. Nothing they told you
  // was lost: each tile carries its own badges." Only leftover CSS and the admin's floor PREVIEW
  // still mention `.floor-side`, so the wait could never resolve and this guard timed out here on
  // every run — a guard defending a design the owner removed.
  //
  //  · The card-order check is RETIRED, not re-pointed: those cards do not exist to be ordered.
  //  · The four joiner actions DO still exist — they moved into the table detail panel (`.sx-mem`),
  //    which is where the modal check below already looks. So the check moves there with them,
  //    keeping what it was really for: a waiting joiner can be approved, denied, banned or handed
  //    the table, from one place.
  //
  // AND THE TILE'S "QUICK ATTEND" NEVER EXISTED EITHER. This waited on
  // `[data-floor-table="N"] [data-quick-requests]`. editor/app.js is explicit about that hook, at
  // the delegated click handler: "Eight more branches sat here and not one of them could ever fire:
  // [data-quick-attend] / [data-quick-pay] / [data-quick-requests] — NO tile emits these" (T3
  // sweep, 2026-08-06, which deleted the handlers). So the assertion is retired rather than
  // re-pointed: there is no such control to find, and demanding one would ask for a feature back
  // that was removed as dead code.
  //
  // The INTENT survives and is what the checks below cover: a manager can see a waiting joiner and
  // act on them. The way in is the tile itself — "a free tile IS the button (tapping it opens the
  // order builder)", and an occupied one opens the table panel.
  await ep.click(`.ftile[data-floor-table="${TABLE}"]`);
  await ep.waitForSelector(".tbl-modal", { timeout: 6000 });
  await ep.waitForTimeout(800); // panel refreshes off the live board poll
  await ep.waitForSelector(".tbl-modal .sx-mem [data-mem-approve]", { timeout: 8000 }).catch(() => {});
  const joinerActs = await ep.$eval(".tbl-modal .sx-mem:has([data-mem-approve])", (row) => ({
    deny: !!row.querySelector("[data-mem-deny]"),
    ban: !!row.querySelector("[data-mem-ban]"),
    transfer: !!row.querySelector("[data-mem-head]"),
    ok: !!row.querySelector("[data-mem-approve]"),
    transferLabel: row.querySelector("[data-mem-head]")?.textContent.trim(),
  })).catch(() => ({}));
  check(joinerActs.deny && joinerActs.ban && joinerActs.transfer && joinerActs.ok,
    `a waiting joiner's row offers Approve / ✕ / Ban / Transfer (${JSON.stringify(joinerActs)})`);
  check(joinerActs.transferLabel === "Transfer", "the transfer button reads exactly 'Transfer'");
  const hasHeadBtn = await ep.isVisible(".tbl-modal [data-mem-head]");
  check(hasHeadBtn, "table panel offers the Transfer button on a guest");
  await ep.screenshot({ path: "verify-tablepanel.png" });
  await ectx.close();
} finally {
  await browser.close();
  await cleanup(); // leave no test session behind
}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : "\nALL CHECKS PASSED");
process.exit(failures ? 1 : 0);
