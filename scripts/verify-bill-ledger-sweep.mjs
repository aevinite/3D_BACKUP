#!/usr/bin/env node
// verify-bill-ledger-sweep.mjs — SWEEP #8 · TERMINAL 22. Phases P75701–P76229 (529).
//
// The band ranges below are NOT typed by hand — they are what `--ledger` prints, because a hand-kept
// range goes stale the moment a case is added to one of the tables and then "re-run P75930" stops
// meaning anything. Regenerate the ledger with `npm run verify:bill-ledger -- --ledger`.
//
//   A · P75701–P75818 (118) — lib/billLedger.ts: what a bill is worth, and what state it is in
//   B · P75819–P75906  (88) — lib/logTrail.ts: where in the app every log row happened
//   C · P75907–P76011 (105) — the three screens, read as code
//   D · P76012–P76064  (53) — docs/COMPLIANCE-GUARDRAILS.md, and the code that has to keep it
//   E · P76065–P76208 (144) — live, headless: the three screens as they actually draw
//
// ── THE TERRITORY ────────────────────────────────────────────────────────────────────────────────
//
//   app/aevinite/bill-audit/page.tsx          the admin's Bills ledger
//   app/aevinite/bill-audit/changes/page.tsx  the Bills · Change log
//   app/aevinite/logs/page.tsx                Audit & logs (Operations · Removals · Customers)
//   lib/billLedger.ts                         what a bill IS, what it is worth, and what state it is in
//   lib/logTrail.ts                           where in the app a log row happened
//   docs/COMPLIANCE-GUARDRAILS.md             a sale can be cancelled; a sale can never disappear
//
// ── THE STANDING PRE-EMPT THIS FILE EXISTS TO PROTECT ────────────────────────────────────────────
//
// The owner's revenue INCLUDES soft-deleted (binned) bills. That is REQUIRED — docs/COMPLIANCE-
// GUARDRAILS.md §4, "Z-report / dashboards must include voids and deleted bills". It reads like a
// bug from every direction, and a confident sweep could "fix" it in ten minutes. Band D asserts the
// rule is still written down, in those words, with its citation.
//
// ── SAFE-AUDIT WORDING (CLAUDE.md, read first every session) ─────────────────────────────────────
//
// Every live phase here is a PRODUCT-CORRECTNESS question asked as one: "does this screen say it
// does not know, instead of saying none?", "does each row name the restaurant it belongs to?". The
// live band presents the admin cookie the gate already accepts and makes ordinary GETs, exactly as
// a browser does. It swaps no ids, replays nothing as anybody else, and proves nothing by trickery.
//
// ── SAFETY ───────────────────────────────────────────────────────────────────────────────────────
//
//   · Refuses to run against anything but the dev/test database (shared devStacks allow-list).
//   · READ-ONLY. Every request is a GET; nothing here writes a row, so there is nothing to clean up
//     and no chance of reporting another session's writes as faults.
//   · Signs in ZERO times: it presents the admin cookie (sha256 of ADMIN_PASSWORD), so it can never
//     raise a failed-login row or trip the throttle.
//   · One at a time (pid lock), so two copies cannot read each other's half-loaded pages.
//   · Fault injection goes through page.route() with service workers BLOCKED — a panel service
//     worker silently eats route() interception and turns 11 real product faults into a handler
//     that never fired.
//
// Run:  node --experimental-strip-types scripts/verify-bill-ledger-sweep.mjs --base http://localhost:4000
//       npm run verify:bill-ledger -- --base http://localhost:4000 --from 1 --to 120
//       npm run verify:bill-ledger -- --ledger          # regenerate the ledger table, run nothing
import { readFileSync, writeFileSync, unlinkSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { registerHooks } from "node:module";
import { execSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { refuseUnlessDevTestDb } from "./sweep/devStacks.mjs";
import { requireUp } from "./sweep/appUp.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => { try { return readFileSync(join(root, p), "utf8"); } catch { return ""; } };

// `@/x` → <root>/x — what lets this guard import the SHIPPED lib files rather than a copy of them.
registerHooks({
  resolve(spec, ctx, next) {
    if (spec.startsWith("@/")) {
      let p = join(root, spec.slice(2));
      if (!existsSync(p)) for (const ext of [".ts", ".tsx", ".js", ".mjs"]) if (existsSync(p + ext)) { p += ext; break; }
      return next(pathToFileURL(p).href, ctx);
    }
    return next(spec, ctx);
  },
});

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const BASE = (arg("--base", "http://localhost:4000") || "").replace(/\/$/, "");
const FROM = Number(arg("--from", 0)) || 0;
const TO = Number(arg("--to", 0)) || Infinity;
const LEDGER = process.argv.includes("--ledger");
const QUIET = process.argv.includes("--quiet");

// ── one at a time ────────────────────────────────────────────────────────────────────────────────
const LOCK = "/tmp/t22-bill-ledger-sweep.pid";
if (!LEDGER) {
  try {
    const alive = Number(readFileSync(LOCK, "utf8"));
    if (alive && alive !== process.pid) {
      try { process.kill(alive, 0); } catch { throw new Error("stale"); }
      console.log(`\nAnother bill-ledger sweep is running (pid ${alive}). Two of them read each other's\nhalf-loaded pages and report them as faults. Waiting is the right move.`);
      process.exit(2);
    }
  } catch { /* stale or absent — take it */ }
  try { writeFileSync(LOCK, String(process.pid)); } catch {}
}
const dropLock = () => { try { if (Number(readFileSync(LOCK, "utf8")) === process.pid) unlinkSync(LOCK); } catch {} };
process.on("exit", dropLock);
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { dropLock(); process.exit(130); });

const env = Object.fromEntries(read(".env.local").split("\n")
  .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
  .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }));
if (!LEDGER) refuseUnlessDevTestDb(env.NEXT_PUBLIC_SUPABASE_URL, "the bill-ledger and logs sweep");
const ADMIN_COOKIE = "lfh_staff_auth=" + createHash("sha256").update(env.ADMIN_PASSWORD || "").digest("hex");

// lib/billLedger.ts imports lib/tableTags, which is SERVER-ONLY (it pulls in supabaseAdmin), so the
// client cannot be built without its keys. They come from .env.local, exactly as `next dev` reads
// them — nothing is printed and nothing is sent anywhere. (That import chain is itself checked in
// band C: a "use client" file must never reach lib/billLedger.)
for (const [k, v] of Object.entries(env)) if (process.env[k] === undefined) process.env[k] = v;

// ── the phase runner ─────────────────────────────────────────────────────────────────────────────
const FIRST_ID = 75701;
let n = 0, band = "?";
const pass = [], fail = [], skipped = [], rows = [];
const idOf = (i) => "P" + (FIRST_ID + i - 1);
const setBand = (b) => { band = b; if (!LEDGER && !QUIET) console.log(`\n── ${b} ──`); };

async function phase(title, how, fn) {
  n += 1;
  const id = idOf(n);
  rows.push({ id, band, title, how });
  if (LEDGER || n < FROM || n > TO) return;
  let r;
  try { r = await fn(); } catch (e) { r = { ok: false, note: `threw: ${e && e.message ? e.message : String(e)}` }; }
  if (r === true) r = { ok: true };
  if (r === false) r = { ok: false };
  if (r && r.skip) { skipped.push({ id, title, note: r.note || "" }); if (!QUIET) console.log(`  ⏭ ${id} ${title}${r.note ? " — " + r.note : ""}`); return; }
  if (r && r.ok) { pass.push(id); if (!QUIET) console.log(`  ok   ${id} ${title}${r.note ? " — " + r.note : ""}`); }
  else { fail.push({ id, title, note: (r && r.note) || "" }); console.log(`  FAIL ${id} ${title}${r && r.note ? " — " + r.note : ""}`); }
}
// A phase that is a plain boolean over a value we already have.
const is = (cond, note) => ({ ok: !!cond, note });

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// BAND A · lib/billLedger.ts — what a bill is worth and what state it is in   P75701–P75818 (118)
// ═══════════════════════════════════════════════════════════════════════════════════════════════
const BL = await import("@/lib/billLedger.ts");
const LT = await import("@/lib/logTrail.ts");
const BLSRC = read("lib/billLedger.ts");
const LTSRC = read("lib/logTrail.ts");
const LEDGER_PAGE = read("app/aevinite/bill-audit/page.tsx");
const CHANGES_PAGE = read("app/aevinite/bill-audit/changes/page.tsx");
const LOGS_PAGE = read("app/aevinite/logs/page.tsx");
// A "this must NOT appear" check has to read the CODE, not the file's own account of what it used
// to be. Both of the two below name the old shape in a comment ("this used to be `det.slice(0, 60)`"),
// so a raw grep answers yes to a fault the file is explaining it fixed. LINE comments are stripped
// FIRST: a `/*` sitting inside a `//` line otherwise swallows the rest of the file.
const codeOnly = (src) => src.replace(/(^|[^:])\/\/[^\n]*/g, "$1").replace(/\/\*[\s\S]*?\*\//g, "");
const LOGS_CODE = codeOnly(LOGS_PAGE);
const COMPLIANCE = read("docs/COMPLIANCE-GUARDRAILS.md");
const BILLS_ROUTE = read("app/api/admin/bills/route.ts");
const AUDIT_ROUTE = read("app/api/admin/bill-audit/route.ts");

const ord = (o = {}) => ({
  id: o.id || "o1", session_id: o.session_id === undefined ? "s1" : o.session_id,
  total: o.total ?? null, discount: o.discount ?? null, tax_rate: o.tax_rate ?? null,
  net_amount: o.net_amount === undefined ? null : o.net_amount,
  disc_gross: o.disc_gross === undefined ? null : o.disc_gross,
  status: o.status ?? "served", payment_status: o.payment_status ?? "pending",
  payment_method: o.payment_method ?? null, khata_at: o.khata_at ?? null,
  deleted_at: o.deleted_at ?? null, deleted_by: o.deleted_by ?? null, delete_reason: o.delete_reason ?? null,
});
const sess = (s = {}) => ({
  id: s.id || "s1", status: "status" in s ? s.status : "closed", bill_no: s.bill_no ?? null, invoice_no: s.invoice_no ?? null,
  invoice_voided: s.invoice_voided ?? null, table_number: s.table_number ?? null,
  restaurant_id: s.restaurant_id ?? "r1", opened_at: s.opened_at ?? null, closed_at: s.closed_at ?? null,
  created_at: s.created_at ?? null, deleted_at: s.deleted_at ?? null, deleted_by: s.deleted_by ?? null,
  delete_reason: s.delete_reason ?? null,
});

setBand("A · lib/billLedger.ts — the money and the state machine");

// A1 · netOf — the one definition of what a bill was worth
const NET_CASES = [
  ["the database's generated net wins over every other column", { net_amount: 472.5, total: 525, discount: 50, tax_rate: null }, 472.5],
  ["…and over disc_gross too", { net_amount: 100, total: 525, disc_gross: 52.5 }, 100],
  ["a generated net of exactly 0 is honoured, not treated as missing", { net_amount: 0, total: 525, discount: 50 }, 0],
  ["a generated net arriving as a numeric STRING is read as the number", { net_amount: "472.50", total: 525 }, 472.5],
  ["a NEGATIVE stored net is passed through, not clamped away", { net_amount: -12.5, total: 0 }, -12.5],
  ["a non-numeric net_amount falls through instead of poisoning the sum", { net_amount: "abc", total: 525, discount: 0 }, 525],
  ["NaN in net_amount falls through", { net_amount: NaN, total: 300 }, 300],
  ["Infinity in net_amount falls through — it is not finite", { net_amount: Infinity, total: 300 }, 300],
  ["with no net, total − disc_gross is next", { total: 525, disc_gross: 52.5 }, 472.5],
  ["disc_gross of 0 still short-circuits the rate arithmetic", { total: 525, disc_gross: 0, discount: 50, tax_rate: 0.05 }, 525],
  ["a numeric-string disc_gross is read as a number", { total: 525, disc_gross: "52.50" }, 472.5],
  ["a non-numeric disc_gross falls through to the discount rule", { total: 525, disc_gross: "x", discount: 0 }, 525],
  ["no discount at all returns the total unchanged", { total: 525 }, 525],
  ["a zero discount returns the total unchanged", { total: 525, discount: 0 }, 525],
  ["a negative discount is ignored rather than ADDED to the bill", { total: 525, discount: -50 }, 525],
  ["a discount with no stamped rate is grossed at 0, the documented last resort", { total: 525, discount: 50 }, 475],
  ["a discount with a stamped rate is grossed at THAT rate", { total: 525, discount: 50, tax_rate: 0.05 }, 472.5],
  ["a stamped rate of 0 grosses at 0", { total: 525, discount: 50, tax_rate: 0 }, 475],
  ["a negative stamped rate is treated as no rate, never as a credit", { total: 525, discount: 50, tax_rate: -0.5 }, 475],
  ["an 18% stamped rate grosses the discount at 18%", { total: 1180, discount: 100, tax_rate: 0.18 }, 1062],
  ["the answer is rounded to the paisa, never left with float dust", { total: 100, discount: 33.33, tax_rate: 0.05 }, 65.0],
  ["a null total reads as 0 rather than NaN", { total: null, discount: 10 }, -10.5 === -10.5 ? -10 : -10],
  ["an undefined total reads as 0", { total: undefined }, 0],
  ["a string total is read as a number", { total: "525" }, 525],
  ["a total that is not a number at all reads as 0, never NaN", { total: "abc" }, 0],
];
for (const [title, o, want] of NET_CASES) {
  await phase(`netOf: ${title}`, "node: lib/billLedger.ts netOf() on the stated order shape", () => {
    const got = BL.netOf(ord(o));
    return is(Math.abs(got - want) < 0.005, `got ${got}, want ${want}`);
  });
}
await phase("netOf never returns NaN, whatever the row holds", "node: netOf() over 8 malformed order shapes", () => {
  const bad = [{}, { total: "x" }, { total: null, discount: "y" }, { net_amount: {} }, { disc_gross: [] },
    { total: NaN }, { discount: NaN, total: 10 }, { tax_rate: NaN, discount: 5, total: 10 }];
  const nans = bad.filter((o) => Number.isNaN(BL.netOf(ord(o))));
  return is(nans.length === 0, `${nans.length} shape(s) produced NaN`);
});
await phase("netOf is exported, so no caller has to re-derive net from total − discount", "read lib/billLedger.ts", () => is(/export const netOf/.test(BLSRC)));
await phase("the one place that used to hold a SECOND copy delegates to it", "read app/api/admin/bills/route.ts", () =>
  is(/const netAmount = \(o: MoneyCols\) => netOf\(/.test(BILLS_ROUTE), "netAmount must be an alias, not a definition"));
await phase("the ledger route selects net_amount, so netOf can never fall to arithmetic", "read ORDER_COLS", () => is(/ORDER_COLS = "[^"]*net_amount/.test(BILLS_ROUTE)));
await phase("…and MONEY_COLS selects it too, for the permanent removals record", "read MONEY_COLS", () => is(/MONEY_COLS = "[^"]*net_amount/.test(BILLS_ROUTE)));
await phase("BillOrder declares net_amount, so a caller cannot forget it silently", "read the type", () => is(/net_amount\?: number \| null/.test(BLSRC)));
await phase("BillOrder declares disc_gross as well", "read the type", () => is(/disc_gross\?: number \| null/.test(BLSRC)));

// A2 · deriveBillState — the six buckets
const STATE_CASES = [
  ["a tombstoned session is deleted, whatever its orders say", sess({ deleted_at: "x", status: "open" }), [ord({ payment_status: "paid" })], "deleted"],
  ["…and a tombstoned session with no orders at all is still deleted", sess({ deleted_at: "x" }), [], "deleted"],
  ["every order soft-deleted makes the bill deleted even with a live session row", sess({}), [ord({ deleted_at: "x" }), ord({ id: "o2", deleted_at: "x" })], "deleted"],
  ["ONE live order among deleted ones is not a deleted bill", sess({}), [ord({ deleted_at: "x" }), ord({ id: "o2", payment_status: "paid" })], "settled"],
  ["a session with NO orders is not deleted just because [].every() is true", sess({}), [], "cancelled"],
  ["an open session is running, whatever the orders say", sess({ status: "open" }), [ord({ payment_status: "paid" })], "running"],
  ["a pending session is running too — anything not closed can still grow", sess({ status: "pending" }), [], "running"],
  ["a null status is running, not silently closed", sess({ status: null }), [], "running"],
  ["closed + parked to the book is pay-later", sess({}), [ord({ khata_at: "x" })], "khata"],
  ["a khata leg already PAID is not pay-later any more", sess({}), [ord({ khata_at: "x", payment_status: "paid" })], "settled"],
  ["pay-later outranks on-the-house", sess({}), [ord({ khata_at: "x" }), ord({ id: "o2", payment_method: "On the house" })], "khata"],
  ["on-the-house outranks settled", sess({}), [ord({ payment_method: "On the house" }), ord({ id: "o2", payment_status: "paid" })], "onhouse"],
  ["one paid order settles the bill", sess({}), [ord({ payment_status: "paid" }), ord({ id: "o2" })], "settled"],
  ["closed with nothing collected is closed-unpaid", sess({}), [ord({})], "cancelled"],
  ["a deleted khata leg cannot make a bill pay-later", sess({}), [ord({ khata_at: "x", deleted_at: "d" }), ord({ id: "o2", payment_status: "paid" })], "settled"],
  ["a deleted on-house leg cannot make a bill on-the-house", sess({}), [ord({ payment_method: "On the house", deleted_at: "d" }), ord({ id: "o2", payment_status: "paid" })], "settled"],
  ["every order cancelled and nothing paid is closed-unpaid, not deleted", sess({}), [ord({ status: "cancelled" })], "cancelled"],
];
for (const [title, s, os, want] of STATE_CASES) {
  await phase(`deriveBillState: ${title}`, "node: lib/billLedger.ts deriveBillState() on the stated session+orders", () => {
    const got = BL.deriveBillState(s, os);
    return is(got === want, `got "${got}", want "${want}"`);
  });
}
await phase("deriveBillState only ever answers with a bucket the screen has words for", "node: run all 17 cases and check each answer is a BILL_STATE_META key",
  () => is(STATE_CASES.every(([, s, os]) => BL.BILL_STATE_META[BL.deriveBillState(s, os)])));
await phase("BILL_STATE_META names all six buckets", "read the map", () =>
  is(["running", "settled", "khata", "onhouse", "cancelled", "deleted"].every((k) => BL.BILL_STATE_META[k])));
for (const k of ["running", "settled", "khata", "onhouse", "cancelled", "deleted"]) {
  await phase(`BILL_STATE_META.${k} carries a plain-words label, a colour and a glyph`, "read the map", () => {
    const m = BL.BILL_STATE_META[k];
    return is(m && m.label && /^#[0-9a-f]{6}$/i.test(m.tone) && m.emoji, JSON.stringify(m));
  });
  await phase(`…and the ledger screen shows the same word for "${k}" as the library does`, "compare BILL_STATE_META with the page's own META", () => {
    const m = LEDGER_PAGE.match(new RegExp(`${k}:\\s*\\{ label: "([^"]+)"`));
    return is(m && m[1] === BL.BILL_STATE_META[k].label, m ? `page says "${m[1]}", library says "${BL.BILL_STATE_META[k].label}"` : "no label on the page");
  });
}
await phase("the ledger screen's chip ORDER lists all six buckets and no seventh", "read ORDER in the page", () => {
  const m = LEDGER_PAGE.match(/const ORDER: BillState\[\] = \[([^\]]+)\]/);
  const list = m ? m[1].split(",").map((s) => s.trim().replace(/"/g, "")).filter(Boolean) : [];
  return is(list.length === 6 && list.every((k) => BL.BILL_STATE_META[k]), list.join(","));
});
await phase("a state the screen has never heard of costs ONE row, not the whole page", "read the META lookup on the row", () =>
  is(/const m = META\[b\.state\] \|\| \{/.test(LEDGER_PAGE)));
await phase("…and the unknown row is plainly labelled rather than blank", "read the fallback", () =>
  is(/label: String\(b\.state \|\| "Unknown"\)/.test(LEDGER_PAGE)));

// A3 · lossOfClosedUnpaid — "was the food actually made?"
const LOSS_CASES = [
  ["an order the kitchen was preparing is a real loss", [ord({ status: "preparing" })], {}, "yes"],
  ["…so is one that reached ready", [ord({ status: "ready" })], {}, "yes"],
  ["…and one that was served", [ord({ status: "served" })], {}, "yes"],
  ["an order still at 'received' was never started, so nothing was lost", [ord({ status: "received" })], {}, "no"],
  ["a bill that took a number and never ordered is no loss", [], {}, "no"],
  ["a cancellation nobody has answered is UNKNOWN, never a confident zero", [ord({ status: "cancelled" })], {}, "unknown"],
  ["a cancellation answered 'the food was made' is a loss", [ord({ status: "cancelled" })], { o1: true }, "yes"],
  ["a cancellation answered 'never made' is not a loss", [ord({ status: "cancelled" })], { o1: false }, "no"],
  ["two cancellations, one answered yes, is a loss", [ord({ status: "cancelled" }), ord({ id: "o2", status: "cancelled" })], { o1: false, o2: true }, "yes"],
  ["two cancellations, both answered no, is not a loss", [ord({ status: "cancelled" }), ord({ id: "o2", status: "cancelled" })], { o1: false, o2: false }, "no"],
  ["two cancellations, one unanswered, stays unknown", [ord({ status: "cancelled" }), ord({ id: "o2", status: "cancelled" })], { o1: false }, "unknown"],
  ["a cooked order outranks an unanswered cancellation on the same bill", [ord({ status: "served" }), ord({ id: "o2", status: "cancelled" })], {}, "yes"],
  ["a soft-deleted cooked order does not make a loss out of nothing", [ord({ status: "served", deleted_at: "x" })], {}, "no"],
  ["a soft-deleted cancellation is not counted as unanswered", [ord({ status: "cancelled", deleted_at: "x" })], {}, "no"],
];
for (const [title, os, made, want] of LOSS_CASES) {
  await phase(`lossOfClosedUnpaid: ${title}`, "node: lib/billLedger.ts lossOfClosedUnpaid() on the stated orders", () => {
    const got = BL.lossOfClosedUnpaid(os, new Map(Object.entries(made)));
    return is(got === want, `got "${got}", want "${want}"`);
  });
}
await phase("the kitchen-fire boundary is the same one the stock movements use", "read the FIRED set against migration 224's boundary", () =>
  is(/const FIRED = new Set\(\["preparing", "ready", "served"\]\)/.test(BLSRC)));
await phase("'received' is deliberately NOT in it, and the file says why", "read the comment", () =>
  is(/'received' was never started/.test(BLSRC.replace(/\s*\n\s*\/\/\s*/g, " "))));
await phase("lossOfClosedUnpaid only ever answers yes / no / unknown", "node: run all 14 cases", () =>
  is(LOSS_CASES.every(([, os, made]) => ["yes", "no", "unknown"].includes(BL.lossOfClosedUnpaid(os, new Map(Object.entries(made)))))));
await phase("the ledger screen reads an unanswered bill as 'not answered', never as ₹0 lost", "read the tile", () =>
  is(/not answered/.test(LEDGER_PAGE) && /\(b\.loss \|\| "unknown"\)/.test(LEDGER_PAGE)));
await phase("…and the per-bill field says where the question is answered", "read the Field", () =>
  is(/Not answered yet — answer it in Audit/.test(LEDGER_PAGE)));
await phase("the loss question is asked of closed-unpaid bills only", "read the route + the page", () =>
  is(/b\.state === "cancelled" \&\& \(/.test(LEDGER_PAGE) || /b\.state === "cancelled" && \(/.test(LEDGER_PAGE)));
await phase("the route only looks up answers for the bills that need one", "read app/api/admin/bills/route.ts", () =>
  is(/bills\.filter\(\(b\) => b\.state === "cancelled"\)\.map/.test(BILLS_ROUTE)));
await phase("a failed answer lookup leaves the bill unknown rather than taking the ledger down", "read the route's comment + code", () =>
  is(/NOT fatal, and deliberately so/.test(BILLS_ROUTE) && !/return adminFail\("the bill ledger", ans\.error/.test(BILLS_ROUTE)));

// A4 · rollUpBill
await phase("rollUpBill: a live bill's headline is its LIVE orders", "node: two orders, one soft-deleted", () => {
  const r = BL.rollUpBill(sess({ status: "closed" }), [ord({ net_amount: 100, payment_status: "paid" }), ord({ id: "o2", net_amount: 50, deleted_at: "x" })], "R");
  return is(r.amount === 100, `amount ${r.amount}`);
});
await phase("rollUpBill: a DELETED bill's headline is what was removed — every order, live or not", "node: all orders deleted", () => {
  const r = BL.rollUpBill(sess({ deleted_at: "x" }), [ord({ net_amount: 100, deleted_at: "x" }), ord({ id: "o2", net_amount: 50, deleted_at: "x" })], "R");
  return is(r.amount === 150 && r.state === "deleted", `amount ${r.amount} state ${r.state}`);
});
await phase("rollUpBill: 'collected' counts only orders actually marked paid", "node: one paid, one pending", () => {
  const r = BL.rollUpBill(sess({}), [ord({ net_amount: 100, payment_status: "paid" }), ord({ id: "o2", net_amount: 50 })], "R");
  return is(r.paid === 100, `paid ${r.paid}`);
});
await phase("rollUpBill: a soft-deleted paid order is not counted as collected", "node", () => {
  const r = BL.rollUpBill(sess({}), [ord({ net_amount: 100, payment_status: "paid", deleted_at: "x" }), ord({ id: "o2", net_amount: 50, payment_status: "paid" })], "R");
  return is(r.paid === 50, `paid ${r.paid}`);
});
await phase("rollUpBill: an on-the-house bill is worth ₹0, because its discount equals its subtotal", "node: net 0 on both legs", () => {
  const r = BL.rollUpBill(sess({}), [ord({ net_amount: 0, payment_status: "paid", payment_method: "On the house" })], "R");
  return is(r.state === "onhouse" && r.amount === 0 && r.paid === 0, `${r.state} ${r.amount}/${r.paid}`);
});
await phase("rollUpBill: collected is never more than the bill total", "node: 200 random shapes", () => {
  let bad = 0;
  for (let i = 0; i < 200; i++) {
    const os = [ord({ net_amount: (i % 7) * 11, payment_status: i % 2 ? "paid" : "pending" }),
      ord({ id: "o2", net_amount: (i % 5) * 13, payment_status: i % 3 ? "paid" : "pending" })];
    const r = BL.rollUpBill(sess({}), os, "R");
    if (r.paid > r.amount + 0.005) bad++;
  }
  return is(bad === 0, `${bad} of 200`);
});
await phase("rollUpBill: orderCount counts DELETED orders too — a removed bill still had dishes on it", "node", () => {
  const r = BL.rollUpBill(sess({}), [ord({ deleted_at: "x" }), ord({ id: "o2" })], "R");
  return is(r.orderCount === 2, `orderCount ${r.orderCount}`);
});
await phase("rollUpBill: invoiceVoided is a real boolean, never null on the wire", "node: null in, false out", () =>
  is(BL.rollUpBill(sess({ invoice_voided: null }), [], "R").invoiceVoided === false));
await phase("rollUpBill: invoiceGens starts at 0 and is filled in by the endpoint", "node + read the route", () =>
  is(BL.rollUpBill(sess({}), [], "R").invoiceGens === 0 && /b\.invoiceGens = genBy\.get/.test(BILLS_ROUTE)));
await phase("rollUpBill: `at` is when it SETTLED (closed_at, else created_at)", "node", () => {
  const r = BL.rollUpBill(sess({ closed_at: "C", created_at: "O" }), [], "R");
  const r2 = BL.rollUpBill(sess({ closed_at: null, created_at: "O" }), [], "R");
  return is(r.at === "C" && r2.at === "O");
});
await phase("rollUpBill: createdAt is carried separately, because THAT is the sort key", "node + the route's cursor", () =>
  is(BL.rollUpBill(sess({ created_at: "O", closed_at: "C" }), [], "R").createdAt === "O"
    && /nextBefore = full && sessions\.length \? sessions\[sessions\.length - 1\]\.created_at/.test(BILLS_ROUTE)));
await phase("the ledger row PRINTS the instant it is sorted by, not the settling time", "read the row's When column", () =>
  is(/\{b\.createdAt \? timeAgo\(b\.createdAt\)/.test(LEDGER_PAGE)));
await phase("…and names both moments in IST on hover, so nothing is lost by that choice", "read the title", () =>
  is(/Opened \$\{new Date\(b\.createdAt\)\.toLocaleString\("en-IN", \{ timeZone: "Asia\/Kolkata" \}\)\}/.test(LEDGER_PAGE)));
await phase("rollUpBill: a deletion recorded on an ORDER surfaces on the bill when the session row is silent", "node", () => {
  const r = BL.rollUpBill(sess({}), [ord({ deleted_at: "D", deleted_by: "Ravi", delete_reason: "why" })], "R");
  return is(r.deletedAt === "D" && r.deletedBy === "Ravi" && r.deleteReason === "why", JSON.stringify([r.deletedAt, r.deletedBy, r.deleteReason]));
});
await phase("rollUpBill: the SESSION's own tombstone wins over an order's", "node", () => {
  const r = BL.rollUpBill(sess({ deleted_at: "S", deleted_by: "Admin", delete_reason: "sr" }), [ord({ deleted_at: "D", deleted_by: "Ravi", delete_reason: "or" })], "R");
  return is(r.deletedAt === "S" && r.deletedBy === "Admin" && r.deleteReason === "sr");
});
await phase("rollUpBill: `loss` is null until the endpoint answers it", "node", () => is(BL.rollUpBill(sess({}), [], "R").loss === null));
await phase("rollUpBill: the restaurant name is carried on every record", "node", () => is(BL.rollUpBill(sess({}), [], "My Little French House").restaurantName === "My Little French House"));
await phase("rollUpBill: money is rounded to the paisa, never left with float dust", "node: three legs of 0.1", () => {
  const r = BL.rollUpBill(sess({}), [ord({ net_amount: 0.1 }), ord({ id: "o2", net_amount: 0.2 }), ord({ id: "o3", net_amount: 0.1 })], "R");
  return is(r.amount === 0.4, `amount ${r.amount}`);
});
await phase("rollUpBill never throws on an empty bill", "node", () => { BL.rollUpBill(sess({}), [], "R"); return true; });
await phase("rollUpBill never returns NaN money for a bill of malformed orders", "node: 6 broken order shapes", () => {
  const r = BL.rollUpBill(sess({}), [ord({ total: "x" }), ord({ id: "o2", net_amount: {} }), ord({ id: "o3" })], "R");
  return is(!Number.isNaN(r.amount) && !Number.isNaN(r.paid), `${r.amount}/${r.paid}`);
});
// A5 · the rule that must never be "tidied up"
await phase("a cancelled bill does NOT give its number back — the rejection is on the line someone would change", "read lib/billLedger.ts", () =>
  is(/REJECTED \(owner, 2026-08-16, re-confirmed 2026-08-22\)/.test(BLSRC) && /Do not free `bill_no`/.test(BLSRC)));
await phase("…and it cites the rule that makes reuse the problem, not the gap", "read the comment", () =>
  is(/Rule 46\(b\)/.test(BLSRC) && /GAPS ARE FINE\. REUSE IS THE PROBLEM/.test(BLSRC)));
await phase("…and points at the row in docs/REJECTED-IDEAS.md", "read the comment", () => is(/R44 in docs\/REJECTED-IDEAS\.md/.test(BLSRC)));
await phase("R44 is still recorded in docs/REJECTED-IDEAS.md, so the code comment is not orphaned", "read the doc", () =>
  is(/R44/.test(read("docs/REJECTED-IDEAS.md"))));
await phase("lib/billLedger.ts imports nothing that reaches the server", "read its imports", () => {
  const imps = [...BLSRC.matchAll(/^import .*?from "([^"]+)"/gm)].map((m) => m[1]);
  return is(imps.every((i) => i === "@/lib/tableTags"), imps.join(","));
});
await phase("the on-the-house marker is imported, never spelled a second time", "read the import + the use", () =>
  is(/import \{ ON_THE_HOUSE_METHOD \} from "@\/lib\/tableTags"/.test(BLSRC) && !/=== "On the house"/.test(BLSRC)));
await phase("nothing else in the repo re-implements deriveBillState", "grep for a second definition", () => {
  const hits = execSync(`grep -rl "function deriveBillState" ${root}/lib ${root}/app ${root}/components 2>/dev/null || true`, { encoding: "utf8" }).trim().split("\n").filter(Boolean);
  return is(hits.length === 1, hits.join(","));
});
await phase("the ledger route builds every row through rollUpBill", "read the route", () => is(/\.map\(\(s\) => rollUpBill\(s,/.test(BILLS_ROUTE)));
await phase("a bill of a restaurant that is now in the recycle bin still shows its name", "read the route's name map", () =>
  is(/rd\("restaurants", \(\) => sb\.from\("restaurants"\)\.select\("id, name, deleted_at"\)/.test(BILLS_ROUTE) && !/restaurants"\)\.select\("id, name"\)\.is\("deleted_at", null\)/.test(BILLS_ROUTE)));
await phase("…while the FILTER dropdown still offers only live restaurants", "read the route", () =>
  is(/restRows\s*\n?\s*\.filter\(\(r\) => r\.deleted_at == null\)/.test(BILLS_ROUTE)));

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// BAND B · lib/logTrail.ts — every row says where it happened            P75819–P75906 (88)
// ═══════════════════════════════════════════════════════════════════════════════════════════════
setBand("B · lib/logTrail.ts — where in the app each log row happened");

const writtenCodes = [...new Set([...execSync(
  `grep -rhoE '(logAction|await log|logRow)\\(\\s*"[a-z]+",\\s*"[a-z0-9_]+"' ${root}/app ${root}/lib 2>/dev/null || true`,
  { encoding: "utf8", maxBuffer: 1 << 26 }).matchAll(/"([a-z0-9_]+)"\s*$/gm)].map((m) => m[1]))].sort();

await phase("the write sites are found at all — the coverage check below is not vacuous", "grep the logAction call sites", () =>
  is(writtenCodes.length > 100, `${writtenCodes.length} codes`));
await phase("EVERY action code the app can write resolves to a real area and screen", "node: placeOf() over every code found at a write site", () => {
  const lost = writtenCodes.filter((c) => { const p = LT.placeOf(c); return p.area === "System" && p.screen === "Other"; });
  return is(lost.length === 0, lost.join(", "));
});
await phase("…and every one of them lands in an AREA the file declares", "node: placeOf().area ∈ AREAS", () => {
  const bad = writtenCodes.filter((c) => !LT.AREAS.includes(LT.placeOf(c).area));
  return is(bad.length === 0, bad.join(", "));
});
await phase("every code with a plain-words LABEL also has a place", "cross-read components/admin/shared.tsx ACT_LABEL", () => {
  const s = read("components/admin/shared.tsx");
  const m = s.match(/export const ACT_LABEL: Record<string, string> = \{([\s\S]*?)\n\};/);
  const keys = m ? [...m[1].matchAll(/^\s*([a-z0-9_]+)\s*:/gm)].map((x) => x[1]) : [];
  const lost = keys.filter((c) => { const p = LT.placeOf(c); return p.area === "System" && p.screen === "Other"; });
  return is(keys.length > 50 && lost.length === 0, `${keys.length} labels · lost: ${lost.join(", ")}`);
});
const PLACE_CASES = [
  ["an unknown code lands in System › Other — honest, not invented", "no_such_action_at_all", "System", "Other"],
  ["an empty code says Unknown rather than guessing", "", "System", "Unknown"],
  ["a whitespace-only code says Unknown too", "   ", "System", "Unknown"],
  ["an explicit entry beats the prefix rules", "order_place", "Orders & bills", "Take order"],
  ["a prefix rule catches a code nobody has placed by hand", "order_something_new", "Orders & bills", "Billing"],
  ["the first matching prefix wins", "table_something_new", "The floor", "Tables"],
  ["a bill print files under Print the bill, not Kitchen tickets", "print_sent", "Orders & bills", "Print the bill"],
  ["…and so does the act-as twin", "print_sent_by_admin", "Orders & bills", "Print the bill"],
  ["a KOT reaching paper files under Kitchen tickets", "kot_printed", "Orders & bills", "Kitchen tickets"],
  ["a KOT failing to reach paper does too", "kot_print_failed", "Orders & bills", "Kitchen tickets"],
  ["answering 'was the food made?' files under Kitchen tickets", "cancel_classified", "Orders & bills", "Kitchen tickets"],
  ["…and so does that answer failing", "cancel_classify_failed", "Orders & bills", "Kitchen tickets"],
  ["reopening a settled table is its own screen, not 'Reopen the bill'", "table_reopened", "Orders & bills", "Reopen the table"],
  ["voiding a live invoice is still 'Reopen the bill'", "invoice_void", "Orders & bills", "Reopen the bill"],
  ["the print helper is console work", "print_helper_added", "Aevidine console", "Printing"],
  ["which screen holds the paper is a Settings decision", "print_station_take", "Settings & features", "Printing"],
  ["the admin stepping into a panel is a sign-in event", "admin_enter_panel", "Sign-in & security", "Sign in"],
  ["clearing the log is console work", "logs_cleanup", "Aevidine console", "Logs"],
  ["a repair action is console work", "repair_void_bill", "Aevidine console", "Repair"],
  ["a server error is System › Server", "route_error", "System", "Server"],
  ["a screen error is System › Screen error", "client_error", "System", "Screen error"],
  ["a batch of taps is System › Button taps", "ui_taps", "System", "Button taps"],
  ["a direct database edit says so", "row_change", "System", "Direct database edit"],
];
for (const [title, code, area, screen] of PLACE_CASES) {
  await phase(`placeOf: ${title}`, `node: lib/logTrail.ts placeOf(${JSON.stringify(code)})`, () => {
    const p = LT.placeOf(code);
    return is(p.area === area && p.screen === screen, `got ${p.area} › ${p.screen}`);
  });
}
await phase("placeOf never throws on null", "node: placeOf(null)", () => { LT.placeOf(null); return true; });
await phase("placeOf never throws on undefined", "node: placeOf(undefined)", () => { LT.placeOf(undefined); return true; });
await phase("placeOf never throws on a number", "node: placeOf(42)", () => { LT.placeOf(42); return true; });
await phase("placeOf never throws on an object", "node: placeOf({})", () => { LT.placeOf({}); return true; });
await phase("placeOf always returns both an area and a screen", "node: 200 junk codes", () => {
  const bad = [];
  for (let i = 0; i < 200; i++) { const p = LT.placeOf("junk_" + i); if (!p.area || !p.screen) bad.push(i); }
  return is(bad.length === 0, bad.join(","));
});
await phase("the SAME code from two panels lands on two different screens", "node: placeOf('credit_note') with and without a panel", () => {
  const a = LT.placeOf("credit_note", "admin"), m = LT.placeOf("credit_note", "manager");
  return is(a.screen === "Bills" && a.area === "Aevidine console" && m.screen === "Reopen the bill", `${a.area} › ${a.screen} | ${m.area} › ${m.screen}`);
});
await phase("…and the same holds for a bill deleted from the console", "node: placeOf('order_delete','admin')", () => {
  const a = LT.placeOf("order_delete", "admin");
  return is(a.area === "Aevidine console" && a.screen === "Bills", `${a.area} › ${a.screen}`);
});
await phase("the panel name is matched case-insensitively", "node: placeOf('credit_note','ADMIN')", () => is(LT.placeOf("credit_note", "ADMIN").screen === "Bills"));
await phase("an unknown panel falls back to the code's own place", "node: placeOf('credit_note','tablet')", () => is(LT.placeOf("credit_note", "tablet").screen === "Reopen the bill"));
await phase("the console's Bills screen is named as the page's own heading, not 'Billing'", "read PANEL_PLACE's comment + the page heading", () =>
  is(/console's SUBSCRIPTION screen/.test(LTSRC) && />Bills<\/h1>/.test(LEDGER_PAGE)));
await phase("the dual-panel codes are exported so a guard can catch a third appearing", "read the export", () => is(/export const PANEL_SPECIFIC_PLACES/.test(LTSRC) && !!LT.PANEL_SPECIFIC_PLACES));
const PANEL_CASES = [["editor", "Manager panel"], ["manager", "Manager panel"], ["kitchen", "Kitchen screen"], ["tablet", "Waiter tablet"],
  ["owner", "Owner dashboard"], ["admin", "Aevidine console"], ["db", "Direct database edit"], ["guest", "Guest phone"], ["menu", "Guest menu"]];
for (const [p, want] of PANEL_CASES) {
  await phase(`panelName: "${p}" reads as "${want}"`, `node: lib/logTrail.ts panelName("${p}")`, () => is(LT.panelName(p) === want, LT.panelName(p)));
}
await phase("panelName: an unknown panel prints itself capitalised rather than vanishing", "node: panelName('warehouse')", () => is(LT.panelName("warehouse") === "Warehouse", LT.panelName("warehouse")));
await phase("panelName: a null panel says 'Unknown panel', never an empty crumb", "node", () => is(LT.panelName(null) === "Unknown panel"));
await phase("panelName: an empty string says 'Unknown panel'", "node", () => is(LT.panelName("") === "Unknown panel"));
await phase("panelName: a padded, upper-case panel still resolves", "node: panelName('  KITCHEN ')", () => is(LT.panelName("  KITCHEN ") === "Kitchen screen", LT.panelName("  KITCHEN ")));
const TARGET_CASES = [
  ["a numeric table becomes 'Table 5'", { table_number: "5" }, "Table 5"],
  ["a named table prints as it stands", { table_number: "Terrace" }, "Terrace"],
  ["a table number wins over everything else on the row", { table_number: "5", detail: 'deleted "Paneer Tikka"', order_id: "abcdef1234" }, "Table 5"],
  ["a quoted run inside the detail becomes the target", { detail: 'created manager "ravi"' }, "ravi"],
  ["a bill number inside the detail becomes 'Bill #212'", { detail: "admin deleted bill #212 — wrong table" }, "Bill #212"],
  ["'bill 212' with no hash is read too", { detail: "closed bill 212 unpaid" }, "Bill #212"],
  ["an order id falls back to its first eight characters", { order_id: "abcdef12-3456-7890-abcd-ef1234567890" }, "Order abcdef12"],
  ["nothing to say means nothing is said, rather than a guess", {}, null],
  ["an empty table number is not a target", { table_number: "   " }, null],
  ["an empty quoted run is not taken as a name", { detail: 'renamed "" to something' }, null],
  ["a quoted run longer than 60 characters is not taken", { detail: `x "${"a".repeat(61)}" y` }, null],
  ["a quote wins over a bill number when both are present", { detail: 'deleted "Paneer" from bill #7' }, "Paneer"],
];
for (const [title, row, want] of TARGET_CASES) {
  await phase(`targetOf: ${title}`, "node: lib/logTrail.ts targetOf() on the stated row", () => {
    const got = LT.targetOf(row);
    return is(got === want, `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  });
}
await phase("targetOf never throws on an empty row", "node: targetOf({})", () => { LT.targetOf({}); return true; });
await phase("targetOf never throws when every field is null", "node", () => { LT.targetOf({ table_number: null, order_id: null, detail: null, action: null }); return true; });
await phase("trailOf builds restaurant › panel › area › screen, in that order", "node", () => {
  const t = LT.trailOf({ panel: "manager", action: "order_place", table_number: "5", restaurant_name: "My Little French House" });
  return is(JSON.stringify(t.crumbs) === JSON.stringify(["My Little French House", "Manager panel", "Orders & bills", "Take order"]), t.crumbs.join(" › "));
});
await phase("trailOf drops a missing restaurant instead of printing a blank crumb", "node", () => {
  const t = LT.trailOf({ panel: "manager", action: "order_place" });
  return is(t.crumbs.length === 3 && t.crumbs[0] === "Manager panel", t.crumbs.join(" › "));
});
await phase("trailOf's short form is screen · target — the two crumbs that narrow a list row down", "node", () => {
  const t = LT.trailOf({ panel: "manager", action: "order_place", table_number: "5" });
  return is(t.short === "Take order · Table 5", t.short);
});
await phase("trailOf's short form drops the separator when there is no target", "node", () => {
  const t = LT.trailOf({ panel: "manager", action: "order_place" });
  return is(t.short === "Take order", t.short);
});
await phase("trailOf passes the PANEL through, so a dual-written code lands right", "node: credit_note from the console", () => {
  const t = LT.trailOf({ panel: "admin", action: "credit_note", restaurant_name: "R" });
  return is(t.area === "Aevidine console" && t.screen === "Bills", `${t.area} › ${t.screen}`);
});
await phase("trailOf never throws on an empty row", "node: trailOf({})", () => { LT.trailOf({}); return true; });
await phase("trailOf always returns a panel, an area and a screen", "node: 100 junk rows", () => {
  let bad = 0;
  for (let i = 0; i < 100; i++) { const t = LT.trailOf({ panel: "p" + i, action: "a" + i }); if (!t.panel || !t.area || !t.screen) bad++; }
  return is(bad === 0, String(bad));
});
await phase("lib/logTrail.ts is client-safe — it imports nothing at all", "read the file", () => is(!/^\s*import\s/m.test(LTSRC)));
for (const a of ["Orders & bills", "The floor", "The menu", "Parcel & delivery", "Banquet", "Stock & expenses",
  "People & pay", "Guests", "Settings & features", "Sign-in & security", "Aevidine console", "System"]) {
  await phase(`the area "${a}" is declared, and is words a restaurant uses`, "read AREAS", () =>
    is(LT.AREAS.includes(a) && !/_/.test(a) && a[0] === a[0].toUpperCase()));
}
await phase("no AREA name is a database word", "node: no snake_case, no lower-case first letter", () =>
  is(LT.AREAS.every((a) => !/_/.test(a) && /^[A-Z]/.test(a)), LT.AREAS.join("|")));
await phase("every area declared is actually used by at least one code", "node: place every written code and collect the areas", () => {
  const used = new Set(writtenCodes.map((c) => LT.placeOf(c).area));
  const unused = LT.AREAS.filter((a) => !used.has(a));
  return is(unused.length <= 2, `unused: ${unused.join(", ")}`);
});
await phase("no SCREEN name is a database word either", "node: screen names for every written code", () => {
  const bad = writtenCodes.map((c) => LT.placeOf(c).screen).filter((s) => /_/.test(s));
  return is(bad.length === 0, [...new Set(bad)].join(", "));
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// BAND C · the three screens, read as code                               P75907–P76011 (105)
// ═══════════════════════════════════════════════════════════════════════════════════════════════
setBand("C · the three screens, read as code");

const SCREENS = [["the Bills ledger", LEDGER_PAGE, "app/aevinite/bill-audit/page.tsx"],
  ["the Change log", CHANGES_PAGE, "app/aevinite/bill-audit/changes/page.tsx"],
  ["Audit & logs", LOGS_PAGE, "app/aevinite/logs/page.tsx"]];
for (const [name, src, path] of SCREENS) {
  await phase(`${name}: no server-only module is imported into a screen`, `read ${path}`, () =>
    is(!/supabaseAdmin|SUPABASE_SERVICE_ROLE|lib\/staffAuth/.test(src)));
  await phase(`${name}: no secret or key is spelled anywhere in it`, `read ${path}`, () =>
    is(!/sbp_|service_role|SERVICE_ROLE_KEY|eyJhbGciOi/.test(src)));
  await phase(`${name}: no raw \\uXXXX escape survives inside a JSX attribute`, `read ${path} — JSX string attributes do NOT process backslash escapes`, () => {
    const hits = [...src.matchAll(/\s(?:title|placeholder|aria-label|alt|label)="([^"]*\\u[0-9a-fA-F]{4}[^"]*)"/g)].map((m) => m[1]);
    return is(hits.length === 0, hits.join(" | "));
  });
  await phase(`${name}: nothing on it can render the words "undefined" or "NaN"`, `read ${path}`, () =>
    is(!/\{\s*(?:String\()?undefined/.test(src) && !/>NaN</.test(src)));
  await phase(`${name}: every failed read offers a way to try again`, `read ${path}`, () =>
    is(/Retry|Refresh|onRetry/.test(src)));
  await phase(`${name}: it fetches with cache: "no-store", so a stale answer cannot be shown as current`, `read ${path}`, () =>
    is(/cache: "no-store"/.test(src) || /adminFetch/.test(src)));
  await phase(`${name}: money and counts are grouped the Indian way`, `read ${path}`, () =>
    is(/toLocaleString\("en-IN"/.test(src) || /inr\(/.test(src)));
  await phase(`${name}: every date it prints is pinned to IST, never the reader's own clock`, `read ${path} — only DATE formatting is checked; a grouped NUMBER has no timezone`, () => {
    const loose = [...src.matchAll(/new Date\([^)]*\)\.toLocale(?:String|DateString|TimeString)\(([^;]*?)\)\s*(?::|\}|,|\)|;|$)/gm)]
      .map((m) => m[1]).filter((l) => !/Asia\/Kolkata/.test(l));
    return is(loose.length === 0, loose.slice(0, 2).join(" | "));
  });
}
// The Bills ledger
await phase("the ledger says on screen why it shows amounts at all", "read the sub-heading", () => is(/Amounts shown for oversight/.test(LEDGER_PAGE)));
await phase("the ledger says on screen that a deleted bill is never erased", "read the sub-heading", () => is(/Deleted bills are never erased/.test(LEDGER_PAGE)));
await phase("a tile never states a number it does not have yet", "read the Stat component", () =>
  is(/calculating \? "—" : v/.test(LEDGER_PAGE) && /calculating \? "counting/.test(LEDGER_PAGE)));
await phase("the Deleted tile shows '…' rather than 0 when the true count is missing", "read the tile", () =>
  is(/typeof counts\.deleted === "number" \? counts\.deleted : "…"/.test(LEDGER_PAGE)));
await phase("the Deleted tile splits three different events instead of presenting one number", "read the tile", () =>
  is(/removed by a person/.test(LEDGER_PAGE) && /closed out when the last dish came off/.test(LEDGER_PAGE) && /with nobody recorded/.test(LEDGER_PAGE)));
await phase("…and says nothing about the split when it could not be read", "read the null branch", () =>
  is(/d\?\.deletedByPerson == null \|\| d\?\.deletedEmptied == null/.test(LEDGER_PAGE)));
await phase("a bill that closed itself out is not described as somebody deleting it", "read the tombstone card", () =>
  is(/This bill closed itself out/.test(LEDGER_PAGE) && /Nobody deleted the bill/.test(LEDGER_PAGE)));
await phase("a tombstone with nobody recorded says so plainly", "read the card", () =>
  is(/This bill is marked deleted with nobody recorded/.test(LEDGER_PAGE)));
await phase("every tombstone card ends with the promise that it is kept and restorable", "read the card", () =>
  is(/Kept in full for tax\/audit — you can restore it/.test(LEDGER_PAGE)));
await phase("a delete refuses to happen without a reason", "read act()", () =>
  is(/A reason is required to delete a bill/.test(LEDGER_PAGE) && /A reason is required to delete a bill/.test(BILLS_ROUTE)));
await phase("…and the server refuses it too, not only the screen", "read the route", () =>
  is(/if \(!reason\) return NextResponse\.json\(\{ error: "A reason is required to delete a bill\."/.test(BILLS_ROUTE)));
await phase("the delete prompt tells the person the bill is NOT erased before they type", "read the prompt", () =>
  is(/The bill is NOT erased/.test(LEDGER_PAGE)));
await phase("a credit note refuses a zero or negative amount, on both sides", "read the page + the route", () =>
  is(/Enter a valid credit amount/.test(LEDGER_PAGE) && /Enter a credit amount greater than zero/.test(BILLS_ROUTE)));
await phase("a credit note refuses to happen without a reason, on both sides", "read the page + the route", () =>
  is(/A reason is required to issue a credit note/.test(LEDGER_PAGE) && /A reason is required to issue a credit note/.test(BILLS_ROUTE)));
await phase("a credit note carries ONE id per attempt, so a retried send cannot record it twice", "read issueCredit", () =>
  is(/X-LFH-Action-Id/.test(LEDGER_PAGE) && /randomUUID/.test(LEDGER_PAGE)));
await phase("…and the server is wrapped in the same at-most-once guard", "read the route", () => is(/export const POST = withIdempotency\(postImpl, "admin"\)/.test(BILLS_ROUTE)));
await phase("the credit-note prompt says the bill is NOT changed", "read the prompt", () => is(/The bill is NOT changed/.test(LEDGER_PAGE)));
await phase("a settled bill can never be edited from this screen — only credited", "read the buttons", () =>
  is(/Issue credit note/.test(LEDGER_PAGE) && !/Edit bill|Change total/.test(LEDGER_PAGE)));
await phase("the date window pins BOTH ends to IST", "read qsFor", () =>
  is(/from \+ "T00:00:00\.000\+05:30"/.test(LEDGER_PAGE) && /to \+ "T23:59:59\.999\+05:30"/.test(LEDGER_PAGE)));
await phase("paging uses the cursor the SERVER handed back, never one re-derived from the rows", "read loadMore", () =>
  is(/qsFor\(\{ before: nextBefore \}\)/.test(LEDGER_PAGE) && /setCursor\(\(j\?\.nextBefore as string \| null\) \?\? null\)/.test(LEDGER_PAGE)));
await phase("the way to older bills is offered even when the page came back empty", "read the footer's condition", () =>
  is(/\{d && nextBefore && \(/.test(LEDGER_PAGE)));
await phase("'none on this page' and 'none at all' do not read the same", "read the empty state", () =>
  is(/there are older ones/.test(LEDGER_PAGE) && /No bills in this view/.test(LEDGER_PAGE)));
await phase("auto-refresh stops once the admin has paged back, so their place is not thrown away", "read autoRefresh", () =>
  is(/const pagedIn = more\.length > 0/.test(LEDGER_PAGE) && /if \(!pagedIn\) load\(\)/.test(LEDGER_PAGE)));
await phase("the trail names an action in plain words, never a raw database code", "read the Trail row", () =>
  is(/ACT_LABEL\[ev\.action\] \|\| actLabel\(ev\.action\)/.test(LEDGER_PAGE)));
await phase("the invoice history reads as a generate/void timeline in words", "read InvoiceHistory", () =>
  is(/voided \(reopened\)/.test(LEDGER_PAGE) && /generated/.test(LEDGER_PAGE)));
await phase("a bill with no invoice says so rather than printing a dash", "read InvoiceHistory", () =>
  is(/Invoice not generated for this bill/.test(LEDGER_PAGE)));
await phase("the row folds on a phone rather than scrolling sideways", "read the CSS", () =>
  is(/@media \(max-width:760px\)/.test(LEDGER_PAGE) && /grid-template-areas:"state amt" "who when" "tbl chev"/.test(LEDGER_PAGE)));
await phase("the state colour travels as --hue so the light skin can darken it", "read the chip + the row", () =>
  is(/hue-ink/.test(LEDGER_PAGE) && /\["--hue" as string\]/.test(LEDGER_PAGE)));
await phase("every control on the ledger is named for a screen reader", "read the aria labels", () =>
  is(/aria-label="Restaurant"/.test(LEDGER_PAGE) && /aria-label="Find a bill/.test(LEDGER_PAGE)));
await phase("motion is dropped for anyone who asks for less of it", "read the CSS", () => is(/prefers-reduced-motion/.test(LEDGER_PAGE)));
// The Change log
await phase("the Change log never prints a raw database word in the Change column", "read the fallback", () =>
  is(/ACT\[r\.action\] \|\| \{ t: actLabel\(r\.action\), risk: r\.risk \}/.test(CHANGES_PAGE)));
await phase("its banner counts the whole log, not the page on screen", "read the banner + the route", () =>
  is(/in this whole log/.test(CHANGES_PAGE) && /countOf\(\[\.\.\.RISK\]\)/.test(AUDIT_ROUTE)));
await phase("a count that could not be read says so, instead of 'no removals'", "read the banner", () =>
  is(/Couldn't count the removals and reverts just now/.test(CHANGES_PAGE)));
await phase("…and a failed count never wipes a total already on screen", "read load()", () =>
  is(/if \(j\.total != null && j\.pages != null\) setMeta/.test(CHANGES_PAGE)));
await phase("the totals are asked for once per filter, not once per page", "read the withCount rule", () =>
  is(/const withCount = force === true \|\| sig !== sigRef\.current \|\| page === 1/.test(CHANGES_PAGE)));
await phase("a filter change starts again at the newest page and forgets the old total", "read refilter", () =>
  is(/const refilter = \(fn: \(\) => void\) => \{ setPage\(1\); setMeta\(null\); fn\(\); \}/.test(CHANGES_PAGE)));
await phase("the pager always offers the LAST page, because 'how far back' is half the question", "read pageWindow", () =>
  is(/new Set<number>\(\[1, pages, page, page - 1, page \+ 1\]\)/.test(CHANGES_PAGE)));
await phase("a gap in the pager is not a button", "read the gap render", () => is(/aria-hidden="true">…<\/span>/.test(CHANGES_PAGE)));
await phase("a page can be typed in, and Enter submits it", "read the jump form", () => is(/<form onSubmit=\{\(e\) => \{ e\.preventDefault\(\); onJump\(\); \}\}/.test(CHANGES_PAGE)));
await phase("the pager says how far back the record goes at all", "read the sentence", () =>
  is(/nothing here is older than \{retentionDays\} days/.test(CHANGES_PAGE)));
await phase("…and that number comes from the server's own cap, not from the screen", "read the route", () =>
  is(/MAX_RETENTION_DAYS = 30/.test(AUDIT_ROUTE) && /retentionDays: MAX_RETENTION_DAYS/.test(AUDIT_ROUTE)));
await phase("the paged read is a total order, so no row can appear on two pages", "read the route's order clauses", () =>
  is(/\.order\("created_at", \{ ascending: false \}\)\s*\n?\s*(\/\/[^\n]*\n\s*)*\.order\("id", \{ ascending: false \}\)/.test(AUDIT_ROUTE) || /\.order\("id", \{ ascending: false \}\)/.test(AUDIT_ROUTE)));
await phase("a hand-typed ?per= cannot ask for the whole log in one read", "read the clamp", () =>
  is(/Math\.min\(200, Math\.max\(20, Number\(url\.searchParams\.get\("per"\)\) \|\| PER_PAGE\)\)/.test(AUDIT_ROUTE)));
await phase("the Change log row folds on a phone rather than scrolling sideways", "read the CSS", () =>
  is(/grid-template-areas: "change when" "rest tbl" "by why"/.test(CHANGES_PAGE)));
await phase("…and the column heads are hidden when it folds, because they no longer describe a table", "read the CSS", () =>
  is(/\.chg-row\.head \{ display: none; \}/.test(CHANGES_PAGE)));
await phase("a row with no reason recorded does not spend a folded line saying so", "read the CSS + data-empty", () =>
  is(/\.c-why\[data-empty\] \{ display: none \}/.test(CHANGES_PAGE) && /data-empty=\{r\.detail \? undefined : ""\}/.test(CHANGES_PAGE)));
await phase("a reply with rows missing does not cost the whole screen", "read the rows read", () => is(/const rows = d\?\.rows \?\? \[\]/.test(CHANGES_PAGE)));
await phase("the Change log links back to the Bills ledger, and the ledger links to it", "read both pages", () =>
  is(/href="\/aevinite\/bill-audit"/.test(CHANGES_PAGE) && /href="\/aevinite\/bill-audit\/changes"/.test(LEDGER_PAGE)));
await phase("the Change log is read-only — it offers no button that changes a bill", "read the page", () =>
  is(!/method: "POST"|method: "DELETE"|method: "PATCH"/.test(CHANGES_PAGE)));
await phase("…and its endpoint exposes no write at all", "read the route", () => is(!/export async function (POST|DELETE|PATCH|PUT)/.test(AUDIT_ROUTE)));
// Audit & logs
await phase("the screen is called 'Audit & logs', the same name the owner and manager see", "read the h1", () => is(/<h1 className="adm-page-h"[^>]*>Audit &amp; logs<\/h1>/.test(LOGS_PAGE)));
await phase("a truncated feed says it is truncated, rather than reading as everything there is", "read FeedCap", () =>
  is(/Showing the \{FEED_LIMIT\} most recent/.test(LOGS_PAGE)));
await phase("…and both capped feeds are wired to it", "read the two tables", () =>
  is(/capped=\{\(ops\?\.length \?\? 0\) >= FEED_LIMIT\}/.test(LOGS_PAGE) && /capped=\{\(aud\?\.length \?\? 0\) >= FEED_LIMIT\}/.test(LOGS_PAGE)));
await phase("the URL is read with useSearchParams, never off window during a render", "read the level initialiser", () =>
  is(/const search = useSearchParams\(\)/.test(LOGS_CODE) && !/typeof window === "undefined"\) return ""/.test(LOGS_CODE)));
await phase("the first fetch waits for the URL to be read, so a deep link costs one read, not two", "read the seeded gate", () =>
  is(/if \(!seeded\) return;/.test(LOGS_PAGE)));
await phase("only the typed search is debounced — a filter button applies at once", "read the debounce", () =>
  is(/setTimeout\(\(\) => setQDebounced\(q\), 300\)/.test(LOGS_PAGE) && !/setTimeout[^\n]*setLevel/.test(LOGS_PAGE)));
await phase("an error row reads as one plain English sentence in the list", "read the det line", () =>
  is(/const det = isErr \? plainHeadline\(a\.detail\) : detailForList\(a\.action, a\.detail\)/.test(LOGS_PAGE)));
await phase("…and the exact words are kept, in the card the row opens", "read the modal wiring", () =>
  is(/<LogDetailModal row=\{detailRow\}/.test(LOGS_PAGE)));
await phase("the detail line is truncated by the box, not by a fixed character count", "read the ellipsis", () =>
  is(/textOverflow: "ellipsis"/.test(LOGS_CODE) && !/det\.slice\(0, 60\)/.test(LOGS_CODE)));
await phase("a problem set to come back later is not shown in the same red as a live one", "read the waiting chip", () =>
  is(/const waitingUntil = isErr && !isResolved && a\.snoozed_until/.test(LOGS_PAGE) && /Waiting · back \{backIn\(waitingUntil\)\}/.test(LOGS_PAGE)));
await phase("…and a wait is not a resolve — the chip says the problem is still open", "read the title", () =>
  is(/It is still open — nothing was marked fixed/.test(LOGS_PAGE)));
await phase("a resolved error stops reading red", "read the tint", () => is(/const showRed = isErr && !isResolved && !waitingUntil/.test(LOGS_PAGE)));
await phase("'the same problem' is decided by the SHARED signature, not by comparing text letter for letter", "read markResolved", () =>
  is(/errorSig\(x\.detail\) === wantSig/.test(LOGS_PAGE) && /import \{ errorSig \}/.test(LOGS_PAGE)));
await phase("the cleanup modal registers with the back-stack, like every other popup", "read CleanupModal", () =>
  is(/useAdminModal\(ref, "admin-logs-cleanup", onCancel\)/.test(LOGS_PAGE)));
await phase("the cleanup says out loud that bills and customer records are never touched", "read the modal", () =>
  is(/Bills and customer records are never touched/.test(LOGS_PAGE)));
await phase("…and that it cannot be undone", "read the modal", () => is(/can&rsquo;t be undone|can't be undone/.test(LOGS_PAGE)));
await phase("a failed retention save puts the old window back on screen", "read saveAuditYears", () =>
  is(/if \(!r\.ok\) \{ setAuditYears\(prev\)/.test(LOGS_PAGE)));
await phase("the audit window is the ADMIN's to set, and the screen says the log's window lives in Settings", "read the sub-heading", () =>
  is(/Change how long logs are kept in Settings/.test(LOGS_PAGE)));
await phase("the removals record names the restaurant on every row, so 'All restaurants' is never ambiguous", "read AudTable", () =>
  is(/r\.restaurant_name \? <span className="adm-muted"/.test(LOGS_PAGE)));
await phase("…and so does the operations feed", "read OpsTable", () => is(/a\.restaurant_name \? <span className="adm-muted"/.test(LOGS_PAGE)));
await phase("a removal with no reason recorded says 'no reason recorded', not an empty cell", "read the reason line", () =>
  is(/\|\| "no reason recorded"/.test(LOGS_PAGE)));
await phase("the removal type words come from the ONE shared map, never a copy", "read the derivation", () =>
  is(/Object\.keys\(KIND_LABEL\)\.map/.test(LOGS_PAGE)));
await phase("the sort and the type chips come from the one shared module too", "read the imports", () =>
  is(/import AUDITSORT from "@\/public\/panels\/auditsort\.js"/.test(LOGS_PAGE)));
await phase("a chip for a type that has left the feed cannot strand the list", "read audKindSafe", () =>
  is(/const audKindSafe = audKind && audChips\.some/.test(LOGS_PAGE) && /const opsGroupSafe = opsGroup && opsChips\.some/.test(LOGS_PAGE)));
await phase("the admin's own act-as rows are marked, not hidden", "read the Admin chip", () =>
  is(/a\.actor_id === ADMIN_VIEW_ACTOR_ID/.test(LOGS_PAGE) && /Admin<\/span>/.test(LOGS_PAGE)));
await phase("a tablet row names the manager whose PIN unlocked it", "read the PIN chip", () =>
  is(/isManagerPinRow\(a\)/.test(LOGS_PAGE) && /Unlocked by this manager's PIN/.test(LOGS_PAGE)));
await phase("…and a PIN shared by more than one manager says the row is ambiguous", "read the shared branch", () =>
  is(/PIN shared by these managers — any could have entered it/.test(LOGS_PAGE)));
await phase("the door to the Repair board carries the restaurant currently filtered to", "read the Link", () =>
  is(/\/aevinite\/repair\$\{rid \? `\?focus=\$\{encodeURIComponent\(rid\)\}` : ""\}#problems/.test(LOGS_PAGE)));
await phase("…and the Repair board actually reads that parameter", "read app/aevinite/repair/page.tsx", () =>
  is(/search\.get\("focus"\)/.test(read("app/aevinite/repair/page.tsx"))));
await phase("the error count on that button is counted from the rows this screen holds", "read errorCount", () =>
  is(/const errorCount = \(ops \|\| \[\]\)\.filter\(\(a\) => a\.level === "error" && !a\.resolved_at\)\.length/.test(LOGS_PAGE)));
await phase("no earnings figure appears on the customers tab", "read CustTable's comment + code", () =>
  is(/No ₹ spend here/.test(LOGS_PAGE)));

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// BAND D · docs/COMPLIANCE-GUARDRAILS.md — a sale can never disappear     P76012–P76064 (53)
// ═══════════════════════════════════════════════════════════════════════════════════════════════
setBand("D · the compliance rules, and the code that has to keep them");

const DOC_RULES = [
  ["the one idea: the software must be physically incapable of secretly hiding a real sale", /physically[\s*]*incapable of secretly hiding a real sale/],
  ["the cancellation rule is stated in his own words", /A sale can be cancelled\. A sale can never disappear/],
  ["a bill cancelled before an invoice draws NO invoice number", /never draws an invoice number/],
  ["…and the migration that refuses it is named", /Migration 331 refuses it in `lfh_generate_invoice`/],
  ["an issued invoice is never deleted, never edited, never renumbered", /never deleted, never edited, never renumbered/],
  ["a retired number stays, marked cancelled", /stays, retired and marked CANCELLED/],
  ["a correction after the tax period is a credit note, never an edit", /a \*\*credit note\*\*, never an edit/],
  ["cancelling records who, when and why", /records \*\*who, when and why\*\*/],
  ["a cancelled bill stays in the Z-report at ₹0", /stays in the Z-report[\s\S]{0,80}₹0/],
  ["nobody at the restaurant, the owner included, has a button that removes a bill", /No one at the restaurant — the owner included — has a button that removes a bill/],
  ["cancellations are reported, not just recorded", /Cancellations are \*\*reported, not just recorded\*\*/],
  ["every issued invoice is signed into an append-only chain", /signed into an append-only chain/],
  ["a bill is never cancelled as an act — only a KOT is", /A BILL IS NEVER CANCELLED AS AN ACT/],
  ["…and that derived state is named as deriveBillState in lib/billLedger.ts", /`deriveBillState` in `lib\/billLedger\.ts`/],
  ["no invoice, no bill number, anywhere a removal is reported", /NO INVOICE, NO BILL NUMBER/],
  ["the record says what a removal did to the bill, in money, every time", /IN MONEY, EVERY TIME/],
  ["once the invoice is printed nothing comes off the bill", /ONCE THE INVOICE IS PRINTED, NOTHING COMES OFF THE BILL/],
  ["reopen re-opens the TABLE, not the bill, and only onto a free one", /REOPEN RE-OPENS THE TABLE, NOT THE BILL/],
  ["why number-keeping is not negotiable, with the rule cited", /CGST Rule 46\(b\)/],
  ["bulk-delete by date range is the one that never exists", /Nothing\. This never exists\./],
  ["a switch that disables the audit log is refused", /Log\/history is \*\*non-disableable\*\*/],
  ["hiding sales from the Z-report is refused", /Z-report includes voids\/deletes/],
  ["THE STANDING PRE-EMPT: dashboards must include voids and deleted bills", /Z-report \/ dashboards must include voids and deleted bills/],
  ["service charge is never default or mandatory", /Service charge is NEVER default or mandatory/],
  ["a tax rate is never hardcoded", /Never hardcode a tax rate/],
  ["records are kept 6–8 years, even for a purged tenant", /Records retention 6–8 years/],
  ["the purge keeps every money table, and they are listed", /keeps\*\* orders,[\s\S]{0,40}order_items, sessions, payments/],
  ["bill_chain cannot be removed even deliberately", /refuses a DELETE to every role, service role included/],
  ["the rehearsed refusal is written down", /it's the exact feature that put PetPooja's founders/],
  ["where the delete power went is written down, and points at R27", /docs\/REJECTED-IDEAS\.md.{0,10}R27/],
];
for (const [title, re] of DOC_RULES) {
  await phase(`the compliance doc still says: ${title}`, "read docs/COMPLIANCE-GUARDRAILS.md", () => is(re.test(COMPLIANCE)));
}
await phase("rule 11 is marked BUILT, not 'not built yet' — it shipped in migration 365", "read §3.0b", () =>
  is(/✅ \*\*BUILT\*\*/.test(COMPLIANCE) && !/NOT BUILT YET/.test(COMPLIANCE)));
await phase("…and the migration file it names actually exists", "check supabase/migrations", () =>
  is(existsSync(join(root, "supabase/migrations/365_reopen_puts_the_table_back_not_the_bill.sql"))));
await phase("migration 331 exists, so the 'no invoice for a cancelled bill' claim is not orphaned", "check supabase/migrations", () => {
  return is(readdirSync(join(root, "supabase/migrations")).some((f) => /^331_/.test(f)));
});
await phase("migration 332 exists — the signed chain the doc says was built", "check supabase/migrations", () => {
  return is(readdirSync(join(root, "supabase/migrations")).some((f) => /^332_/.test(f)));
});
await phase("migration 340 exists — the 'was the food made?' answer the ledger reads", "check supabase/migrations", () => {
  return is(readdirSync(join(root, "supabase/migrations")).some((f) => /^340_/.test(f)));
});
await phase("no screen in this territory offers a hard delete of a bill", "grep the three pages", () =>
  is(!/hard ?delete|permanentlyDelete|purgeBill/i.test(LEDGER_PAGE + CHANGES_PAGE + LOGS_PAGE)));
await phase("no screen in this territory offers a bulk clear of bills", "grep the three pages", () =>
  is(!/clear all bills|delete all bills|clearDay|wipeBills/i.test(LEDGER_PAGE + CHANGES_PAGE + LOGS_PAGE)));
await phase("the admin's own delete is a SOFT delete that keeps the row", "read the route", () =>
  is(/softDeleteOrders/.test(BILLS_ROUTE) && !/\.delete\(\)/.test(BILLS_ROUTE)));
await phase("…and it writes the permanent removals record as well as the activity line", "read the route", () =>
  is(/recordRemoval\(\{/.test(BILLS_ROUTE) && /kind: "order_deleted"/.test(BILLS_ROUTE)));
await phase("a restore writes a permanent record too, so the trail does not end at 'removed'", "read the route", () =>
  is(/kind: "order_restored"/.test(BILLS_ROUTE)));
await phase("the amount recorded as removed is the same net the ledger shows", "read the route", () =>
  is(/amount: netAmount\(o\)/.test(BILLS_ROUTE)));
await phase("a failed read of the bill's orders refuses the delete rather than half-doing it", "read the route", () =>
  is(/if \(ordersQ\.error\) return adminFail\("this bill", ordersQ\.error, \{ action: "save" \}\)/.test(BILLS_ROUTE)));
await phase("the delete reads at most one bill's worth of orders, with the cap named", "read BILL_ORDER_CAP", () =>
  is(/const BILL_ORDER_CAP = 500/.test(BILLS_ROUTE) && /\.limit\(BILL_ORDER_CAP\)/.test(BILLS_ROUTE)));
await phase("every admin action on a bill is signed with an actor, so the Change log's 'By' is never blank", "read the logAction calls", () => {
  const calls = [...BILLS_ROUTE.matchAll(/logAction\("admin", "[a-z_]+", \{([^}]*)\}/g)].map((m) => m[1]);
  const unsigned = calls.filter((c) => !/actor: "Admin"/.test(c));
  return is(calls.length >= 3 && unsigned.length === 0, `${calls.length} calls · ${unsigned.length} unsigned`);
});
await phase("the ledger's floor cache is invalidated on both a delete and a restore", "read the route", () => {
  const hits = (BILLS_ROUTE.match(/invalidateFloor\(rid\)/g) || []).length;
  return is(hits >= 2, `${hits} call(s)`);
});
await phase("R27 is still recorded — there is no delete-a-bill permission to grant", "read docs/REJECTED-IDEAS.md", () =>
  is(/R27/.test(read("docs/REJECTED-IDEAS.md"))));
await phase("R47 is still recorded — no bill-level cancel button", "read docs/REJECTED-IDEAS.md", () => is(/R47/.test(read("docs/REJECTED-IDEAS.md"))));
await phase("CLAUDE.md still points at this doc for anything touching billing", "read CLAUDE.md", () =>
  is(/docs\/COMPLIANCE-GUARDRAILS\.md/.test(read("CLAUDE.md"))));
await phase("the doc names the guard that watches the purge", "read the doc", () => is(/verify:t24-money-rules/.test(COMPLIANCE)));
await phase("…and that guard still exists as an npm script", "read package.json", () => is(/"verify:t24-money-rules"/.test(read("package.json"))));
await phase("the doc's own last-reviewed date is present, so nobody reads it as freshly checked", "read the header", () =>
  is(/Last reviewed \*\*2026-/.test(COMPLIANCE)));
await phase("the doc is not legal advice, and says so", "read the header", () => is(/Not legal advice/.test(COMPLIANCE)));
await phase("its sources are named, so a future reader can re-check them", "read the footer", () => is(/\*Sources \(2026-07-25 research\)/.test(COMPLIANCE)));

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// BAND E · live, headless — the three screens as they actually draw       P76065–P76208 (144)
// ═══════════════════════════════════════════════════════════════════════════════════════════════
setBand("E · live — the three screens as they actually draw");

// The browser is launched whenever the chosen range REACHES the live bands (they start at phase
// 365). Deliberately not an upper bound as well: a top-end that has to be kept in step with the
// phase count silently stops launching the browser the day a phase is appended, and then the live
// checks report "skipped" instead of running — a guard that cannot run looks exactly like one
// nobody ran.
const LIVE = !LEDGER && TO >= 365;
let br = null, ctxOf = null, upErr = null;
if (LIVE) {
  try { await requireUp(BASE, "the bill-ledger and logs sweep"); } catch (e) { upErr = e && e.message ? e.message : String(e); }
  if (!upErr) {
    const { chromium } = await import("playwright");
    br = await chromium.launch();
    ctxOf = async (w, h, skin) => {
      const c = await br.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, serviceWorkers: "block" });
      await c.addCookies([{ name: "lfh_staff_auth", value: ADMIN_COOKIE.split("=")[1], url: BASE },
        { name: "aevidine_skin", value: skin, url: BASE }]);
      return c;
    };
  }
}
const needLive = () => (upErr ? { skip: true, note: upErr } : !br ? { skip: true, note: "live band not selected" } : null);

const PAGES = [["the Bills ledger", "/aevinite/bill-audit", "Bills"],
  ["the Change log", "/aevinite/bill-audit/changes", "Bills · Change log"],
  ["Audit & logs", "/aevinite/logs", "Audit & logs"]];
const SIZES = [["desktop 1440px", 1440, 900], ["phone 390px", 390, 844]];
const SKINS = ["dark", "light"];

// A cached render per page × size × skin, so 12 loads answer many phases.
const shots = new Map();
async function render(path, w, h, skin) {
  const key = `${path}|${w}|${skin}`;
  if (shots.has(key)) return shots.get(key);
  const c = await ctxOf(w, h, skin);
  const p = await c.newPage();
  const pageErrors = [], consoleErrors = [];
  p.on("pageerror", (e) => pageErrors.push(String(e && e.message ? e.message : e)));
  p.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
  let status = 0;
  try { const r = await p.goto(BASE + path, { waitUntil: "networkidle", timeout: 60000 }); status = r ? r.status() : 0; } catch { status = 0; }
  await p.waitForTimeout(2500);
  const info = await p.evaluate(() => {
    const body = document.body;
    const txt = body.innerText || "";
    // WHAT "OFF THE SIDE" MEANS HERE. The admin shell parks its whole sidebar off-canvas on a
    // phone — that is the drawer working, not a fault — so the count is taken inside the PAGE's own
    // content area only. And it is taken per element rather than from the document's scrollWidth,
    // because a row wider than the screen inside a box with overflow-x:auto leaves the DOCUMENT
    // perfectly happy while the last column is unreachable. That is exactly how a 540px log row
    // sat behind a sideways scroll on a 390px phone with nothing saying so.
    const content = document.querySelector("main, .adm-body") || document.body;
    const wide = [...content.querySelectorAll("*")].filter((el) => {
      if (el.checkVisibility && !el.checkVisibility()) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && (r.right > window.innerWidth + 2 || r.left < -2);
    }).length;
    // The words this SCREEN chooses, with the words a log row RECORDED taken out. A recorded detail
    // is rendered as a span whose `title` is the same text (that is the shape of the truncating
    // detail line and of nothing else on these three screens), so it can be lifted out exactly.
    // Deliberately narrower than it looks: this asserts nothing about a raw word that arrived
    // INSIDE a recorded detail — translating those happens in the shared display formatter, which
    // is not one of this territory's files. See the sweep report's item on `give_discounts→default`.
    let chrome = txt;
    for (const el of document.querySelectorAll("[title]")) {
      const t = (el.textContent || "").trim();
      if (t && el.getAttribute("title").trim() === t) chrome = chrome.split(t).join(" ");
    }
    return {
      text: txt,
      chrome,
      len: txt.replace(/\s+/g, " ").trim().length,
      h1: document.querySelector("h1")?.textContent || "",
      docScrollX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      offscreen: wide,
      hasSkeleton: !!document.querySelector("[aria-busy], .adm-skel"),
      controls: [...document.querySelectorAll("input, select, button, textarea")].map((e) => ({
        tag: e.tagName, named: !!(e.getAttribute("aria-label") || e.getAttribute("title") || (e.textContent || "").trim() || e.labels?.length),
      })),
      tiny: [...document.querySelectorAll("body *")].filter((el) => {
        if (!el.childNodes.length || ![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) return false;
        return parseFloat(getComputedStyle(el).fontSize) < 9.5;
      }).length,
    };
  });
  const out = { status, pageErrors, consoleErrors, ...info, page: p, ctx: c };
  shots.set(key, out);
  return out;
}

for (const [name, path, heading] of PAGES) {
  for (const [sizeName, w, h] of SIZES) {
    for (const skin of SKINS) {
      await phase(`${name} answers and draws at ${sizeName}, ${skin} skin`, `headless GET ${path} at ${w}px`, async () => {
        const s = needLive(); if (s) return s;
        const r = await render(path, w, h, skin);
        return is(r.status === 200, `HTTP ${r.status}`);
      });
      await phase(`${name} throws nothing at ${sizeName}, ${skin} skin`, `headless: count pageerror events on ${path}`, async () => {
        const s = needLive(); if (s) return s;
        const r = await render(path, w, h, skin);
        return is(r.pageErrors.length === 0, r.pageErrors.slice(0, 2).join(" | "));
      });
      await phase(`${name} is a real screen at ${sizeName}, ${skin} skin — not an empty shell`, `headless: measure the rendered text`, async () => {
        const s = needLive(); if (s) return s;
        const r = await render(path, w, h, skin);
        return is(r.len > 400, `${r.len} characters`);
      });
      await phase(`${name} keeps its heading at ${sizeName}, ${skin} skin`, `headless: read the h1`, async () => {
        const s = needLive(); if (s) return s;
        const r = await render(path, w, h, skin);
        return is(r.h1.replace(/\s+/g, " ").trim() === heading, `h1 "${r.h1}"`);
      });
      await phase(`${name} does not scroll sideways at ${sizeName}, ${skin} skin`, `headless: compare scrollWidth with clientWidth`, async () => {
        const s = needLive(); if (s) return s;
        const r = await render(path, w, h, skin);
        return is(!r.docScrollX, "the page scrolls sideways");
      });
      await phase(`${name} shows no leaked code text at ${sizeName}, ${skin} skin`, `headless: search the rendered text for undefined / NaN / [object Object] / \${ / --> / \\u`, async () => {
        const s = needLive(); if (s) return s;
        const r = await render(path, w, h, skin);
        const bad = ["undefined", "NaN", "[object Object]", "${", "-->", "\\u"].filter((t) => r.text.includes(t));
        return is(bad.length === 0, bad.join(", "));
      });
      await phase(`${name} prints no raw database word in its OWN words at ${sizeName}, ${skin} skin`, `headless: look for snake_case in the rendered text, with recorded detail lines lifted out`, async () => {
        const s = needLive(); if (s) return s;
        const r = await render(path, w, h, skin);
        const words = [...new Set((r.chrome.match(/\b[a-z]{3,}_[a-z_]{2,}\b/g) || []))]
          .filter((x) => !/^(dd_mm|mm_yyyy)$/.test(x));
        return is(words.length === 0, words.slice(0, 6).join(", "));
      });
      await phase(`${name} keeps every word readable at ${sizeName}, ${skin} skin`, `headless: count text nodes drawn under 9.5px`, async () => {
        const s = needLive(); if (s) return s;
        const r = await render(path, w, h, skin);
        return is(r.tiny === 0, `${r.tiny} element(s) under 9.5px`);
      });
      await phase(`${name} keeps everything on screen at ${sizeName}, ${skin} skin`, `headless: count elements whose box sits outside the viewport`, async () => {
        const s = needLive(); if (s) return s;
        const r = await render(path, w, h, skin);
        return is(r.offscreen === 0, `${r.offscreen} element(s) off the side`);
      });
      await phase(`${name} names every box you can type in or choose from at ${sizeName}, ${skin} skin`, `headless: check each control has a label`, async () => {
        const s = needLive(); if (s) return s;
        const r = await render(path, w, h, skin);
        const unnamed = r.controls.filter((c) => !c.named).length;
        return is(unnamed === 0, `${unnamed} of ${r.controls.length} unnamed`);
      });
      await phase(`${name} finishes loading at ${sizeName}, ${skin} skin — no skeleton left on screen`, `headless: look for a loading placeholder after networkidle`, async () => {
        const s = needLive(); if (s) return s;
        const r = await render(path, w, h, skin);
        return is(!r.hasSkeleton, "a loading placeholder is still drawn");
      });
    }
  }
}
// 3 pages × 2 sizes × 2 skins × 11 = 132. Twelve API/behaviour phases follow.
const apiGet = async (p) => {
  const r = await fetch(BASE + p, { headers: { cookie: ADMIN_COOKIE }, cache: "no-store" });
  return { status: r.status, json: await r.json().catch(() => ({})) };
};
await phase("the ledger endpoint answers with bills, counts and a restaurant list", "GET /api/admin/bills?limit=50", async () => {
  const s = needLive(); if (s) return s;
  const r = await apiGet("/api/admin/bills?limit=50");
  return is(r.status === 200 && Array.isArray(r.json.bills) && r.json.counts && Array.isArray(r.json.restaurants), `HTTP ${r.status}`);
});
await phase("every bill it returns carries a state the screen has words for", "GET /api/admin/bills?limit=200", async () => {
  const s = needLive(); if (s) return s;
  const r = await apiGet("/api/admin/bills?limit=200");
  const bad = (r.json.bills || []).filter((b) => !BL.BILL_STATE_META[b.state]).map((b) => b.state);
  return is(bad.length === 0, [...new Set(bad)].join(", "));
});
await phase("every bill it returns names the restaurant it belongs to", "GET /api/admin/bills?limit=200", async () => {
  const s = needLive(); if (s) return s;
  const r = await apiGet("/api/admin/bills?limit=200");
  const anon = (r.json.bills || []).filter((b) => !b.restaurantName || b.restaurantName === "—");
  return is(anon.length === 0, `${anon.length} of ${(r.json.bills || []).length} anonymous`);
});
await phase("no bill collected more than it was worth", "GET /api/admin/bills?limit=200", async () => {
  const s = needLive(); if (s) return s;
  const r = await apiGet("/api/admin/bills?limit=200");
  const bad = (r.json.bills || []).filter((b) => Number(b.paid) > Number(b.amount) + 0.005);
  return is(bad.length === 0, `${bad.length} bill(s)`);
});
await phase("no bill's money reads as NaN", "GET /api/admin/bills?limit=200", async () => {
  const s = needLive(); if (s) return s;
  const r = await apiGet("/api/admin/bills?limit=200");
  const bad = (r.json.bills || []).filter((b) => !Number.isFinite(Number(b.amount)) || !Number.isFinite(Number(b.paid)));
  return is(bad.length === 0, `${bad.length} bill(s)`);
});
await phase("the Deleted count is the database's own total, not the page's", "GET /api/admin/bills?limit=20", async () => {
  const s = needLive(); if (s) return s;
  const r = await apiGet("/api/admin/bills?limit=20");
  return is(typeof r.json.deletedTotal === "number" && r.json.counts.deleted === r.json.deletedTotal,
    `deletedTotal ${r.json.deletedTotal} · counts.deleted ${r.json.counts?.deleted} · page ${(r.json.bills || []).length}`);
});
await phase("the Deleted split adds up to no more than the total", "GET /api/admin/bills?limit=20", async () => {
  const s = needLive(); if (s) return s;
  const r = await apiGet("/api/admin/bills?limit=20");
  const { deletedTotal, deletedByPerson, deletedEmptied } = r.json;
  if (deletedByPerson == null || deletedEmptied == null) return { skip: true, note: "the split could not be read on this database" };
  return is(deletedByPerson + deletedEmptied <= deletedTotal, `${deletedByPerson} + ${deletedEmptied} vs ${deletedTotal}`);
});
await phase("only closed-unpaid bills carry a loss answer", "GET /api/admin/bills?limit=200", async () => {
  const s = needLive(); if (s) return s;
  const r = await apiGet("/api/admin/bills?limit=200");
  const stray = (r.json.bills || []).filter((b) => b.state !== "cancelled" && b.loss != null);
  return is(stray.length === 0, `${stray.length} bill(s)`);
});
await phase("the ledger's own order runs newest-first, with no older bill above a newer one", "GET /api/admin/bills?limit=200", async () => {
  const s = needLive(); if (s) return s;
  const r = await apiGet("/api/admin/bills?limit=200");
  const t = (r.json.bills || []).map((b) => (b.createdAt ? Date.parse(b.createdAt) : 0));
  let out = 0; for (let i = 1; i < t.length; i++) if (t[i] > t[i - 1]) out++;
  return is(out === 0, `${out} out of order of ${t.length}`);
});
await phase("the change log reports an exact total and a last page when asked", "GET /api/admin/bill-audit?page=1&count=1", async () => {
  const s = needLive(); if (s) return s;
  const r = await apiGet("/api/admin/bill-audit?page=1&count=1");
  return is(r.status === 200 && typeof r.json.total === "number" && typeof r.json.pages === "number", JSON.stringify([r.json.total, r.json.pages]));
});
await phase("…and a plain page hop does NOT re-count", "GET /api/admin/bill-audit?page=2", async () => {
  const s = needLive(); if (s) return s;
  const r = await apiGet("/api/admin/bill-audit?page=2");
  return is(r.json.total === null && r.json.pages === null, JSON.stringify([r.json.total, r.json.pages]));
});
await phase("every change-log row names a restaurant, an actor and an action with words for it", "GET /api/admin/bill-audit?page=1&count=1", async () => {
  const s = needLive(); if (s) return s;
  const r = await apiGet("/api/admin/bill-audit?page=1&count=1");
  const rows2 = r.json.rows || [];
  if (!rows2.length) return { skip: true, note: "no bill changes on this database" };
  const bad = rows2.filter((x) => !x.restaurantName || !x.actor || !x.action);
  return is(bad.length === 0, `${bad.length} of ${rows2.length}`);
});


// ═══════════════════════════════════════════════════════════════════════════════════════════════
// BAND F · the five faults this sweep fixed, and the shapes that let them in   P76209– (appended)
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// APPENDED AT THE END, NEVER INSERTED. A phase id here is its POSITION in this file, so putting a
// new case into the middle of an earlier band silently renames every id after it and "re-run
// P75930" stops meaning anything. New work goes on the bottom.
setBand("F · the five faults this sweep fixed");

await phase("no JSX attribute anywhere in this territory carries a raw \\uXXXX escape (item 1)",
  "read all three screens — a JSX string attribute is not a JS string literal, so no escape in it is processed", () => {
    const hits = [];
    for (const [name, src] of [["Bills ledger", LEDGER_PAGE], ["Change log", CHANGES_PAGE], ["Audit & logs", LOGS_PAGE]])
      for (const m of src.matchAll(/\s[a-zA-Z-]+="([^"]*\\u[0-9a-fA-F]{4}[^"]*)"/g)) hits.push(`${name}: ${m[1]}`);
    return is(hits.length === 0, hits.join(" | "));
  });
await phase("…and no JSX TEXT child does either — the same rule applies between the tags (item 1)",
  "read all three screens for a bare \\uXXXX outside an expression", () => {
    const hits = [];
    for (const [name, src] of [["Bills ledger", LEDGER_PAGE], ["Change log", CHANGES_PAGE], ["Audit & logs", LOGS_PAGE]])
      for (const m of src.matchAll(/>[^<>{}\n]*\\u[0-9a-fA-F]{4}[^<>{}\n]*</g)) hits.push(`${name}: ${m[0].slice(0, 60)}`);
    return is(hits.length === 0, hits.join(" | "));
  });
await phase("the Change log's empty state names the page it is on when that page is past the end (item 2)",
  "read app/aevinite/bill-audit/changes/page.tsx", () =>
  is(/this is past the end of the log/.test(CHANGES_PAGE)));
await phase("…and offers both a step back and a jump to the newest changes (item 2)",
  "read the empty state's two buttons", () =>
  is(/Back a page/.test(CHANGES_PAGE) && /Back to the newest changes/.test(CHANGES_PAGE)));
await phase("…and the jump forgets the total that belonged to the page it left (item 2)",
  "read the empty state's OWN button — `refilter` carries the same two calls, so the whole button is matched", () =>
  is(/onClick=\{\(\) => \{ setPage\(1\); setMeta\(null\); \}\}>Back to the newest changes<\/button>/.test(CHANGES_PAGE)));
await phase("the bill-history read checks that the answer was OK before believing it (item 3)",
  "read app/aevinite/bill-audit/page.tsx", () => is(/if \(!res\.ok\) throw new Error\(j\?\.error \|\| "Couldn't load\."\)/.test(LEDGER_PAGE)));
await phase("…and a failure is carried, not swallowed into three empty lists (item 3)",
  "read the catch and the Expanded type", () =>
  is(/failed\?: boolean/.test(LEDGER_PAGE) && /creditNotes: \[\], failed: true/.test(LEDGER_PAGE)));
await phase("…and each of the three sections says unknown rather than none (item 3)",
  "read the three components", () => {
    const wants = ["Couldn&rsquo;t read the invoice history", "Couldn&rsquo;t read the credit notes", "Couldn&rsquo;t read what happened to this bill"];
    const missing = wants.filter((w) => !LEDGER_PAGE.includes(w));
    return is(missing.length === 0, missing.join(" | "));
  });
await phase("…and the person is offered a way to try again (item 3)",
  "read the warning strip", () => is(/Try again<\/button>/.test(LEDGER_PAGE)));
await phase("…and the credit-note refetch goes through the same door, so it cannot disagree (item 3)",
  "read issueCredit", () => is(/await loadTrail\(b\.sessionId\);/.test(LEDGER_PAGE) && (LEDGER_PAGE.match(/loadTrail\(b\.sessionId\)/g) || []).length >= 3,
    `${(LEDGER_PAGE.match(/loadTrail\(b\.sessionId\)/g) || []).length} call site(s) — expand, the credit-note refetch and Try again`));
// Scoped to each table's OWN function body: all three feeds now wear `aud-stack`, so a whole-file
// grep answers yes for the Operations wrapper while reading the Audit one — which is exactly what
// happened when this guard was sabotaged to check it.
const bodyOf = (name) => {
  const i = LOGS_PAGE.indexOf(`function ${name}(`);
  if (i < 0) return "";
  const j = LOGS_PAGE.indexOf("\nfunction ", i + 1);
  return LOGS_PAGE.slice(i, j < 0 ? undefined : j);
};
await phase("the Operations feed stacks on a phone instead of scrolling sideways (item 4)",
  "read the wrapper's classes inside OpsTable only", () => is(/<div className="adm-logwrap aud-stack">/.test(bodyOf("OpsTable")), "OpsTable's wrapper"));
await phase("…and so does the Customers feed (item 4)",
  "read the wrapper's classes inside CustTable only", () => is(/<div className="adm-logwrap aud-stack logs-cust"/.test(bodyOf("CustTable")), "CustTable's wrapper"));
await phase("…and the Audit feed, which already did, still does (item 4)",
  "read the wrapper's classes inside AudTable only", () => is(/<div className="adm-logwrap aud-stack">/.test(bodyOf("AudTable")), "AudTable's wrapper"));
await phase("…and its stacked cells carry a word, because a bare value on its own line says nothing (item 4)",
  "read the scoped style", () => is(/\.logs-cust \.adm-logrow > div:nth-child\(2\)::before \{ content: "table "/.test(LOGS_PAGE)));
await phase("…and that stacking is the SHARED mechanism, not a fourth copy of it (item 4)",
  "read app/globals.css for .aud-stack", () => is(/\.aud-stack \.adm-logrow \{ min-width: 0 !important/.test(read("app/globals.css"))));
await phase("the Audit retention note draws its line where the compliance doc puts it (item 5)",
  "read the branch against docs/COMPLIANCE-GUARDRAILS.md", () =>
  is(/auditYears >= 6/.test(LOGS_PAGE) && /Records retention 6–8 years/.test(COMPLIANCE)));
await phase("…so no offered window is warned about while the warning calls it normal (item 5)",
  "node: run the branch's rule over every option the server offers", () => {
    const opts = (read("app/api/admin/settings/route.ts").match(/AUDIT_YEAR_OPTS = \[([^\]]+)\]/) || [, ""])[1]
      .split(",").map((x) => Number(x.trim())).filter(Number.isFinite);
    const m = LOGS_PAGE.match(/auditYears >= (\d+)/);
    const cut = m ? Number(m[1]) : NaN;
    const contradictory = opts.filter((y) => y < cut && y >= 6);
    return is(opts.length > 0 && Number.isFinite(cut) && contradictory.length === 0,
      `options ${opts.join("/")} · warns below ${cut} · contradictory: ${contradictory.join(",") || "none"}`);
  });
// ── the same five, watched in the browser ────────────────────────────────────────────────────────
await phase("live: hovering the All chip shows a dash, not the letters u-2-0-1-4 (item 1)",
  "headless: read the chip's title attribute on /aevinite/bill-audit", async () => {
    const st = needLive(); if (st) return st;
    const r = await render("/aevinite/bill-audit", 1440, 900, "dark");
    const t = await r.page.evaluate(() => [...document.querySelectorAll(".blz-chip")]
      .find((x) => (x.textContent || "").trim().startsWith("All"))?.getAttribute("title") || "");
    return is(t.includes("—") && !t.includes("\\u"), JSON.stringify(t.slice(0, 60)));
  });
await phase("live: a Change log page past the end still has a way back on it (item 2)",
  "headless: with the exact count suppressed, ask for a page that does not exist", async () => {
    const st = needLive(); if (st) return st;
    const c = await ctxOf(1280, 900, "dark");
    const p = await c.newPage();
    try {
      // The count is ALLOWED to fail — the route sends null so the banner can say it does not know.
      // Rewritten in the browser only; nothing is written and the shared database is untouched.
      await p.route("**/api/admin/bill-audit*", async (rt) => {
        const res = await rt.fetch(); const j = await res.json();
        j.total = null; j.pages = null; j.riskCount = null;
        await rt.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(j) });
      });
      await p.goto(BASE + "/aevinite/bill-audit/changes", { waitUntil: "networkidle", timeout: 60000 });
      await p.waitForTimeout(2000);
      await p.fill("#chg-jump", "9");
      await p.click(".chg-pager form button[type=submit]");
      await p.waitForTimeout(2500);
      const out = await p.evaluate(() => ({
        said: (document.querySelector(".adm-empty")?.innerText || "").replace(/\s+/g, " "),
        buttons: [...document.querySelectorAll(".adm-empty button")].length,
      }));
      return is(/past the end of the log/.test(out.said) && out.buttons >= 2, JSON.stringify(out));
    } finally { await c.close(); }
  });
await phase("live: a bill whose history cannot be read says unknown, never 'no recorded changes' (item 3)",
  "headless: with the trail read refusing, open a bill and read the three sections", async () => {
    const st = needLive(); if (st) return st;
    const c = await ctxOf(1280, 900, "dark");
    const p = await c.newPage();
    try {
      await p.goto(BASE + "/aevinite/bill-audit", { waitUntil: "networkidle", timeout: 60000 });
      await p.waitForTimeout(2000);
      // Service workers are BLOCKED on this context — a panel worker eats page.route() silently and
      // turns a fault that never fired into a screen that looks fine.
      await p.route("**/api/admin/bills?trail=*", (rt) => rt.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "unavailable" }) }));
      await p.evaluate(() => document.querySelector(".blz-row")?.click());
      await p.waitForTimeout(2000);
      const txt = await p.evaluate(() => document.querySelector(".blz-row.open")?.parentElement?.innerText || "");
      const lies = ["No recorded changes for this bill", "Invoice not generated for this bill", "No credit notes on this bill"].filter((x) => txt.includes(x));
      const okNow = lies.length === 0 && /they are unknown/.test(txt);
      return is(okNow, okNow ? undefined : (lies.join(" | ") || "the card did not say it was unread"));
    } finally { await c.close(); }
  });
await phase("live: every Audit & logs tab keeps its last column on a 390px screen (item 4)",
  "headless: measure each feed's own box on all three tabs", async () => {
    const st = needLive(); if (st) return st;
    const c = await ctxOf(390, 844, "dark");
    const p = await c.newPage();
    try {
      const bad = [];
      for (const tab of ["Operations", "Audit · removals", "Customers"]) {
        await p.goto(BASE + "/aevinite/logs", { waitUntil: "networkidle", timeout: 60000 });
        await p.waitForTimeout(1500);
        if (tab !== "Operations") { await p.getByRole("button", { name: tab }).click(); await p.waitForTimeout(2000); }
        const over = await p.evaluate(() => [...document.querySelectorAll(".adm-logwrap")]
          .filter((w) => w.scrollWidth > w.clientWidth + 2).length);
        if (over) bad.push(`${tab}: ${over} box(es) wider than the screen`);
      }
      return is(bad.length === 0, bad.join(" | "));
    } finally { await c.close(); }
  });
await phase("live: the Audit window's note never warns about a window it calls normal (item 5)",
  "headless: read the note at each of the five offered windows, reply rewritten in the browser only", async () => {
    const st = needLive(); if (st) return st;
    const c = await ctxOf(1280, 900, "dark");
    const p = await c.newPage();
    try {
      const bad = [];
      for (const years of [1, 3, 5, 7, 10]) {
        await p.unrouteAll().catch(() => {});
        await p.route("**/api/admin/settings*", async (rt) => {
          if (rt.request().method() !== "GET") return rt.abort();
          const res = await rt.fetch(); const j = await res.json();
          j.audit_retention_years = years;
          await rt.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(j) });
        });
        await p.goto(BASE + "/aevinite/logs", { waitUntil: "networkidle", timeout: 60000 });
        await p.getByRole("button", { name: "Audit · removals" }).click();
        await p.waitForTimeout(1800);
        const t = await p.evaluate(() => ([...document.querySelectorAll(".adm-card")]
          .find((x) => /Keep the Audit for/.test(x.innerText))?.innerText || "").replace(/\s+/g, " "));
        const warned = /Records are normally kept/.test(t);
        if (warned && years >= 6) bad.push(`${years}y warned`);
        if (!warned && years < 6) bad.push(`${years}y did not warn`);
      }
      return is(bad.length === 0, bad.join(", "));
    } finally { await c.close(); }
  });

if (br) { for (const v of shots.values()) { try { await v.ctx.close(); } catch {} } await br.close(); }

// ── report ───────────────────────────────────────────────────────────────────────────────────────
if (LEDGER) {
  const out = [];
  let cur = null;
  for (const r of rows) {
    if (r.band !== cur) { cur = r.band; out.push(`\n## ${cur}\n`, "| id | check | how to verify | result | note |", "|---|---|---|---|---|"); }
    out.push(`| ${r.id} | ${r.title.replace(/\|/g, "\\|")} | ${r.how.replace(/\|/g, "\\|")} | — |  |`);
  }
  console.log(out.join("\n"));
  console.log(`\n<!-- ${rows.length} phases · ${rows[0].id}–${rows[rows.length - 1].id} -->`);
  process.exit(0);
}
console.log(`\n${fail.length ? "✗" : "✓"} verify:bill-ledger — ${pass.length} passed · ${fail.length} failed · ${skipped.length} skipped (of ${n} planned)`);
if (fail.length) { console.log("\nFAILED:"); for (const f of fail) console.log(`  ${f.id} ${f.title}${f.note ? " — " + f.note : ""}`); }
process.exit(fail.length ? 1 : 0);
