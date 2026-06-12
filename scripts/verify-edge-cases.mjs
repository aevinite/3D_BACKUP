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

// Dispatch the gate's "connect" event until its popup actually appears — on a
// freshly-loaded dev page, React may hydrate a beat after first paint, and an
// event fired before that is silently lost. `double` fires it twice in the same
// tick (the double-tap scenarios).
const fireGate = async (page, table, { double = false } = {}) => {
  await page.waitForSelector(".cat-group-head", { timeout: 20000 }); // menu rendered = React alive
  for (let i = 0; i < 6; i++) {
    await page.evaluate(([t, dbl]) => {
      const fire = () => window.dispatchEvent(new CustomEvent("lfh:session-do", { detail: { action: "connect", table: t, payload: {} } }));
      fire(); if (dbl) fire();
    }, [table, double]);
    if (await page.waitForSelector(".sg-overlay", { timeout: 2000 }).catch(() => null)) return;
  }
  throw new Error("session gate never opened after 6 dispatches");
};

try {
  // Warm-up: force the dev server to compile /menu BEFORE any timed scenario —
  // a cold first compile takes seconds and made the early checks flaky.
  {
    const w = await browser.newContext();
    const wp = await w.newPage();
    await wp.goto("http://localhost:4000/menu", { waitUntil: "domcontentloaded" });
    await wp.waitForSelector(".cat-group-head", { timeout: 60000 });
    await w.close();
  }

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
  await fireGate(page, TABLE);
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
  // wait until the status widget has actually polled and shows "connected" —
  // a fixed sleep raced the slower dev-page hydration and closed too early
  await p2.waitForSelector(".ssw-status, .ssw-bubble-dot", { timeout: 20000 });
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

  // ── 5. DOUBLE-TAP "Ask to join" must not create the same guest twice ───────
  sess = await newSession();
  await sb("POST", "session_members", { session_id: sess.id, name: null, token: tok("dh_"), role: "owner", approved: true });
  const ctx5 = await browser.newContext();
  const p5 = await ctx5.newPage();
  await p5.goto("http://localhost:4000/menu", { waitUntil: "domcontentloaded" });
  await p5.evaluate((t) => localStorage.setItem("lfh_table", t), TABLE);
  await fireGate(p5, TABLE);
  await p5.waitForSelector("text=already open", { timeout: 8000 }); // the "add your name" screen
  await p5.fill(".sg-input", "DoubleTap");
  // fire the tap TWICE in the same instant — the realistic nervous-thumb case
  await p5.evaluate(() => {
    const btn = [...document.querySelectorAll(".sg-btn")].find((b) => /ask to join/i.test(b.textContent));
    btn.click(); btn.click();
  });
  await p5.waitForTimeout(2500);
  const dupes = await sb("GET", `session_members?session_id=eq.${sess.id}&name=eq.DoubleTap&select=id`);
  check(dupes.length === 1, `double-tapped Ask-to-join creates exactly ONE membership (got ${dupes.length})`);
  await ctx5.close();
  await closeSession(sess.id);

  // ── 6. DOUBLE-FIRED connect on an EMPTY table must not create a ghost ──────
  sess = await newSession();
  const ctx6 = await browser.newContext();
  const p6 = await ctx6.newPage();
  await p6.goto("http://localhost:4000/menu", { waitUntil: "domcontentloaded" });
  await p6.evaluate((t) => localStorage.setItem("lfh_table", t), TABLE);
  // wait for the menu to render (React alive), then double-fire ONCE — the gate
  // closes itself quickly on this path, so we assert on the database below
  // rather than on the popup.
  await p6.waitForSelector(".cat-group-head", { timeout: 20000 });
  await p6.evaluate((t) => {
    const fire = () => window.dispatchEvent(new CustomEvent("lfh:session-do", { detail: { action: "connect", table: t, payload: {} } }));
    fire(); fire(); // two flows race; only one join may reach the database
  }, TABLE);
  await p6.waitForTimeout(3000);
  const m6 = await sb("GET", `session_members?session_id=eq.${sess.id}&removed=eq.false&select=id,role`);
  check(m6.length === 1 && m6[0].role === "owner", `double-fired connect on an empty table -> exactly one member, the head (got ${m6.length})`);
  await ctx6.close();
  await closeSession(sess.id);

  // ── 7. TWO TABS on one phone must not join the same table twice ────────────
  sess = await newSession();
  await sb("POST", "session_members", { session_id: sess.id, name: null, token: tok("th_"), role: "owner", approved: true });
  const ctx7 = await browser.newContext(); // one context = one phone (shared storage)
  const tabA = await ctx7.newPage();
  const tabB = await ctx7.newPage();
  for (const tab of [tabA, tabB]) {
    await tab.goto("http://localhost:4000/menu", { waitUntil: "domcontentloaded" });
    await tab.evaluate((t) => localStorage.setItem("lfh_table", t), TABLE);
    await fireGate(tab, TABLE);
    await tab.waitForSelector("text=already open", { timeout: 8000 });
  }
  // tab A joins for real…
  await tabA.fill(".sg-input", "TabPerson");
  await tabA.click("text=Ask to join this table");
  await tabA.waitForSelector("text=Waiting for the table", { timeout: 8000 });
  // …tab B (same phone, stale screen) tries too — it must REUSE tab A's session.
  await tabB.fill(".sg-input", "TabPerson");
  await tabB.click("text=Ask to join this table");
  await tabB.waitForSelector("text=Waiting for the table", { timeout: 8000 });
  const guests7 = await sb("GET", `session_members?session_id=eq.${sess.id}&role=eq.guest&removed=eq.false&select=id`);
  check(guests7.length === 1, `two tabs joining the same table create ONE membership, not two (got ${guests7.length})`);
  await ctx7.close();
  await closeSession(sess.id);

  // ── 8. a cart change in one tab must show up in the other tab's badge ──────
  const ctx8 = await browser.newContext();
  const pgA = await ctx8.newPage();
  const pgB = await ctx8.newPage();
  await pgA.goto("http://localhost:4000/menu", { waitUntil: "domcontentloaded" });
  await pgB.goto("http://localhost:4000/menu", { waitUntil: "domcontentloaded" });
  await pgB.waitForTimeout(1200);
  await pgA.evaluate(() => {
    localStorage.setItem("lfh_cart", JSON.stringify([{ id: "espresso", title: "Espresso", price: 120, qty: 2 }]));
  });
  await pgB.waitForTimeout(1500);
  const badge = await pgB.locator(".cart-badge").textContent().catch(() => null);
  check(badge === "2", `cart added in tab A shows on tab B's badge (got ${badge ?? "no badge"})`);
  await ctx8.close();

  // ── 9. a NETWORK BLIP must never cost a guest their table membership ───────
  sess = await newSession();
  const nTok = tok("nb_");
  const [nm] = await sb("POST", "session_members", { session_id: sess.id, name: "Blip Victim", token: nTok, role: "owner", approved: true });
  const ctx9 = await browser.newContext();
  const p9 = await ctx9.newPage();
  await p9.goto("http://localhost:4000/menu", { waitUntil: "domcontentloaded" });
  await p9.evaluate(([t, token, memberId]) => {
    localStorage.setItem("lfh_session", JSON.stringify({ table: t, token, memberId, role: "owner" }));
    localStorage.setItem("lfh_table", t);
  }, [TABLE, nTok, nm.id]);
  await p9.reload({ waitUntil: "domcontentloaded" });
  await p9.waitForSelector(".cat-group-head", { timeout: 20000 }); // page fully alive (menu rendered)
  await ctx9.setOffline(true); // the Wi-Fi dies…
  // dispatch + wait, retrying in case hydration finished a beat after render
  let sawTrouble = false;
  for (let i = 0; i < 5 && !sawTrouble; i++) {
    await p9.evaluate((t) => window.dispatchEvent(new CustomEvent("lfh:session-do", { detail: { action: "connect", table: t, payload: {} } })), TABLE);
    sawTrouble = !!(await p9.waitForSelector("text=Connection trouble", { timeout: 2500 }).catch(() => null));
  }
  check(sawTrouble, "offline tap opens the connection-trouble screen (not a silent dead button)");
  const keptSession = await p9.evaluate(() => !!localStorage.getItem("lfh_session"));
  check(keptSession, "offline guest KEEPS their membership (no longer thrown off the table)");
  await ctx9.setOffline(false); // …and comes back
  await p9.waitForTimeout(500);
  await p9.click(".sg-btn.gold"); // the Retry button (text= would match "retry" in the paragraph too)
  await p9.waitForSelector(".sg-overlay", { state: "detached", timeout: 8000 }); // connect succeeds, popup closes
  const members9 = await sb("GET", `session_members?session_id=eq.${sess.id}&removed=eq.false&select=id`);
  check(members9.length === 1, `after the blip there's still exactly ONE membership (got ${members9.length})`);
  await ctx9.close();
} finally {
  await browser.close();
  await cleanup();
}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : "\nALL EDGE-CASE CHECKS PASSED");
process.exit(failures ? 1 : 0);
