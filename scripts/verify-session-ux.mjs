// End-to-end check of the session UX changes (2026-06-12):
//   1. a partner whose join was DECLINED sees the "didn't let you in" screen
//      (not the forever-spinner) — exercises migration 033 + SessionGate poll;
//   2. "Another table" goes back to the scan-or-type screen with Scan QR + ✕;
//   3. the editor's make-head endpoint hands the table over (old head kicked);
//   4. the editor side panel has the everyday cards on top, Features at the bottom,
//      and the table panel offers a "👑 Head" transfer button.
// Reads secrets from .env.local itself and prints ONLY pass/fail lines — no keys.
// Usage: node scripts/verify-session-ux.mjs   (menu on :4000, editor on :4001)
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
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
  // deleting the session cascades to its members; requests are keyed by table
  await sb("DELETE", `sessions?table_number=eq.${TABLE}`);
  await sb("DELETE", `requests?table_number=eq.${TABLE}`);
};
await cleanup(); // clear any leftovers from an earlier crashed run

const [sess] = await sb("POST", "sessions", { table_number: TABLE, status: "open", auto_approve: false, opened_by: "guest", opened_at: new Date().toISOString() });
const tok = (p) => p + Math.random().toString(36).slice(2) + Date.now().toString(36);
const headTok = tok("vh_"), guestTok = tok("vg_");
const [head] = await sb("POST", "session_members", { session_id: sess.id, name: null, token: headTok, role: "owner", approved: true });
const [guest] = await sb("POST", "session_members", { session_id: sess.id, name: "Verify Partner", token: guestTok, role: "guest", approved: false });

const browser = await chromium.launch();
try {
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
  await page.waitForTimeout(1500); // let the gate mount + settings load
  // Ask the gate to connect — an unapproved member lands on the waiting screen.
  await page.evaluate((t) => {
    window.dispatchEvent(new CustomEvent("lfh:session-do", { detail: { action: "connect", table: t, payload: {} } }));
  }, TABLE);
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
  // The editor may be password-locked; log in like the form does if needed.
  let cookie = "";
  if (env.EDITOR_PASSWORD) {
    const r = await fetch("http://localhost:4001/login", {
      method: "POST", redirect: "manual",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `password=${encodeURIComponent(env.EDITOR_PASSWORD)}`,
    });
    cookie = (r.headers.get("set-cookie") || "").split(";")[0];
  }
  const mh = await fetch(`http://localhost:4001/api/members/${guest.id}/make-head`, {
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
    await ectx.addCookies([{ name, value, url: "http://localhost:4001" }]);
  }
  const ep = await ectx.newPage();
  await ep.goto("http://localhost:4001/", { waitUntil: "domcontentloaded" });
  // Get to the Tables (floor) view — its tab mentions "Tables".
  const tab = ep.locator("button, .tab, [role=tab]").filter({ hasText: /tables/i }).first();
  if (await tab.count()) await tab.click();
  // Wait for the REAL cards (the loading skeleton has .fc-card but no <h3>).
  await ep.waitForSelector(".floor-side .fc-card h3", { timeout: 10000 });
  const cardTitles = await ep.$$eval(".floor-side .fc-card h3", (hs) => hs.map((h) => h.textContent.trim()));
  // Everyday cards on top, Features last — only when sessions are ON does the
  // bulk card exist, so just demand that "Features" is the LAST card.
  check(/Features/i.test(cardTitles[cardTitles.length - 1] || ""), `Features card is at the bottom (${cardTitles.join(" | ")})`);
  await ep.screenshot({ path: "verify-floorside.png", fullPage: false });
  // Open the test table's panel and look for the 👑 transfer button on a guest.
  // (Re-add a fresh unapproved guest so the panel has a transferable row.)
  await sb("POST", "session_members", { session_id: sess.id, name: "Second Guest", token: tok("vg2_"), role: "guest", approved: true });
  await ep.click(`[data-floor-table="${TABLE}"]`);
  await ep.waitForSelector(".tbl-modal", { timeout: 6000 });
  await ep.waitForTimeout(800); // panel refreshes off the live board poll
  const hasHeadBtn = await ep.isVisible("[data-mem-head]");
  check(hasHeadBtn, "table panel offers a 👑 Head (transfer) button on a guest");
  await ep.screenshot({ path: "verify-tablepanel.png" });
  await ectx.close();
} finally {
  await browser.close();
  await cleanup(); // leave no test session behind
}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : "\nALL CHECKS PASSED");
process.exit(failures ? 1 : 0);
