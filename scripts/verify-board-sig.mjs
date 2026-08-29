// Verifies the kitchen/tablet "redraw guard" (boardSig) is BULLETPROOF: the panels
// skip render() when boardSig is unchanged, so the fingerprint must flip for ANY
// field that affects what's drawn — including fields added in the future. The old
// hand-picked field list silently missed allergy/note edits (they only showed after
// a MANUAL refresh, which resets lastSig). The fix serializes the full rows minus a
// few heartbeat-only columns. This test must mirror the boardSig in
// public/panels/{kitchen,tablet}/app.js.
//   node scripts/verify-board-sig.mjs

// ---- OLD kitchen sig (the original buggy allow-list) — for the regression proof ----
const kitchenSigOld = (d) => JSON.stringify([
  (d.orders || []).map((o) => [o.id, o.status, o.kot_no]),
  (d.items || []).map((i) => [i.id, i.status]),
  (d.dishes || []).map((x) => [x.id, (x.tags || []).includes("sold-out")]),
]);

// ---- BULLETPROOF sig (must match the panels) ----
const RT_VOLATILE = new Set(["last_activity_at", "updated_at", "cart_updated_at", "served_at"]);
const stableRow = (row) => { const o = {}; for (const k in (row || {})) if (!RT_VOLATILE.has(k)) o[k] = row[k]; return o; };
const kitchenSig = (d) => JSON.stringify([
  (d.orders || []).map(stableRow), (d.items || []).map(stableRow), (d.dishes || []).map(stableRow),
]);
// TWO-TIER tablet sig (mig 101 — must mirror public/panels/tablet/app.js boardSig). The GRID
// draws from the slim server `summary`; the DETAIL draws from the SELECTED table's full slice in
// `data`. So the sig hashes the whole summary PLUS the selected table's rows. `d.table` = which
// table's detail is open. Unselected tables have no rows in `data` (the whole point of two-tier),
// so a grid change is caught ONLY via the summary — which is why it's hashed whole here.
const tabletSig = (d) => {
  const t = d.table != null ? String(d.table) : null;
  const data = d.data || {};
  const selRows = t == null ? [] : [
    (data.sessions || []).filter((s) => String(s.table_number) === t).map(stableRow),
    (data.orders || []).filter((o) => String(o.table_number) === t).map(stableRow),
    (data.calls || []).filter((c) => String(c.table_number) === t).map(stableRow),
    (data.requests || []).filter((r) => String(r.table_number) === t).map(stableRow),
    (data.members || []).map(stableRow),
    (data.items || []).map(stableRow),
  ];
  return JSON.stringify([d.summary || {}, t, selRows, stableRow(data.settings || {})]);
};

let pass = true;
const check = (label, cond) => { console.log((cond ? "✓ " : "✗ ") + label); if (!cond) pass = false; };
const clone = (x) => JSON.parse(JSON.stringify(x));

const kb = { orders: [{ id: "o1", status: "preparing", kot_no: 5, allergies: [], items: [] }], items: [{ id: "i1", order_id: "o1", status: "preparing", removed: [], note: "", options: [] }], dishes: [{ id: "d1", title: "X", tags: [] }] };

// 1) Regression proof: the OLD allow-list sig IGNORED an allergy edit (the bug).
{ const after = clone(kb); after.orders[0].allergies = ["nuts"]; check("OLD sig ignored allergy edit (bug reproduced)", kitchenSigOld(kb) === kitchenSigOld(after)); }

// 2) Every known editable field now flips the kitchen sig.
const kFlip = (mut) => { const c = clone(kb); mut(c); return kitchenSig(kb) !== kitchenSig(c); };
check("kitchen sig flips on order allergy", kFlip((c) => c.orders[0].allergies = ["nuts"]));
check("kitchen sig flips on dish note", kFlip((c) => c.items[0].note = "extra hot"));
check("kitchen sig flips on dish options", kFlip((c) => c.items[0].options = [{ label: "large" }]));
check("kitchen sig flips on dish removed", kFlip((c) => c.items[0].removed = ["onion"]));
check("kitchen sig flips on sold-out tag", kFlip((c) => c.dishes[0].tags = ["sold-out"]));
// 3) FUTURE-PROOF: a brand-new column nobody listed still flips the sig.
check("kitchen sig flips on a NEW unforeseen field (order)", kFlip((c) => c.orders[0].spice_level = 3));
check("kitchen sig flips on a NEW unforeseen field (dish)", kFlip((c) => c.items[0].gift_wrap = true));
// 4) Heartbeat-only fields do NOT churn the sig (no needless repaints).
check("kitchen sig IGNORES served_at-only change (no churn)", !kFlip((c) => c.items[0].served_at = "2026-01-01"));

// Two-tier shape: table "3" is the SELECTED table (its slice lives in `data`); `summary` is the
// slim grid the server computes for ALL tables. Detail edits mutate `data`; grid changes mutate
// `summary`.
const tb = {
  table: "3",
  summary: { tiles: { "3": { state: "prep", label: "Preparing", meta: "0/2 served", counts: { nw: 0, ck: 2, rd: 0, sv: 0 }, due: 0, pay: "", reqs: 0, pending: 0, hasNew: false, hasCall: false, hasReq: false, hasJoin: false } }, calls: [], requests: [], joiners: [], blocklist: [] },
  data: {
    sessions: [{ id: "s1", table_number: "3", status: "open", bill_no: 1, auto_approve: false, cart: [], last_activity_at: "t0" }],
    orders: [{ id: "o1", table_number: "3", status: "preparing", total: 100, kot_no: 5, payment_status: "pending", discount: 0, allergies: [] }],
    items: [{ id: "i1", order_id: "o1", status: "preparing", removed: [], note: "", options: [] }],
    calls: [], members: [{ id: "m1", session_id: "s1", approved: true, removed: false, role: "guest", name: "A" }],
    requests: [], settings: { table_count: 12 },
  },
};
const tFlip = (mut) => { const c = clone(tb); mut(c); return tabletSig(tb) !== tabletSig(c); };
// DETAIL edits (selected table's slice in `data`) must flip the sig so the open detail repaints.
check("tablet sig flips on auto-approve", tFlip((c) => c.data.sessions[0].auto_approve = true));
check("tablet sig flips on building cart", tFlip((c) => c.data.sessions[0].cart = [{ id: "x", qty: 1 }]));
check("tablet sig flips on discount", tFlip((c) => c.data.orders[0].discount = 20));
check("tablet sig flips on order allergy", tFlip((c) => c.data.orders[0].allergies = ["nuts"]));
check("tablet sig flips on dish note", tFlip((c) => c.data.items[0].note = "no ice"));
check("tablet sig flips on member rename", tFlip((c) => c.data.members[0].name = "Bob"));
check("tablet sig flips on a NEW unforeseen field", tFlip((c) => c.data.orders[0].loyalty_tier = "gold"));
check("tablet sig IGNORES last_activity_at heartbeat (no churn)", !tFlip((c) => c.data.sessions[0].last_activity_at = "t1"));
// GRID changes (the slim summary) must ALSO flip the sig — this is the two-tier-specific guard:
// an unselected table changes ONLY in `summary`, so without hashing it the grid would never repaint.
check("tablet sig flips on a summary tile state change (grid)", tFlip((c) => c.summary.tiles["3"].state = "ready"));
check("tablet sig flips on a summary tile count change (grid)", tFlip((c) => c.summary.tiles["3"].counts.rd = 1));
check("tablet sig flips on a NEW summary tile appearing (grid)", tFlip((c) => c.summary.tiles["7"] = { state: "new", label: "New order" }));
check("tablet sig flips on a pending waiter call in summary (grid)", tFlip((c) => c.summary.calls = [{ id: "c1", table_number: "5", resolved: false }]));

// ── DRIFT CHECK — the copies above must still BE what the panels ship ─────────────────────
// Everything before this point tests functions written out in THIS file. That proves the
// design is sound and proves nothing about the product: if someone narrowed the real boardSig
// back to a hand-picked field list, every check above would stay green while allergy and note
// edits went back to needing a manual refresh — the exact 2026-06-17 bug this file exists to
// stop. So read the shipped panels and require that what they contain still matches.
// (T4 sweep, 2026-08-04.)
import { readFileSync, existsSync } from "node:fs";
import { repoRootFrom } from "./sweep/repoRoot.mjs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// The repo to scan: the first argument that really IS one, else the repo this file lives in.
// It used to be a bare `process.argv[2]`, so `-- --base http://localhost:4228` — which every
// sweep lane passes to every guard — made this scan a folder called "--base" and exit 1.
// (T28, sweep #7, 2026-08-29; the same fault as verify:test-safety's, in seven more guards.)
const ROOT = repoRootFrom(import.meta.url);
const panelSrc = (name) => {
  const f = join(ROOT, "public", "panels", name, "app.js");
  return existsSync(f) ? readFileSync(f, "utf8") : null;
};
// The one line that decides everything: the row serialiser must keep EVERY key except the
// volatile ones. A hand-picked allow-list cannot be written in this shape.
const STABLE_ROW = /const stableRow = \(row\) => \{ const o = \{\}; for \(const k in \(row \|\| \{\}\)\) if \(!RT_VOLATILE\.has\(k\)\) o\[k\] = row\[k\]; return o; \};/;
const VOLATILE = /const RT_VOLATILE = new Set\(\[([^\]]*)\]\);/;
const wantVolatile = [...RT_VOLATILE].sort().join(",");

for (const panel of ["kitchen", "tablet"]) {
  const src = panelSrc(panel);
  if (!src) { check(`${panel}/app.js found`, false); continue; }
  check(`${panel}: the shipped stableRow still keeps every non-volatile field`, STABLE_ROW.test(src));
  const m = src.match(VOLATILE);
  const got = m ? m[1].split(",").map((x) => x.trim().replace(/^["']|["']$/g, "")).filter(Boolean).sort().join(",") : "(not found)";
  check(`${panel}: RT_VOLATILE matches the set tested here`, got === wantVolatile,
    got === wantVolatile ? "" : `panel has [${got}], this file tests [${wantVolatile}]`);
  // And the fingerprint must actually be BUILT from stableRow, not from a literal field list.
  const sigFn = (src.match(/function boardSig\(d\) \{[\s\S]{0,900}?\n\}/) || [])[0] || "";
  check(`${panel}: boardSig is built from stableRow`, /stableRow/.test(sigFn),
    sigFn ? "" : "could not find boardSig() in the panel");
}

console.log("\n" + (pass ? "ALL PASS" : "SOME FAILED"));
process.exit(pass ? 0 : 1);
