// scripts/verify-recycle-bin.mjs — the RECYCLE BIN's rules, against a running app.
//
// ── WHAT THIS GUARDS, AND WHY IT IS A LIVE CHECK ──────────────────────────────────────────────
// Three owner decisions from 2026-08-20, all of them things a source-read cannot prove:
//
//   1. A permanent removal has NO WAITING PERIOD. The 90-day retention lock was enforced in TWO
//      places — the route and the SQL function admin_purge_restaurant — and migration 342 removed
//      the SQL half. A stack whose migrations are behind would still raise `Retention lock`, and
//      the only way to know is to actually purge something.
//   2. Restoring into a taken web address ASKS instead of renaming silently, and NOTHING is
//      written until the admin answers.
//   3. A binned restaurant's panels open only for an explicit opt-in from the bin — the plain
//      act-as doors still refuse.
//
// Companion to verify-recycle-name.mjs (which owns the OWNER half — mig 245's name clash) and to
// verify-admin-restaurants.mjs (which reads the screen's source). This one drives the endpoints.
//
// SAFETY, the same rules the rest of scripts/sweep follows:
//   · Admin cookie only — it NEVER posts to /api/staff-login, so it can't trip the login limiter.
//   · It creates its own restaurants, prefixed ZZ-RBIN, and deletes EXACTLY those, BY ID, in the
//     same run — never "whatever is there". A pre-existing ZZ row from another session is left
//     alone.
//   · Read-only against every restaurant it did not create.
//
// Usage:  node scripts/verify-recycle-bin.mjs [--base http://localhost:4000]

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { adminHeaders } from "./sweep/login.mjs";
import { refuseUnlessDevTestDb } from "./sweep/devStacks.mjs";
import { requireUp } from "./sweep/appUp.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const BASE = (args[args.indexOf("--base") + 1] || "").startsWith("http")
  ? args[args.indexOf("--base") + 1] : "http://localhost:4000";

// Nothing answering = "could not run" (exit 2), said in plain words — never a raw ECONNREFUSED
// stack, which reads as "this guard is broken". (sweep #6 / T28, 2026-08-22)
await requireUp(BASE, "the recycle-bin walk");
const env = Object.fromEntries(
  readFileSync(join(root, ".env.local"), "utf8").split(/\r?\n/)
    .filter((l) => /^\s*[A-Z0-9_]+\s*=/i.test(l))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }),
);
// This script CREATES AND DELETES restaurants, so it must never point at the client stack.
refuseUnlessDevTestDb(env.NEXT_PUBLIC_SUPABASE_URL, "this creates and removes test restaurants");
const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];

async function raw(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(t);
  return JSON.parse(t);
}

const H = { ...adminHeaders(BASE), "Content-Type": "application/json" };
const api = (p, init) => fetch(BASE + p, { ...init, headers: H });
const post = (body) => api("/api/admin/restaurants", { method: "POST", body: JSON.stringify(body) });

let failed = 0;
const want = (cond, label, extra = "") => {
  if (!cond) failed++;
  console.log(`  ${cond ? "✓" : "✗"} ${label}${extra ? ` — ${extra}` : ""}`);
};

const made = [];
const TAG = `ZZ-RBIN ${Date.now().toString(36)}`;

async function mk(suffix) {
  const r = await post({ action: "create_restaurant", name: `${TAG} ${suffix}`, seedMenu: false, panels: { manager: true, kitchen: false, tablet: false, owner: false } });
  const d = await r.json();
  if (!r.ok) throw new Error(`create failed: ${JSON.stringify(d)}`);
  const id = d.restaurant?.id || d.id;
  made.push(id);
  return id;
}
const bin = (id) => post({ action: "soft_delete_restaurant", restaurant_id: id, reason: "verify:recycle-bin" });
const restore = (id, resolve) => post({ action: "restore_restaurant", restaurant_id: id, activate: false, ...(resolve ? { resolve } : {}) });

try {
  console.log(`\nRecycle bin — the rules, live (${BASE})\n`);

  // ── 1 · A binned restaurant does not reserve its web address, and a clash is a QUESTION ──────
  const a = await mk("A");
  const aSlug = (await raw(`select slug from restaurants where id='${a}'`))[0].slug;
  await bin(a);
  const b = await mk("A");            // same name → wants the same address
  want((await raw(`select slug from restaurants where id='${b}'`))[0].slug === aSlug,
    "a restaurant in the bin no longer reserves its web address (mig 319)");

  const clash = await restore(a);
  const cb = await clash.json();
  want(clash.status === 409 && !!cb.conflict,
    "restoring into a taken address ASKS instead of renaming silently", `status ${clash.status}`);
  want(!!cb.conflict?.suggestedName && !!cb.conflict?.suggestedSlug,
    "the question arrives with a suggestion the admin can accept in one press");
  const untouched = (await raw(`select deleted_at, slug, name from restaurants where id='${a}'`))[0];
  want(untouched.deleted_at !== null && untouched.slug === aSlug,
    "the refusal wrote NOTHING — it is still in the bin under its own name");

  // ── 2 · Change the name and restore ──────────────────────────────────────────────────────────
  const newName = `${TAG} A (old)`;
  const newSlug = `zz-rbin-${Date.now().toString(36)}-old`;
  const done = await restore(a, { name: newName, slug: newSlug });
  const dd = await done.json();
  want(done.ok && dd.restored === true, "answering the question restores it", `status ${done.status}`);
  const back = (await raw(`select name, slug, deleted_at, active from restaurants where id='${a}'`))[0];
  want(back.name === newName && back.slug === newSlug && back.deleted_at === null,
    "the database agrees with what the response said");
  want(back.active === false, "it comes back SUSPENDED, never silently live");
  want((await raw(`select slug from restaurants where id='${b}'`))[0].slug === aSlug,
    "the LIVE restaurant kept the address — its QR codes are on real tables");
  const tooShort = await restore(a, { name: "x", slug: "x" });
  want(tooShort.status === 400 || tooShort.status === 409, "a one-character rename is refused");

  // ── 3 · A permanent removal has no waiting period ────────────────────────────────────────────
  await bin(b);
  const listed = (await (await api("/api/admin/restaurants?deleted=1")).json()).trashed.find((t) => t.id === b);
  want(listed?.canPurge === true, "the bin offers removal the moment something is in it");
  want(typeof listed?.daysHeld === "number" && listed.daysLeft === undefined,
    "it reports how long it has SAT there, not a countdown to a permission");
  const purged = await post({ action: "purge_restaurant", restaurant_id: b });
  const pd = await purged.json();
  want(purged.ok && pd.purged === true,
    "a restaurant binned seconds ago can be removed for good — no 423, no retention lock",
    `status ${purged.status}${pd.error ? ` · ${pd.error}` : ""}`);
  want(pd.billsKept === true, "and the removal still says out loud that the money was kept");
  want((await restore(b)).status === 409, "a removed restaurant can no longer be restored");

  // ── 4 · Walking into a binned restaurant is an explicit ask ──────────────────────────────────
  const c = await mk("C");
  await bin(c);
  want((await api("/api/admin/act-as", { method: "POST", body: JSON.stringify({ restaurant_id: c }) })).status === 409,
    "the plain act-as door still refuses a binned restaurant");
  want((await api("/api/admin/act-as", { method: "POST", body: JSON.stringify({ restaurant_id: c, bin: true }) })).ok,
    "the recycle bin's own opt-in gets in");
  want((await api("/api/admin/act-as", { method: "POST", body: JSON.stringify({ restaurant_id: b, bin: true }) })).status === 409,
    "a REMOVED restaurant's panels are refused even with the opt-in — there is nothing left in them");
  await api("/api/admin/act-as", { method: "POST", body: JSON.stringify({ clear: true }) });
  const stillBinned = (await raw(`select deleted_at from restaurants where id='${c}'`))[0];
  want(stillBinned.deleted_at !== null, "looking inside restored nothing — it is still in the bin");

  // ── 5 · What is inside it ────────────────────────────────────────────────────────────────────
  const det = await (await api(`/api/admin/restaurants?bin_detail=${c}`)).json();
  const inside = det.inside || {};
  const counted = ["categories", "dishes", "staff", "tables", "orders", "sessions", "savedCustomers", "unpaidPayLaterBills", "feedback"];
  const nulls = counted.filter((k) => inside[k] === null || inside[k] === undefined);
  want(nulls.length === 0,
    "every count inside a binned restaurant is a real number, not an unread '?'",
    nulls.length ? `unread: ${nulls.join(", ")}` : "");
  want(typeof inside.staffByRole === "object" && (inside.staff || 0) >= 1,
    "it reports the staff logins that would go with a permanent removal");
  want((await api("/api/admin/restaurants?bin_detail=not-a-uuid")).status === 404,
    "a malformed id is shape-checked, never a raw database error");
} finally {
  // ── CLEANUP — exactly the rows this run created, by id ────────────────────────────────────────
  // Two triggers make a hard delete of a restaurant fight itself: deleting a staff_actions row
  // emits a realtime_events breadcrumb, and the restaurants delete's own audit trigger writes
  // another staff_actions row naming the restaurant it just deleted. So breadcrumbs go LAST and
  // that one trigger is held off for the transaction. (The product never hard-deletes a restaurant
  // for exactly this reason — a purge marks purged_at and keeps the row.)
  const ids = made.filter(Boolean).map((i) => `'${i}'`).join(",");
  if (ids) {
    await raw(`begin;
      alter table restaurants disable trigger trg_manual_edit_restaurants;
      delete from settings          where restaurant_id in (${ids});
      delete from staff_users       where restaurant_id in (${ids});
      delete from restaurant_owners where restaurant_id in (${ids});
      update restaurants set owner_user_id = null where id in (${ids});
      delete from staff_actions     where restaurant_id in (${ids});
      delete from realtime_events   where restaurant_id in (${ids});
      delete from restaurants       where id in (${ids});
      alter table restaurants enable trigger trg_manual_edit_restaurants;
    commit;`);
    const left = await raw(`select id from restaurants where id in (${ids})`);
    want(left.length === 0, "cleanup — every restaurant this run created is gone", `${left.length} left`);
    const tg = (await raw(`select tgenabled from pg_trigger where tgname='trg_manual_edit_restaurants'`))[0];
    want(tg?.tgenabled === "O", "cleanup — the audit trigger is back on");
  }
}

console.log(failed
  ? `\n✗ ${failed} check${failed === 1 ? "" : "s"} failed — the recycle bin is not behaving as the owner asked\n`
  : "\n✓ the recycle bin frees a name, asks before renaming, opens up, and removes with no waiting period\n");
process.exit(failed ? 1 : 0);
