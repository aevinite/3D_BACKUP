// Three NEW families of error-hunting that the staff panels introduced
// (2026-06-13). The other three families have their own suites:
//   • table-lifecycle races        -> verify-edge-cases.mjs (checks 1-6)
//   • double-tap / two-tab         -> verify-edge-cases.mjs (checks 7-10)
//   • bad network / offline        -> verify-edge-cases.mjs (checks 11-13)
// This script adds:
//   FAMILY 4 — authorization / security: a guest's anon key must NOT reach
//              staff-only functions; pricing & sold-out can't be bypassed.
//   FAMILY 5 — staff-panel input validation: junk inputs to the tablet/editor
//              endpoints are rejected cleanly; KOT numbers stay unique under a
//              burst of concurrent orders.
//   FAMILY 6 — feature-flag & billing integrity: backend-only flags stay off &
//              invisible, malformed flag payloads are sanitised, discounts are
//              clamped and totals net out, feedback needs a real order.
// Reads secrets from .env.local; prints pass/fail only. Servers: 4000-4003.
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const env = Object.fromEntries(
  readFileSync(join(root, ".env.local"), "utf8").split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; })
);
const SB = env.NEXT_PUBLIC_SUPABASE_URL, SRK = env.SUPABASE_SERVICE_ROLE_KEY, ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!SB || !SRK || !ANON) { console.error("missing supabase env"); process.exit(1); }

let failures = 0;
const check = (ok, label) => { console.log(`${ok ? "✓" : "✗ FAIL"} ${label}`); if (!ok) failures++; };
const head = (t) => console.log(`\n— ${t} —`);

const sb = async (method, path, body) => {
  const r = await fetch(`${SB}/rest/v1/${path}`, {
    method, headers: { apikey: SRK, Authorization: `Bearer ${SRK}`, "Content-Type": "application/json", Prefer: "return=representation" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status} ${t.slice(0, 200)}`);
  return t ? JSON.parse(t) : null;
};
const rpc = async (key, fn, args) => {
  const r = await fetch(`${SB}/rest/v1/rpc/${fn}`, {
    method: "POST", headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
};
// Editor login (the editor may be unlocked locally; cookie stays "" then).
let cookie = "";
const editorLogin = async () => {
  if (!env.EDITOR_PASSWORD) return;
  const r = await fetch("http://localhost:4001/login", { method: "POST", redirect: "manual", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: `password=${encodeURIComponent(env.EDITOR_PASSWORD)}` });
  cookie = (r.headers.get("set-cookie") || "").split(";")[0];
};
const editor = async (method, path, body) => {
  const r = await fetch("http://localhost:4001/api" + path, { method, headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const tablet = async (method, path, body) => {
  const r = await fetch("http://localhost:4003/api" + path, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};

const TA = "21", TB = "22"; // quiet test tables
const cleanup = async () => {
  await sb("DELETE", `sessions?table_number=in.(${TA},${TB})`);
  await sb("DELETE", `orders?table_number=in.(${TA},${TB})`);
  await sb("DELETE", `requests?table_number=in.(${TA},${TB})`);
};

try {
  await editorLogin();
  await cleanup();

  // ─────────────────────────────────────────────────────────────────────────
  head("FAMILY 4 — authorization / security");
  // A guest's anon key must be blocked from every staff-only function.
  const a1 = await rpc(ANON, "lfh_staff_place_order", { p_table: TA, p_items: [{ id: "espresso", qty: 1 }], p_allergies: [], p_note: null });
  check(a1.status === 401 || a1.status === 403, `anon cannot place a staff order (HTTP ${a1.status})`);
  const a2 = await rpc(ANON, "lfh_staff_shift_table", { p_session: "00000000-0000-0000-0000-000000000000", p_to: TB });
  check(a2.status === 401 || a2.status === 403, `anon cannot shift a table (HTTP ${a2.status})`);
  const a3 = await rpc(ANON, "lfh_next_counter", { p_key: "kot" });
  check(a3.status === 401 || a3.status === 403, `anon cannot bump the KOT counter (HTTP ${a3.status})`);
  // Guests CAN price an order (read-only), but the price comes from the DB, not
  // from anything they send — a tampered price field is simply ignored.
  const priced = await rpc(ANON, "lfh_price_order", { p_items: [{ id: "espresso", qty: 1, price: "0.01" }] });
  const espresso = (await sb("GET", "menu_items?id=eq.espresso&select=price"))[0];
  const realUnit = Number(String(espresso.price).replace(/[^0-9.]/g, ""));
  check(priced.body && priced.body.ok && Number(priced.body.subtotal) >= realUnit - 0.01,
    `tampered price is ignored — server charges its own (₹${priced.body && priced.body.subtotal}, not ₹0.01)`);
  // Sold-out can't be ordered even if the client forces it through.
  await sb("PATCH", "menu_items?id=eq.the-oreo-shake", { tags: ["sold-out"] });
  const soldStaff = await rpc(SRK, "lfh_staff_place_order", { p_table: TA, p_items: [{ id: "the-oreo-shake", qty: 1 }], p_allergies: [], p_note: null });
  check(soldStaff.body && soldStaff.body.ok === false && soldStaff.body.reason === "sold_out", "sold-out dish is rejected by the server (even for staff)");
  await sb("PATCH", "menu_items?id=eq.the-oreo-shake", { tags: [] }); // restore

  // ─────────────────────────────────────────────────────────────────────────
  head("FAMILY 5 — staff-panel input validation");
  // The tablet's order endpoint must reject junk before it ever reaches the DB.
  const e1 = await tablet("POST", "/order", { table: "abc", items: [{ id: "espresso", qty: 1 }] });
  check(e1.status === 400, `tablet rejects a non-numeric table (HTTP ${e1.status})`);
  const e2 = await tablet("POST", "/order", { table: TA, items: [] });
  check(e2.status === 400, `tablet rejects an empty order (HTTP ${e2.status})`);
  const e3 = await tablet("POST", "/order", { table: TA, items: [{ id: "no-such-dish", qty: 1 }] });
  check(e3.body && e3.body.ok === false && e3.body.reason === "unknown_item", "tablet rejects an unknown dish id");
  // Shift validation: bad target, same table, occupied target.
  const [sA] = await sb("POST", "sessions", { table_number: TA, status: "open", opened_by: "waiter", opened_at: new Date().toISOString() });
  const shBad = await editor("POST", `/sessions/${sA.id}/shift`, { to: "xyz" });
  check(shBad.body && shBad.body.ok === false && shBad.body.reason === "bad_table", "shift rejects a non-numeric target table");
  const shSame = await editor("POST", `/sessions/${sA.id}/shift`, { to: TA });
  check(shSame.body && shSame.body.ok === false && shSame.body.reason === "same_table", "shift rejects moving to the same table");
  const [sB] = await sb("POST", "sessions", { table_number: TB, status: "open", opened_by: "waiter", opened_at: new Date().toISOString() });
  const shOcc = await editor("POST", `/sessions/${sA.id}/shift`, { to: TB });
  check(shOcc.body && shOcc.body.ok === false && shOcc.body.reason === "target_occupied", "shift rejects an already-occupied target");
  await sb("PATCH", `sessions?id=eq.${sB.id}`, { status: "closed" });
  // KOT numbers must stay UNIQUE under a burst of simultaneous orders.
  const burst = await Promise.all(Array.from({ length: 6 }, () =>
    rpc(SRK, "lfh_staff_place_order", { p_table: TA, p_items: [{ id: "espresso", qty: 1 }], p_allergies: [], p_note: null })));
  const kots = burst.map((b) => b.body && b.body.kot_no).filter((n) => n != null);
  check(kots.length === 6 && new Set(kots).size === 6, `6 simultaneous orders got 6 UNIQUE KOT numbers (${new Set(kots).size} distinct)`);

  // ─────────────────────────────────────────────────────────────────────────
  head("FAMILY 6 — feature-flag & billing integrity");
  // The four backend-only switches must be OFF by default in the live settings.
  const settings = (await sb("GET", "settings?id=eq.site&select=features"))[0];
  const f = settings.features || {};
  const backendOnly = ["verification", "payments", "aggregators", "gst_invoice"];
  check(backendOnly.every((k) => f[k] !== true), `all backend-only flags are off (${backendOnly.map((k) => k + "=" + (f[k] === true)).join(", ")})`);
  // Their RPCs refuse to act while the flag is off (the system "isn't there").
  const v = await rpc(ANON, "lfh_request_otp", { p_contact: "9876543210", p_channel: "sms" });
  check(v.body && v.body.ok === false && v.body.reason === "disabled", "verification RPC answers 'disabled' while its flag is off");
  // A malformed features payload through the editor is sanitised to a clean
  // boolean map (arrays/strings/nested junk dropped) — can't poison gating.
  const poison = await editor("POST", "/settings", { features: { ratings: false, junk: "yes", nested: { a: 1 }, arr: [1, 2], model3d: true } });
  const savedF = poison.body && poison.body.features;
  const onlyBools = savedF && Object.values(savedF).every((x) => typeof x === "boolean") && !("junk" in savedF) && !("nested" in savedF) && !("arr" in savedF);
  check(onlyBools, `malformed feature payload sanitised to booleans only (${JSON.stringify(savedF)})`);
  await editor("POST", "/settings", { features: {} }); // restore defaults
  // Discount is clamped to the order total and the editor reports the net.
  const [ord] = await sb("POST", "orders", { table_number: TA, items: [{ id: "espresso", title: "Espresso", qty: 1, price: "5.49" }], subtotal: 5.49, tax: 0.27, total: 5.76, status: "received" });
  const over = await editor("POST", `/orders/${ord.id}/discount`, { amount: 9999, note: "too much" });
  check(over.body && Number(over.body.discount) <= 5.76, `discount is clamped to the order total (asked 9999, got ${over.body && over.body.discount})`);
  // Feedback needs a REAL order id; a fake one is refused, a real one accepted.
  const fbFake = await rpc(ANON, "lfh_leave_feedback", { p_order: "00000000-0000-0000-0000-000000000000", p_rating: 5, p_comment: null, p_name: null });
  check(fbFake.body && fbFake.body.ok === false, "feedback for a non-existent order is refused");
  const fbReal = await rpc(ANON, "lfh_leave_feedback", { p_order: ord.id, p_rating: 4, p_comment: "nice", p_name: "Tester" });
  check(fbReal.body && fbReal.body.ok === true, "feedback for a real order is accepted (anon)");
  const badRating = await rpc(ANON, "lfh_leave_feedback", { p_order: ord.id, p_rating: 9, p_comment: null, p_name: null });
  check(badRating.body && badRating.body.ok === false && badRating.body.reason === "bad_rating", "feedback rejects an out-of-range rating");
} finally {
  await cleanup();
}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : "\nALL FAMILY 4-6 CHECKS PASSED");
process.exit(failures ? 1 : 0);
