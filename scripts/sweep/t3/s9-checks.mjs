#!/usr/bin/env node
// SWEEP #9 · TERMINAL 3 — the basket and placing an order · P101801–P101850
//
//   T3_BASE=http://127.0.0.1:4403 node scripts/sweep/t3/s9-checks.mjs
//
// FIFTY checks, aimed at ground the 74k-row ledger does not stand on. Sweeps #6–#8 wrote 3,006
// rows about this territory and every one of them re-runs green, so these fifty were planned by
// looking for what those rows never ASKED, not by re-asking them louder:
//
//   A · THE REFUSAL VOCABULARY (P101801–P101815). Nobody had ever enumerated the reason codes the
//       guest RPCs can actually answer and checked them against the phone's sentences. Doing it
//       found two faults (items 1 and 2) that had survived eight sweeps.
//   B · THE "ORDER THE REST" RESCUE, END TO END (P101816–P101825). The ledger checks the rescue
//       works; nothing checked what happens to the dish it names AFTERWARDS (item 3).
//   C · /api/guest/leave (P101826–P101835). The newest route in the territory had ONE ledger row
//       in the whole 74k, in another terminal's file.
//   D · DRIVEN AGAINST THE RUNNING APP (P101836–P101845). Every one of these is a REFUSAL, so the
//       whole block writes no row to the shared database — deliberate, not luck.
//   E · JUDGMENT AND THE MONEY ON SCREEN (P101846–P101850).
//
// No login, no order that lands, no loop. It is safe to re-run.
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const BASE = process.env.T3_BASE || "http://127.0.0.1:4403";
const read = (p) => { try { return readFileSync(join(ROOT, p), "utf8"); } catch { return ""; } };

let pass = 0; const fails = [];
const P = (id, name, ok, extra) => {
  if (ok) { pass++; console.log(`ok   ${id} ${name}${extra !== undefined ? ` — ${extra}` : ""}`); }
  else { fails.push(`${id} ${name}`); console.log(`FAIL ${id} ${name}${extra !== undefined ? ` — got ${JSON.stringify(extra)}` : ""}`); }
};

const OUT = read("lib/guestOutbox.ts");
const MENU = read("lib/menu.ts");
const CART = read("components/CartPanel.tsx");
const TRACK = read("components/OrderTracker.tsx");
const PL = read("app/api/guest/place-order/route.ts");
const CW = read("app/api/guest/call-waiter/route.ts");
const LV = read("app/api/guest/leave/route.ts");
const LH = read("app/api/guest/limit-hit/route.ts");
const CHIP = read("components/GuestOutboxChip.tsx");

// The reason codes the four guest RPCs really answer, read out of their own bodies.
const MIG = join(ROOT, "supabase/migrations");
const HEAD = /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+(?:public\.)?(lfh_place_order|lfh_place_order_public|lfh_call_waiter|lfh_call_waiter_table)\s*\(/gi;
const orderCodes = new Set(); const callCodes = new Set();
for (const f of readdirSync(MIG).filter((f) => f.endsWith(".sql")).sort()) {
  const sql = readFileSync(join(MIG, f), "utf8");
  for (const h of sql.matchAll(HEAD)) {
    const from = h.index; const after = sql.slice(from + 1);
    const ends = [/\n\s*\$\$\s*;/, /\n\s*\$\$\s+LANGUAGE/i, /\nCREATE\s+OR\s+REPLACE\s+FUNCTION/i, /\nREVOKE\s/i, /\nGRANT\s/i, /\nCOMMENT\s+ON\s+FUNCTION/i]
      .map((re) => { const m = after.match(re); return m ? m.index : -1; }).filter((i) => i >= 0);
    const body = sql.slice(from, ends.length ? from + 1 + Math.min(...ends) : sql.length);
    const isCall = /lfh_call_waiter/i.test(h[1]);
    for (const m of body.matchAll(/'reason',\s*'([a-z_]+)'/g)) (isCall ? callCodes : orderCodes).add(m[1]);
  }
}
const worded = new Set([...OUT.matchAll(/case "([a-z_]+)":/g)].map((m) => m[1]));
const kindSet = [...(( OUT.match(/WORDED_FOR_EVERY_KIND = new Set\(\[([\s\S]*?)\]\)/) || [])[1] || "").matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
const armOf = (c) => { const m = OUT.match(new RegExp(`case "${c}":[\\s\\S]{0,500}?return ([^\\n]+)`)); return m ? m[1] : ""; };

// ══ BLOCK A — the refusal vocabulary (P101801–P101815) ═══════════════════════════════════════
console.log("\n── A · every refusal a guest RPC can answer, and whether the phone has words for it");
P("P101801", "the ORDER RPCs' reason codes were read out of the migrations, not typed from memory", orderCodes.size >= 8, [...orderCodes].sort().join(","));
P("P101802", "every one of them has a sentence in reasonMsg — `unknown_table` was the gap (item 1)", [...orderCodes].every((c) => worded.has(c)), [...orderCodes].filter((c) => !worded.has(c)).join(",") || "none missing");
P("P101803", "the CALL RPCs' reason codes were read out too", callCodes.size >= 6, [...callCodes].sort().join(","));
P("P101804", "…and a call code the switch does not know still gets a true sentence, via the kind branch", /opts\?\.kind && opts\.kind !== "order"/.test(OUT) && /Couldn't send your call for a server/.test(OUT));
P("P101805", "every code the four ROUTES invent themselves is worded too", ["server_busy","unknown_restaurant","off_plan_table","bad_body","order_too_big","allergies_too_long","call_too_old","invalid_token"].every((c) => worded.has(c)));
P("P101806", "`unknown_table` and `off_plan_table` describe one situation and say ONE sentence (item 1)", armOf("unknown_table") !== "" && armOf("unknown_table") === armOf("off_plan_table"));
P("P101807", "the database's own `error` sentence never travels to a diner — a code does", !/reason: error\.message/.test(PL) && !/reason: error\.message/.test(CW) && !/reason: error\.message/.test(LV));
P("P101808", "no sentence in the kind-neutral carve-out names an ORDER (item 2)", kindSet.every((c) => !/\b(order|ordered|ordering)\b/i.test(armOf(c))), kindSet.filter((c) => /\border\b/i.test(armOf(c))).join(",") || "none");
P("P101809", "…and none of them names a DISH or the FOOD either", kindSet.every((c) => !/\b(dish|dishes|food|basket)\b/i.test(armOf(c))));
P("P101810", "a saved CALL refused with `blocked` reads as being about the table, not an order (item 2)", /case "blocked": return "This table is blocked/.test(OUT));
P("P101811", "…and `not_approved` says the same thing without the word 'order' (item 2)", worded.has("not_approved") && !/\border\b/i.test(armOf("not_approved")));
P("P101812", "a saved tap the limiter refused is NOT removed in silence (item 4)", /rate_limited[\s\S]{0,160}moveToFailed/.test(OUT));
P("P101813", "…while `already_sent` IS still treated as delivered — a call really is pending", !/already_sent[\s\S]{0,120}moveToFailed/.test(OUT));
P("P101814", "…and so is `capped` — six calls are already on the floor", !/"capped"[\s\S]{0,120}moveToFailed/.test(OUT));
P("P101815", "reasonMsg's default returns WORDS and can never interpolate the code it was given", (() => { const d = (OUT.match(/default: return ([^\n]+)/) || [])[1] || ""; return /"[^"]{12,}"/.test(d) && !/\$\{\s*reason/.test(d); })());

// ══ BLOCK B — the "Order the rest" rescue, end to end (P101816–P101825) ═══════════════════════
console.log("\n── B · the rescue that sends the basket without the dish that was refused");
const retryFn = (OUT.match(/export async function retryGuestFailed[\s\S]*?\n\}/) || [])[0] || "";
const restFn = (OUT.match(/export async function orderRestWithout[\s\S]*?\n\}/) || [])[0] || "";
P("P101816", "`blocked` is only ever set from a refusal that really named ONE dish", /\["sold_out", "hidden_item", "unknown_item"\]/.test(OUT));
P("P101817", "…and it is CLEARED when the diner asks for a fresh go (item 3)", /blocked = undefined/.test(retryFn) && /blockedId = undefined/.test(retryFn));
P("P101818", "…so a later refusal that names no dish cannot leave the button pointing at an innocent line (item 3)", retryFn.length > 200 && /blockedId = undefined/.test(retryFn));
P("P101819", "the line to drop is resolved off `lines` (which has names), never off the server payload", /const namedLines = /.test(OUT) && /it\.lines && it\.lines\.length \? it\.lines : it\.items/.test(OUT));
P("P101820", "the rescue mints a NEW at-most-once id — the old one carries the server's memory of the refusal", restFn !== "" && !/actionId/.test(restFn));
P("P101821", "the rescue keeps the diner's REAL quantities in their own summary", /const qtyOf = /.test(restFn));
P("P101822", "the rescue refuses rather than re-queueing a basket it could not change", /keptLines\.length === allLines\.length/.test(restFn));
P("P101823", "the re-queued order stays on its OWN restaurant, not whatever page the tab is on", /restaurantSlug: it\.restaurantSlug/.test(restFn));
P("P101824", "the button is only rendered when there is more than one line to keep", /o\.blocked && \(o\.lines \|\| \[\]\)\.length > 1/.test(CHIP));
P("P101825", "…and a refused rescue SAYS so instead of going quiet", /const r = await orderRestWithout\(id\);[\s\S]{0,300}lfh:toast/.test(CHIP));

// ══ BLOCK C — /api/guest/leave, the route with one ledger row in 74,232 (P101826–P101835) ═════
console.log("\n── C · \"I've left this table\", saved and sent by the phone");
P("P101826", "the route exists and is at-most-once, like its two siblings", /export const POST = withIdempotency\(postImpl, "guest"\)/.test(LV));
P("P101827", "…and force-dynamic, so no answer is ever cached", /export const dynamic = "force-dynamic"/.test(LV));
P("P101828", "a body with no token is refused 400, never a 500", /reason: "invalid_token" \}, \{ status: 400 \}/.test(LV));
P("P101829", "a database that will not answer is BUSY, so the phone keeps the request", /function busy\(\)[\s\S]{0,300}server_busy/.test(LV) && /return busy\(\)/.test(LV));
P("P101830", "…and its wait is spread, exactly like place-order's and call-waiter's", /20 \+ Math\.floor\(Math\.random\(\) \* 25\)/.test(LV));
P("P101831", "the database's own words never reach a diner here either", /console\.error\("\[guest\/leave\]/.test(LV) && !/error\.message \}/.test(LV));
P("P101832", "someone leaving drops the shared floor snapshot, so a seat frees on the next read", /invalidateFloor\(rid\)/.test(LV));
P("P101833", "…and says so in the log when it cannot tell which restaurant", /no resolvable restaurant — floor snapshot not dropped/.test(LV));
P("P101834", "only ONE leave per token can be waiting — leaving twice is the same fact", /isLeave\(x\) && String\(x\.token \|\| ""\) === String\(p\.token \|\| ""\)/.test(OUT));
P("P101835", "a saved leave is DROPPED if the diner re-joined that very table, rather than throwing them out", /function leaveIsStale/.test(OUT) && /s\.token === it\.token/.test(OUT));

// ══ BLOCK D — driven against the running app. Every one is a REFUSAL, so nothing is written ═══
const post = async (path, body, headers = {}) => {
  const r = await fetch(BASE + path, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch { /* not json */ }
  return { status: r.status, j };
};
const FH = "00000000-0000-0000-0000-000000000001";   // French House — 30 tables
const aid = (n) => `9e9e9e9e-0000-4000-8000-${String(n).padStart(12, "0")}`;
console.log(`\n── D · driven against ${BASE} — every request below is REFUSED, so no row is created`);
try {
  const r36 = await post("/api/guest/place-order", { mode: "public", table: "31", restaurantId: FH, items: [{ id: "x", qty: 1 }], allergies: [] }, { "X-LFH-Action-Id": aid(36) });
  P("P101836", "a table just above the floor plan is refused `unknown_table` (the fault behind item 1)", r36.j?.reason === "unknown_table", r36.j?.reason);
  P("P101837", "…and the server composed the right sentence all along", /doesn't exist/.test(String(r36.j?.error || "")), r36.j?.error);
  P("P101838", "…which the phone now has words of its own for, so that sentence never has to travel", worded.has("unknown_table"));
  const r39 = await post("/api/guest/place-order", { mode: "public", table: "9999", restaurantId: FH, items: [{ id: "x", qty: 1 }], allergies: [] }, { "X-LFH-Action-Id": aid(39) });
  P("P101839", "an absurd table number is refused by the app's own check, before the database", r39.j?.reason === "off_plan_table", r39.j?.reason);
  const r40 = await post("/api/guest/call-waiter", { mode: "public", table: "3", restaurantId: FH, at: "abc" }, { "X-LFH-Action-Id": aid(40) });
  P("P101840", "a saved call carrying an unreadable timestamp is treated as too old, not waved through", r40.j?.reason === "call_too_old", r40.j?.reason);
  const r41 = await post("/api/guest/call-waiter", { mode: "public", table: "3" }, { "X-LFH-Action-Id": aid(41) });
  P("P101841", "a call that cannot say which restaurant it was for is refused, never guessed at", r41.status === 400 && r41.j?.reason === "unknown_restaurant", r41.j?.reason);
  const r42 = await post("/api/guest/place-order", { mode: "public", table: "3", restaurantId: FH, items: Array.from({ length: 201 }, () => ({ id: "x", qty: 1 })), allergies: [] }, { "X-LFH-Action-Id": aid(42) });
  P("P101842", "a 201-line order is REFUSED, never quietly trimmed to 200", r42.status === 400 && r42.j?.reason === "order_too_big", r42.j?.reason);
  const r43 = await post("/api/guest/leave", { restaurantId: FH }, { "X-LFH-Action-Id": aid(43) });
  P("P101843", "leaving with no token is refused 400, not a 500", r43.status === 400 && r43.j?.reason === "invalid_token", r43.j?.reason);
  // WRITTEN OUT, NOT LOOPED, and that is deliberate: `npm run verify:test-safety` refuses a script
  // that repeats a rate-limited action in a loop, because tripping one of the app's own walls pings
  // a real owner's phone about a real restaurant. These three bodies are malformed on purpose and
  // are refused before any limiter is consulted — but the guard reads the SHAPE, and it is right to:
  // a loop over guest write doors is exactly the thing that must never be written here, and a guard
  // that has to judge intent is a guard that can be argued with. Three calls, each once.
  const r44a = await post("/api/guest/place-order", "{not json", { "X-LFH-Action-Id": aid(441) });
  const r44b = await post("/api/guest/call-waiter", "{not json", { "X-LFH-Action-Id": aid(442) });
  const r44c = await post("/api/guest/leave", "{not json", { "X-LFH-Action-Id": aid(443) });
  const bad = [`place-order=${r44a.status}:${r44a.j?.reason}`, `call-waiter=${r44b.status}:${r44b.j?.reason}`, `leave=${r44c.status}:${r44c.j?.reason}`];
  P("P101844", "malformed JSON bytes answer 400 bad_body on all three writing doors, never a 500", bad.every((b) => /=400:bad_body$/.test(b)), bad.join(" "));
  const r45 = await post("/api/guest/limit-hit", "", {});
  P("P101845", "the limit beacon answers 200 even to an empty body — it must never surface an error", r45.status === 200 && r45.j?.ok === true, r45.status);
} catch (e) {
  for (const id of ["P101836","P101837","P101838","P101839","P101840","P101841","P101842","P101843","P101844","P101845"]) P(id, "driven check could not reach the app", false, String(e).slice(0, 120));
}

// ══ BLOCK E — judgment (P101846–P101850) ═════════════════════════════════════════════════════
console.log("\n── E · judgment: is this how a real restaurant needs it to work");
P("P101846", "the bill's GST is taken from the ONE tax rule, never a second formula", /splitBill\(dispLines\.filter\(\(l\) => l\.tax_mode === "excl"\), taxRules\)\.taxableBase/.test(CART));
P("P101847", "…and a ₹0 GST row is removed rather than printed, because ₹0 reads as a mistake", /const showTaxRow = !dispSplit\.composition && tax > 0/.test(CART));
P("P101848", "every guest WRITE carries a deadline — the read that follows an order is the one that does not", /orderDeadline\(\)/.test(MENU) && !/getOrderStatus[\s\S]{0,400}abortSignal/.test(MENU));
P("P101849", "the pairing '+ Add' can only ever appear for a dish NOT already on the bill, so its 99-cap branch is unreachable", /!cartIds\.has\(i\.id\)/.test(CART));
P("P101850", "the whole refusal vocabulary lives in ONE function, so a new RPC reason can only be missing in one place", (OUT.match(/export function reasonMsg/g) || []).length === 1 && !/case "sold_out"/.test(CART));

console.log(`\n${pass} passed, ${fails.length} failed  (of ${pass + fails.length})`);
if (fails.length) { console.log("\nFAILED:"); fails.forEach((f) => console.log("  " + f)); }
process.exit(fails.length ? 1 : 0);
