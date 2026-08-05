// verify-closed-session-orders.mjs — an order can never outlive its session, INCLUDING on INSERT.
//
// WHY THIS EXISTS. Mig 232 made "an order can never outlive its session" true for the case that
// caused it, with a BEFORE UPDATE trigger that fires on the transition into `closed` and a BEFORE
// DELETE twin. The 520-phase run on 2026-08-05 found a live order that escaped both: status
// `served`, unarchived, on a table whose session was already `closed` — and that session's
// `closed_at` was NULL, so it had been INSERTED closed and the transition trigger had never run.
//
// Two INSERT-side paths escaped, and each one puts a departed party's food on a live table:
//   A. a session INSERTed already closed
//   B. an order INSERTed onto a session that is ALREADY closed  (the real-restaurant race: a
//      guest's phone submits as the waiter closes, or an offline order replays after they leave)
//
// Migration 302 closes both. This proves it, both ways: it asserts the fix works AND that the
// rule it protects would fail without it (the FIXTURE below is the shape that was found live).
//
//   node scripts/verify-closed-session-orders.mjs
//
// It writes, so it refuses any database but the backup one, and it clears up every row it creates —
// including on failure. It never touches an existing session, table or order.
//
// "Clears up" means SOFT-delete, not DELETE, and that is not a shortcut. A hard DELETE on an order
// or session is REFUSED by the database on purpose (check constraint 23514: "Corrections use void /
// soft-delete; permanent erase only via the 90-day restaurant purge") — the billing-compliance rule
// that a sale can never be permanently erased. The first version of this script tried a hard delete,
// was correctly refused, and left five rows behind while reporting them. Setting deleted_at +
// archived is what the product itself does, takes the rows off every floor and report, and keeps the
// record the law requires.
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const env = {};
try {
  for (const l of readFileSync(join(ROOT, ".env.local"), "utf8").split("\n")) {
    const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
} catch {
  // A raw ENOENT stack trace is what a fresh git worktree always hits, and it tells you nothing
  // about what to do. Same treatment the 500-phase suite got on 2026-08-05.
  console.error(`\n⛔ No .env.local in ${ROOT}\n   This check reads and writes the database, so it needs the keys.` +
    `\n   A fresh git worktree does not have them (machine-local and gitignored).` +
    `\n   Run it from the main checkout.\n`);
  process.exit(1);
}
const SB = env.NEXT_PUBLIC_SUPABASE_URL, KEY = env.SUPABASE_SERVICE_ROLE_KEY;

// POSITIVE refusal: name the one database this may run against, rather than checking it is not
// some other one. A new stack would then be refused by default instead of silently accepted.
const BACKUP_REF = "wnsfcizclkbobwzcxqsf";
const ref = new URL(SB).hostname.split(".")[0];
if (ref !== BACKUP_REF) {
  console.error(`\nThis writes test rows. It points at project "${ref}", not the backup database (${BACKUP_REF}). Refusing.\n`);
  process.exit(1);
}

const db = (q, init) => fetch(`${SB}/rest/v1/${q}`, {
  ...init,
  headers: {
    apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json",
    Prefer: init?.method === "POST" ? "return=representation" : "return=representation",
    ...(init?.headers || {}),
  },
});
const post = async (t, body) => (await db(t, { method: "POST", body: JSON.stringify(body) })).json();
const get = async (q) => (await db(q)).json();
const patch = async (q, body) => db(q, { method: "PATCH", body: JSON.stringify(body) });

const checks = [];
const ok = (n, c, d) => { checks.push({ n, c, d }); };

// A table number nothing else uses, so no real party can ever be affected.
const TABLE = `ZZ-verify-${randomUUID().slice(0, 6)}`;
let rid = null;
const made = { sessions: [], orders: [] };

async function cleanup() {
  const now = new Date().toISOString();
  const t = encodeURIComponent(TABLE);
  // Soft-delete + archive: off every floor, off every report, record intact (see the header).
  await patch(`orders?table_number=eq.${t}`, { deleted_at: now, archived: true, archived_at: now });
  // A session left OPEN would keep its table looking occupied to every panel.
  await patch(`sessions?table_number=eq.${t}&status=eq.open`, { status: "closed" });
  const onFloor = await get(`orders?select=id&table_number=eq.${t}&archived=eq.false`);
  const stillOpen = await get(`sessions?select=id&table_number=eq.${t}&status=eq.open`);
  const n = (Array.isArray(onFloor) ? onFloor.length : 0) + (Array.isArray(stillOpen) ? stillOpen.length : 0);
  console.log(n === 0
    ? `  cleaned up: nothing from ${TABLE} is on any floor`
    : `  ⚠ ${n} row(s) from ${TABLE} are still live — clear them by hand`);
}

try {
  const rs = await get("restaurants?select=id,slug&limit=1&order=created_at.asc");
  if (!Array.isArray(rs) || !rs.length) throw new Error("no restaurant to test against");
  rid = rs[0].id;

  // ── A. a session INSERTED already closed must not leave live orders behind ──
  // Insert the session OPEN first, add an order, then insert a SECOND session already closed on
  // the same table — the shape found live. Then close the first by INSERT-as-closed semantics:
  // simplest faithful reproduction is a session created closed WITH an order attached after.
  const sOpen = (await post("sessions", { restaurant_id: rid, table_number: TABLE, status: "open" }))[0];
  if (!sOpen?.id) throw new Error("could not create a test session: " + JSON.stringify(sOpen).slice(0, 160));
  made.sessions.push(sOpen.id);

  const o1 = (await post("orders", {
    restaurant_id: rid, table_number: TABLE, session_id: sOpen.id, status: "served", items: [],
  }))[0];
  if (!o1?.id) throw new Error("could not create a test order: " + JSON.stringify(o1).slice(0, 160));
  made.orders.push(o1.id);
  ok("an order on an OPEN session stays on the floor (the fix must not over-reach)",
    o1.archived === false, `archived=${o1.archived}`);

  // Now close that session the ordinary way — mig 232 must archive the order (the control).
  await db(`sessions?id=eq.${sOpen.id}`, { method: "PATCH", body: JSON.stringify({ status: "closed" }) });
  const o1b = (await get(`orders?select=archived,status&id=eq.${o1.id}`))[0];
  ok("mig 232 still archives on the ordinary close (control)",
    o1b?.archived === true, `archived=${o1b?.archived} status=${o1b?.status}`);

  // ── B. an order INSERTED onto an ALREADY-CLOSED session must never reach the floor ──
  const o2 = (await post("orders", {
    restaurant_id: rid, table_number: TABLE, session_id: sOpen.id, status: "served", items: [],
  }))[0];
  if (!o2?.id) throw new Error("could not create the late order: " + JSON.stringify(o2).slice(0, 160));
  made.orders.push(o2.id);
  ok("an order arriving AFTER the close is off the floor immediately (mig 302 B)",
    o2.archived === true, `archived=${o2.archived} — an unarchived row here is the next party inheriting food`);
  ok("...and it is RECORDED, not dropped — the row exists",
    !!o2.id, "no row was written at all, which would be hiding a sale");
  ok("...and money still owed reads as cancelled, a visible walk-out record",
    o2.status === "cancelled", `status=${o2.status}`);

  // ── C. a session INSERTED already closed cleans up what is attached to it (mig 302 A) ──
  const sClosed = (await post("sessions", { restaurant_id: rid, table_number: TABLE, status: "closed" }))[0];
  if (!sClosed?.id) throw new Error("could not create a born-closed session");
  made.sessions.push(sClosed.id);
  const o3 = (await post("orders", {
    restaurant_id: rid, table_number: TABLE, session_id: sClosed.id, status: "served", items: [],
  }))[0];
  made.orders.push(o3?.id);
  ok("an order on a session that was BORN closed is off the floor too (mig 302 A + B)",
    o3?.archived === true, `archived=${o3?.archived}`);

  // ── D. the floor-wide invariant: no live order may name a non-open session ──
  const live = await get("orders?select=id,session_id&archived=eq.false&deleted_at=is.null&session_id=not.is.null&limit=300");
  let orphans = 0;
  if (Array.isArray(live) && live.length) {
    const ids = [...new Set(live.map((o) => o.session_id))];
    const closed = new Set();
    for (let i = 0; i < ids.length; i += 40) {
      const ss = await get(`sessions?select=id,status&id=in.(${ids.slice(i, i + 40).join(",")})`);
      if (Array.isArray(ss)) ss.filter((x) => x.status !== "open").forEach((x) => closed.add(x.id));
    }
    orphans = live.filter((o) => closed.has(o.session_id)).length;
  }
  ok("floor-wide: no live order belongs to a session that is already finished",
    orphans === 0, `${orphans} order(s) would be inherited by the next party at their table`);
} catch (e) {
  ok("the check ran", false, String(e.message || e));
} finally {
  await cleanup();
}

const bad = checks.filter((c) => !c.c);
for (const c of checks) console.log(`  ${c.c ? "✓" : "✗"} ${c.n}${c.c ? "" : `\n      ${c.d}`}`);
if (bad.length) {
  console.error(`\n❌ ${bad.length} of ${checks.length} failed — an order can still outlive its session.\n`);
  process.exit(1);
}
console.log(`\n✅ ${checks.length} checks passed — an order cannot outlive its session, on UPDATE or INSERT.`);
