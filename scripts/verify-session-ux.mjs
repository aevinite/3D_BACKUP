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
  await sb("PATCH", `sessions?table_number=eq.${TABLE}`, { status: "closed", closed_at: new Date().toISOString(), deleted_at: new Date().toISOString() });
  await sb("DELETE", `requests?table_number=eq.${TABLE}`);
};
await cleanup(); // clear any leftovers from an earlier crashed run

const [sess] = await sb("POST", "sessions", { table_number: TABLE, status: "open", auto_approve: false, opened_by: "guest", opened_at: new Date().toISOString() });
const tok = (p) => p + Math.random().toString(36).slice(2) + Date.now().toString(36);
const headTok = tok("vh_"), guestTok = tok("vg_");
const [head] = await sb("POST", "session_members", { session_id: sess.id, name: null, token: headTok, role: "owner", approved: true });
const [guest] = await sb("POST", "session_members", { session_id: sess.id, name: "Verify Partner", token: guestTok, role: "guest", approved: false });

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
    await wp.goto("http://localhost:4000/menu", { waitUntil: "domcontentloaded" });
    await wp.waitForSelector(".cat-group-head", { timeout: 60000 });
    await w.close();
  }

  // ── 1+2: the declined partner's screen ─────────────────────────────────────
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto("http://localhost:4000/menu", { waitUntil: "domcontentloaded" });
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
  const mh = await fetch(`http://localhost:4000/api/editor/members/${guest.id}/make-head`, {
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
    await ectx.addCookies([{ name, value, url: "http://localhost:4000" }]);
  }
  // A fresh UNAPPROVED joiner first, so the Requests card + tile Attend show up.
  await sb("POST", "session_members", { session_id: sess.id, name: "Second Guest", token: tok("vg2_"), role: "guest", approved: false });
  const ep = await ectx.newPage();
  await ep.goto("http://localhost:4000/", { waitUntil: "domcontentloaded" });
  // Get to the Tables (floor) view — its tab mentions "Tables".
  const tab = ep.locator("button, .tab, [role=tab]").filter({ hasText: /tables/i }).first();
  if (await tab.count()) await tab.click();
  // Wait for the REAL cards (the loading skeleton has .fc-card but no <h3>).
  await ep.waitForSelector(".floor-side .fc-card h3", { timeout: 10000 });
  const cardTitles = await ep.$$eval(".floor-side .fc-card h3", (hs) => hs.map((h) => h.textContent.trim()));
  // Everyday cards on top, Features last — only when sessions are ON does the
  // bulk card exist, so just demand that "Features" is the LAST card.
  check(/Features/i.test(cardTitles[cardTitles.length - 1] || ""), `Features card is at the bottom (${cardTitles.join(" | ")})`);
  // The pending joiner must appear in the Requests card with all four actions.
  await ep.waitForSelector(".floor-side [data-mem-approve]", { timeout: 8000 });
  const joinerActs = await ep.$eval(".floor-side .sx-req", (row) => ({
    deny: !!row.querySelector("[data-mem-deny]"),
    ban: !!row.querySelector("[data-mem-ban]"),
    transfer: !!row.querySelector("[data-mem-head]"),
    ok: !!row.querySelector("[data-mem-approve]"),
    transferLabel: row.querySelector("[data-mem-head]")?.textContent.trim(),
  }));
  check(joinerActs.deny && joinerActs.ban && joinerActs.transfer && joinerActs.ok,
    "Requests card joiner row has ✕ / Ban / Transfer / OK");
  check(joinerActs.transferLabel === "Transfer", "the transfer button reads exactly 'Transfer'");
  // The table's TILE must offer a quick Attend while the joiner waits.
  check(await ep.isVisible(`[data-floor-table="${TABLE}"] [data-quick-requests]`),
    "tile shows a quick Attend while a partner waits to join");
  await ep.screenshot({ path: "verify-floorside.png", fullPage: false });
  // The tile's Attend opens the table panel, where the per-guest Transfer lives.
  await ep.click(`[data-floor-table="${TABLE}"] [data-quick-requests]`);
  await ep.waitForSelector(".tbl-modal", { timeout: 6000 });
  await ep.waitForTimeout(800); // panel refreshes off the live board poll
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
