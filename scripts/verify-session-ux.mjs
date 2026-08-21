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
// ✅ ALIVE AND GREEN AGAIN (sweep #6 / T28, 2026-08-22). It had been dying at its FIRST write for
// weeks: `sessions.restaurant_id` became NOT NULL when the app went multi-tenant, so the fixture
// insert answered 23502 and none of the eleven checks below ever ran. Three `page.goto` calls were
// also in double quotes, so Chrome was handed the literal address `${BASE}/menu`. And the teardown
// named no restaurant — `PATCH sessions?table_number=eq.9` closes table 9 in EVERY restaurant on the
// stack, which on a live one ends that party's meal (the close trigger cancels every unpaid live
// order, mig 232). Section 4 still reached the editor as if it were its own Express server on a bare
// path; the panels have been iframes inside the ONE app since 2026-06-13.
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
// NOTE: the panels stopped being separate servers on 2026-06-13 — the editor's endpoints now
// live under /api/editor/... inside the ONE app on :4000. These calls were still using the old
// un-prefixed paths and answered 404, so the checks below had been failing for weeks. (2026-07-30)
import { createHash } from "node:crypto";
import { chromium } from "playwright";
import { loginAs } from "./sweep/login.mjs";

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
const RID = "00000000-0000-0000-0000-000000000001";   // My Little French House — the one we write to
const SLUG = "french-house";                          // guest storage is scoped per restaurant
const K = (base) => `${base}:${SLUG}`;                // lib/tenantStorage.ts — "lfh_cart:french-house"
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
  // AND THE FOOD GOES WITH IT. Section 4 puts a real ticket on the table so the tile has something to
  // open; leaving it behind would put a live "0/1 served" table 9 on the manager's floor after the run
  // — the same phantom-table fault that killed verify-cancelled-tile-parity. An issued order cannot be
  // hard-deleted (it carries a KOT number, mig 190), so it is retired the way a cancellation does.
  const now = new Date().toISOString();
  await sb("PATCH", `orders?restaurant_id=eq.${RID}&table_number=eq.${TABLE}&archived=is.false`,
    { status: "cancelled", archived: true, archived_at: now, cancelled_at: now });
  await sb("PATCH", `sessions?restaurant_id=eq.${RID}&table_number=eq.${TABLE}&status=eq.open`, { status: "closed", closed_at: now, deleted_at: now });
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
    await wp.goto(`${BASE}/menu`, { waitUntil: "domcontentloaded" });
    await wp.waitForSelector(".cat-group-head", { timeout: 60000 });
    await w.close();
  }

  // ── 1+2: the declined partner's screen ─────────────────────────────────────
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`${BASE}/menu`, { waitUntil: "domcontentloaded" });
  // Plant the partner's session note + remembered table, exactly as a real join would.
  await page.evaluate(([t, token, memberId, kSess, kTable]) => {
    localStorage.setItem(kSess, JSON.stringify({ table: t, token, memberId, role: "guest" }));
    localStorage.setItem(kTable, t);
  }, [TABLE, guestTok, guest.id, K("lfh_session"), K("lfh_table")]);
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
  // ?rid= IS NOT OPTIONAL FOR AN ADMIN REQUEST (sweep #6 / T28, 2026-08-22). Every /api/editor write
  // resolves its restaurant through lib/panelScope → panelRestaurantId, which takes it from the staff
  // user for a member of staff and from ?rid= (or the act-as cookie) for the admin super-user. With
  // neither, editorScope answers 400 "No restaurant scope" — so this call was refused before it ever
  // reached the make-head logic, and the three checks below reported the app's behaviour wrongly.
  const mh = await fetch(`${BASE}/api/editor/members/${guest.id}/make-head?rid=${RID}`, {
    method: "POST", headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
  });
  check(mh.ok, `make-head endpoint answers ok (${mh.status})`);
  const members = await sb("GET", `session_members?session_id=eq.${sess.id}&select=id,role,approved,removed`);
  const oldHead = members.find((m) => m.id === head.id);
  const newHead = members.find((m) => m.id === guest.id);
  check(oldHead?.removed === true, "old head was kicked (removed)");
  check(newHead?.role === "owner" && newHead?.approved === true && newHead?.removed === false, "partner became the approved head");

  // ── 4: the manager's own controls over a waiting guest ─────────────────────
  // THREE OF THIS SECTION'S FOUR CHECKS DESCRIBED SCREENS THE OWNER HAD DELETED (sweep #6 / T28,
  // 2026-08-22), and the fourth could never be reached, so the section timed out and crashed the run
  // — taking the report of every check above it with it. What it asked for, and why each is gone:
  //
  //   · "the Features card is at the bottom of the side panel" — the docked side panel and its
  //     "Features · rarely changed" card were deleted on 2026-07-31, and the Features TAB with them
  //     on 2026-08-06, because guest switches belong to the ADMIN alone (docs/ACCESS-MODEL.md).
  //     Asserting it back would be asking for ten restaurant-wide switches in a manager's hands.
  //   · "the tile shows a quick Attend" — public/panels/editor/app.js says it in as many words:
  //     "[data-quick-attend] / [data-quick-pay] / [data-quick-requests] — NO tile emits these".
  //   · "the Requests card joiner row has ✕ / Ban / Transfer / OK" — the member controls moved into
  //     the floating TABLE PANEL; `.sx-req` rows are guest REQUESTS now and carry data-req-*.
  //
  // What survives is the thing that matters to a manager and is still true: open the table and every
  // control over a guest who is waiting is there — let them in, refuse them, hand them the table, or
  // ban them. It is asserted where they actually live, inside the panel's frame.
  const ectx = await browser.newContext();
  await loginAs(ectx, "manager", BASE);
  await sb("POST", "session_members", { restaurant_id: RID, session_id: sess.id, name: "Second Guest", token: tok("vg2_"), role: "guest", approved: false });
  // A TABLE WITH NO FOOD ON IT READS "Free", AND A FREE TILE OPENS NOTHING. The floor is driven by
  // live orders, not by memberships — there is no "open this table" step any more, taking an order is
  // what starts the party. So put one real ticket on the table through the waiter's own RPC before
  // asking the panel to open; without it this section clicks a tile that has nothing to show.
  const dish = (await sb("GET", `menu_items?restaurant_id=eq.${RID}&select=id&limit=1`))[0];
  await sb("POST", "rpc/lfh_staff_place_order", {
    p_table: TABLE, p_items: [{ id: dish.id, qty: 1 }], p_allergies: [], p_note: null, p_restaurant_id: RID,
  });
  const ep = await ectx.newPage();
  await ep.goto(`${BASE}/manager`, { waitUntil: "domcontentloaded" });
  const fr = ep.frameLocator("iframe").first();
  try { await fr.locator('.tab[data-tab="tables"]').first().click({ timeout: 30000 }); } catch {}
  await fr.locator(`.ftile[data-floor-table="${TABLE}"]`).first().waitFor({ timeout: 30000 });
  // Click the tile's own NUMBER, never its middle: the middle of an occupied tile is the ＋ Take order
  // button, and the floor handler returns early for a button so the panel would never open.
  await fr.locator(`.ftile[data-floor-table="${TABLE}"] .ft-num`).first().click({ force: true });
  // The table detail is a FLOATING card (.tp-detail-floating > .tp-detail) since 2026-07-02 — the
  // docked ".tbl-modal" panel this section used to look for belongs to the other dialogs now.
  await fr.locator(".tp-detail").first().waitFor({ timeout: 25000 });
  await ep.waitForTimeout(1500); // the detail re-renders off the live board poll
  const waitingRow = fr.locator(".tp-detail .sx-mem").filter({ hasText: "waiting" }).first();
  const acts = await waitingRow.evaluate((row) => ({
    approve: !!row.querySelector("[data-mem-approve]"),
    deny: !!row.querySelector("[data-mem-deny]"),
    transfer: !!row.querySelector("[data-mem-head]"),
    ban: !!row.querySelector("[data-mem-ban]"),
    transferLabel: row.querySelector("[data-mem-head]")?.textContent.trim(),
  })).catch(() => null);
  check(!!acts && acts.approve && acts.deny && acts.transfer && acts.ban,
    `a waiting guest's row offers Approve / Deny / Transfer / Ban (${JSON.stringify(acts)})`);
  check(!!acts && acts.transferLabel === "Transfer", `the transfer button reads exactly 'Transfer' (got ${JSON.stringify(acts && acts.transferLabel)})`);
  await ep.screenshot({ path: "verify-tablepanel.png" });
  await ectx.close();
} finally {
  await browser.close();
  await cleanup(); // leave no test session behind
}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : "\nALL CHECKS PASSED");
process.exit(failures ? 1 : 0);
