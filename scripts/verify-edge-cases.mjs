// "1-in-1000 glitch" hunt (owner request, 2026-06-12) — forces the rare race
// situations a real restaurant hits once a week and checks every screen reacts:
//   1. staff close the table while a partner is WAITING for approval
//      -> partner sees "session ended" (NOT "didn't let you in", NOT a spinner)
//   2. staff close the table while an APPROVED member is connected
//      -> their device disconnects cleanly (stored session + cart wiped)
//   3. two phones join an empty table at the SAME INSTANT -> exactly ONE head
//   4. staff transfer head on an already-CLOSED table -> refused (400)
// Reads secrets from .env.local itself; prints only pass/fail. Servers: menu on
// :4000, editor on :4001. Usage: node scripts/verify-edge-cases.mjs
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
const SB = env.NEXT_PUBLIC_SUPABASE_URL, SRK = env.SUPABASE_SERVICE_ROLE_KEY, ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!SB || !SRK || !ANON) { console.error("missing supabase env"); process.exit(1); }

const TABLE = "11"; // quiet test table, cleaned up at the end
let failures = 0;
const check = (ok, label) => { console.log(`${ok ? "✓" : "✗ FAIL"} ${label}`); if (!ok) failures++; };

const sb = async (method, path, body) => {
  const r = await fetch(`${SB}/rest/v1/${path}`, {
    method, headers: { apikey: SRK, Authorization: `Bearer ${SRK}`, "Content-Type": "application/json", Prefer: "return=representation" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status} ${t.slice(0, 200)}`);
  return t ? JSON.parse(t) : null;
};
// Anonymous RPC — the exact same way a guest's phone calls the backend.
const anonRpc = async (fn, args) => {
  const r = await fetch(`${SB}/rest/v1/rpc/${fn}`, {
    method: "POST", headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  return r.json();
};

const cleanup = async () => {
  await sb("DELETE", `sessions?table_number=eq.${TABLE}`);
  await sb("DELETE", `requests?table_number=eq.${TABLE}`);
};
await cleanup();

const tok = (p) => p + Math.random().toString(36).slice(2) + Date.now().toString(36);
const newSession = async () => (await sb("POST", "sessions", { table_number: TABLE, status: "open", auto_approve: false, opened_by: "waiter", opened_at: new Date().toISOString() }))[0];
const closeSession = (id) => sb("PATCH", `sessions?id=eq.${id}`, { status: "closed" }); // fires the close-cleanup trigger

const browser = await chromium.launch();
try {
  // ── 1. close the table while a partner is WAITING for approval ─────────────
  let sess = await newSession();
  await sb("POST", "session_members", { session_id: sess.id, name: null, token: tok("eh_"), role: "owner", approved: true });
  const gTok = tok("eg_");
  const [g] = await sb("POST", "session_members", { session_id: sess.id, name: "Edge Partner", token: gTok, role: "guest", approved: false });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto("http://localhost:4000/menu", { waitUntil: "domcontentloaded" });
  await page.evaluate(([t, token, memberId]) => {
    localStorage.setItem("lfh_session", JSON.stringify({ table: t, token, memberId, role: "guest" }));
    localStorage.setItem("lfh_table", t);
  }, [TABLE, gTok, g.id]);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  await page.evaluate((t) => {
    window.dispatchEvent(new CustomEvent("lfh:session-do", { detail: { action: "connect", table: t, payload: {} } }));
  }, TABLE);
  await page.waitForSelector("text=Waiting for the table", { timeout: 8000 });
  await closeSession(sess.id); // staff close the whole table mid-wait
  await page.waitForSelector("text=session ended", { timeout: 8000 });
  const saysDeclined = await page.isVisible("text=didn't let you in");
  check(!saysDeclined, "closed-while-waiting does NOT claim a personal decline");
  check(true, "closed-while-waiting shows 'session ended' instead of spinning");
  await ctx.close();

  // ── 2. close the table while an APPROVED member is connected ───────────────
  sess = await newSession();
  const hTok = tok("eh2_");
  const [h] = await sb("POST", "session_members", { session_id: sess.id, name: "Solo Head", token: hTok, role: "owner", approved: true });
  const ctx2 = await browser.newContext();
  const p2 = await ctx2.newPage();
  await p2.goto("http://localhost:4000/menu", { waitUntil: "domcontentloaded" });
  await p2.evaluate(([t, token, memberId]) => {
    localStorage.setItem("lfh_session", JSON.stringify({ table: t, token, memberId, role: "owner" }));
    localStorage.setItem("lfh_table", t);
    localStorage.setItem("lfh_cart", JSON.stringify([{ id: "x", qty: 1 }])); // a cart that must be wiped on close
  }, [TABLE, hTok, h.id]);
  await p2.reload({ waitUntil: "domcontentloaded" });
  await p2.waitForTimeout(4500); // let the status widget poll and mark itself active
  await closeSession(sess.id);
  // within ~2 polls the device must fully disconnect: stored session + cart gone
  let cleared = false;
  for (let i = 0; i < 10 && !cleared; i++) {
    await p2.waitForTimeout(1000);
    cleared = await p2.evaluate(() => !localStorage.getItem("lfh_session") && !localStorage.getItem("lfh_cart"));
  }
  check(cleared, "closed-while-connected wipes the device's session + cart (no zombie 'connected' state)");
  await ctx2.close();

  // ── 3. the two-heads race: simultaneous joins on an empty open table ───────
  sess = await newSession();
  const [a, b] = await Promise.all([
    anonRpc("lfh_join_session", { p_table: TABLE, p_name: "Race A", p_lat: null, p_lng: null }),
    anonRpc("lfh_join_session", { p_table: TABLE, p_name: "Race B", p_lat: null, p_lng: null }),
  ]);
  const owners = await sb("GET", `session_members?session_id=eq.${sess.id}&role=eq.owner&removed=eq.false&select=id`);
  check(a.ok && b.ok, `both simultaneous joins succeed (${a.reason || "ok"}/${b.reason || "ok"})`);
  check(owners.length === 1, `exactly ONE head after a simultaneous double-join (got ${owners.length})`);

  // ── 4. transfer head on a CLOSED table must be refused ─────────────────────
  const [pend] = await sb("POST", "session_members", { session_id: sess.id, name: "Late Joiner", token: tok("el_"), role: "guest", approved: false });
  await closeSession(sess.id);
  let cookie = "";
  if (env.EDITOR_PASSWORD) {
    const r = await fetch("http://localhost:4001/login", {
      method: "POST", redirect: "manual",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `password=${encodeURIComponent(env.EDITOR_PASSWORD)}`,
    });
    cookie = (r.headers.get("set-cookie") || "").split(";")[0];
  }
  const mh = await fetch(`http://localhost:4001/api/members/${pend.id}/make-head`, {
    method: "POST", headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
  });
  check(mh.status === 400, `make-head on a closed table is refused (got ${mh.status})`);
} finally {
  await browser.close();
  await cleanup();
}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : "\nALL EDGE-CASE CHECKS PASSED");
process.exit(failures ? 1 : 0);
