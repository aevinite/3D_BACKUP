// verify-staff-accounts.mjs — end-to-end stress test for the staff account /
// profile system (one "Name" + password, one-time profile_confirmed card, sync,
// and operation-log behaviour). Runs against the dev server on :4000.
//
//   node scripts/verify-staff-accounts.mjs
//
// It creates a batch of throwaway users (prefix "zztest_"), exercises every edge
// case, then DELETES them all. Never prints passwords or the admin secret.
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { requireUp } from "./sweep/appUp.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const parseEnv = (t) =>
  Object.fromEntries(t.split("\n").filter((l) => l.includes("=") && !l.trim().startsWith("#")).map((l) => {
    const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
  }));
const env = parseEnv(readFileSync(join(root, ".env.local"), "utf8"));
// RUNNABLE FROM A WORKTREE (sweep #6, terminal 13, 2026-08-18). The base was hard-coded to :4000,
// which is the owner's own window — a sweep lane is given its own port precisely so it never points
// anything there, so this guard could not be run at all from a worktree (and simply failed with
// connection errors whenever :4000 was not up). Default is unchanged, so an ordinary
// `npm run verify:staff-accounts` behaves exactly as before.
//   node scripts/verify-staff-accounts.mjs --base http://localhost:4113
const argBase = (() => { const i = process.argv.indexOf("--base"); return i > -1 ? process.argv[i + 1] : null; })();
const BASE = argBase || process.env.LFH_BASE || "http://localhost:4000";
const ADMIN = env.ADMIN_PASSWORD;
// Nothing answering = "could not run" (exit 2), said in plain words — never a raw ECONNREFUSED
// stack, which reads as "this guard is broken". (sweep #6 / T28, 2026-08-22)
await requireUp(BASE, "the staff-accounts walk");
if (!ADMIN) throw new Error("ADMIN_PASSWORD missing from .env.local");
// The admin gate stores sha256hex(password) in the lfh_staff_auth cookie — compute
// it directly so we never have to round-trip (or print) the password.
const adminCookie = "lfh_staff_auth=" + createHash("sha256").update(ADMIN).digest("hex");

let pass = 0, fail = 0;
const results = [];
function check(name, cond, extra = "") {
  if (cond) { pass++; results.push(`  ✓ ${name}`); }
  else { fail++; results.push(`  ✗ ${name}${extra ? " — " + extra : ""}`); }
}

async function api(path, { method = "GET", body, cookie } = {}) {
  const headers = {};
  if (body) headers["Content-Type"] = "application/json";
  if (cookie) headers["Cookie"] = cookie;
  const r = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined, redirect: "manual" });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  const setCookie = r.headers.get("set-cookie") || "";
  const userCookie = (setCookie.match(/lfh_user=[^;]+/) || [])[0] || null;
  return { status: r.status, json, userCookie };
}

const created = []; // {id, name, password}
async function createUser(name, role, { phone, password, tables } = {}) {
  const r = await api("/api/admin/users", { method: "POST", cookie: adminCookie, body: { name, role, phone, password, tables } });
  if (r.status === 200 && r.json?.id) created.push({ id: r.json.id, name, password: r.json.password });
  return r;
}

(async () => {
  console.log("→ staff account stress test\n");

  // ── 0. PRE-CLEAN ──────────────────────────────────────────────────────────
  // Only the END of this run deleted its users, so ANY interrupted run (a crash, a
  // ctrl-C, a failed assertion) left "zztest …" accounts behind — and then the next run's
  // very first create answered 409 "duplicate name", never recorded that user, and the
  // script died with `Cannot read properties of undefined (reading 'password')`. It had been
  // failing that way with 8 stale accounts sitting in the dev DB. Clearing them first makes
  // the run repeatable instead of one-shot. (2026-07-30)
  // SCOPED TO THE NAMES THIS SCRIPT ITSELF USES (sweep #6, terminal 13, 2026-08-18).
  // This was `/^zztest/i` — "delete whatever is there". With several sweep lanes sharing one dev
  // database that is the exact filter the project's own test-safety rule forbids: it can remove
  // another run's in-flight fixtures, which then looks like a product fault to whoever owns them.
  // The purpose here is only to make THIS script repeatable after a crash, and for that it needs
  // nothing wider than its own ten names (defined just below, and re-used here).
  const stale = await api("/api/admin/users", { cookie: adminCookie });
  const OWN = [
    "zztest Alpha", "zztest Beta", "zztest Gamma", "zztest Delta", "zztest Echo",
    "zztest Foxtrot", "zztest Golf", "zztest Hotel", "zztest India", "zztest Juliet",
    "zztest BadRole", "zztest ShortPw", "zztest NoAuth", "zztest Alpha Renamed",
  ].map((n) => n.toLowerCase().replace(/\s+/g, " ").trim());
  const staleZz = (stale.json?.users || stale.json || []).filter?.((u) => {
    const key = String(u.username || u.name || "").toLowerCase().replace(/\s+/g, " ").trim();
    return OWN.includes(key);
  }) || [];
  for (const u of staleZz) await api(`/api/admin/users?id=${encodeURIComponent(u.id)}`, { method: "DELETE", cookie: adminCookie });
  if (staleZz.length) console.log(`   (pre-clean removed ${staleZz.length} leftover zztest account(s) from an earlier run)\n`);

  // ── 1. CREATE 10 users across roles, varied names ─────────────────────────
  const roles = ["manager", "kitchen", "tablet"];
  const names = [
    "zztest Alpha", "zztest Beta", "zztest Gamma", "zztest Delta", "zztest Echo",
    "zztest Foxtrot", "zztest Golf", "zztest Hotel", "zztest India", "zztest Juliet",
  ];
  // A WAITER (tablet role) must be given at least one table — that is deliberate product
  // behaviour, not a bug: "an empty pick is refused rather than quietly creating a waiter whose
  // tablet shows nothing" (lib/tableAssign.ts, owner's choice). This script predates it, so every
  // tablet-role create was answered 400 and the user never landed in `created` — which is why it
  // died later on `undefined.password`. Give waiters a table, the way the real form does. (2026-07-30)
  for (let i = 0; i < names.length; i++) {
    const withPhone = i % 2 === 0;
    const role = roles[i % 3];
    const extra = { ...(withPhone ? { phone: "555000" + i } : {}), ...(role === "tablet" ? { tables: [1, 2, 3] } : {}) };
    const r = await createUser(names[i], role, extra);
    check(`create #${i + 1} "${names[i]}" (${role})`, r.status === 200 && !!r.json?.id, `status ${r.status} ${JSON.stringify(r.json)}`);
  }

  // ── 2. EDGE CASES on creation ─────────────────────────────────────────────
  check("duplicate name rejected (409)", (await createUser("zztest Beta", "kitchen")).status === 409);
  check("case/space-only duplicate rejected (409)", (await createUser("  ZZTEST   beta ", "kitchen")).status === 409);
  check("1-char name rejected (400)", (await createUser("z", "kitchen")).status === 400);
  check("empty name rejected (400)", (await createUser("   ", "kitchen")).status === 400);
  check("bad role rejected", (await api("/api/admin/users", { method: "POST", cookie: adminCookie, body: { name: "zztest BadRole", role: "ceo" } })).status === 400);
  check("short password rejected (400)", (await createUser("zztest ShortPw", "tablet", { password: "123" })).status === 400);
  check("admin endpoint blocks no-cookie (401)", (await api("/api/admin/users", { method: "POST", body: { name: "zztest NoAuth", role: "tablet" } })).status === 401);

  // ── 3. LOGIN with normalization + first-login card ────────────────────────
  const alpha = created.find((c) => c.name === "zztest Alpha");
  // Log in using messy case/spacing — must normalize to the same account.
  const login1 = await api("/api/panel-login", { method: "POST", body: { username: "  ZZTEST   alpha ", password: alpha.password } });
  check("login normalizes name (messy case/space)", login1.status === 200 && login1.json?.ok === true, `status ${login1.status}`);
  check("fresh user needsProfile=true", login1.json?.needsProfile === true);
  const alphaCookie = login1.userCookie;
  check("login set a user cookie", !!alphaCookie);

  // wrong password
  check("wrong password rejected (401)", (await api("/api/panel-login", { method: "POST", body: { username: "zztest Alpha", password: "totally-wrong" } })).status === 401);

  // ── 4. PROFILE GET/POST + confirm-once ────────────────────────────────────
  const prof1 = await api("/api/panel-profile", { cookie: alphaCookie });
  check("profile GET ok + needsProfile true", prof1.status === 200 && prof1.json?.needsProfile === true);
  check("profile GET exposes no password_hash", prof1.json && !("password_hash" in prof1.json));
  // confirm with phone
  // Setup counts as done only when the welcome card's asks are ALL met. For a manager who is
  // allowed to set their own PIN that includes the PIN (app/api/panel-profile: "must also HAVE a
  // PIN before setup is complete"), which arrived after this script was written — so name+phone
  // alone left needsProfile TRUE and three checks below failed on stale expectations, not a bug.
  const save1 = await api("/api/panel-profile", { method: "POST", cookie: alphaCookie, body: { name: "zztest Alpha", phone: "5551234567", pin: "4729" } });
  check("profile save (confirm) ok", save1.status === 200 && save1.json?.ok === true);
  const prof2 = await api("/api/panel-profile", { cookie: alphaCookie });
  check("after confirm needsProfile=false", prof2.json?.needsProfile === false);
  check("phone synced on account", prof2.json?.phone === "5551234567");
  // re-login → still confirmed (sticks)
  const login2 = await api("/api/panel-login", { method: "POST", body: { username: "zztest Alpha", password: alpha.password } });
  check("re-login keeps needsProfile=false", login2.json?.needsProfile === false);

  // ── 5. RENAME via profile + uniqueness ────────────────────────────────────
  const rename = await api("/api/panel-profile", { method: "POST", cookie: alphaCookie, body: { name: "zztest Alpha Renamed", phone: "5551234567" } });
  check("self-rename ok", rename.status === 200);
  check("login works with NEW name", (await api("/api/panel-login", { method: "POST", body: { username: "zztest Alpha Renamed", password: alpha.password } })).status === 200);
  check("login fails with OLD name", (await api("/api/panel-login", { method: "POST", body: { username: "zztest Alpha", password: alpha.password } })).status === 401);
  // try to rename to someone else's name → 409
  const clash = await api("/api/panel-profile", { method: "POST", cookie: alphaCookie, body: { name: "zztest Beta", phone: "5551234567" } });
  check("self-rename to taken name rejected (409)", clash.status === 409);

  // ── 6. EDIT only phone must NOT break login name ──────────────────────────
  const beta = created.find((c) => c.name === "zztest Beta");
  const bLogin = await api("/api/panel-login", { method: "POST", body: { username: "zztest Beta", password: beta.password } });
  await api("/api/panel-profile", { method: "POST", cookie: bLogin.userCookie, body: { name: "zztest Beta", phone: "5559999999" } });
  check("after phone edit, login name unchanged", (await api("/api/panel-login", { method: "POST", body: { username: "zztest Beta", password: beta.password } })).status === 200);

  // ── 7. LOCKOUT after 5 wrong tries ────────────────────────────────────────
  const gamma = created.find((c) => c.name === "zztest Gamma");
  for (let i = 0; i < 5; i++) await api("/api/panel-login", { method: "POST", body: { username: "zztest Gamma", password: "nope" + i } });
  const locked = await api("/api/panel-login", { method: "POST", body: { username: "zztest Gamma", password: gamma.password } });
  // A lockout answers 429 Too Many Requests (the honest code for "wait"); this check was
  // written when it was a flat 401. Accept either so it tests the BEHAVIOUR, not the old code.
  check("account locks after 5 wrong tries", (locked.status === 429 || locked.status === 401) && /minute|too many/i.test(locked.json?.error || ""), `status ${locked.status} · ${locked.json?.error}`);

  // ── 8. ROLE GATE: a tablet cookie can't hit a kitchen-only API ────────────
  const tabUser = created.find((c, i) => names.indexOf(c.name) % 3 === 2); // a tablet role
  if (tabUser) {
    const tl = await api("/api/panel-login", { method: "POST", body: { username: tabUser.name, password: tabUser.password } });
    const cross = await api("/api/kitchen/orders", { cookie: tl.userCookie });
    check("tablet cookie blocked from kitchen API (401)", cross.status === 401, `status ${cross.status}`);
  }

  // ── 9. OPERATION LOG: staff edits present, scoped to actor ────────────────
  const oplog = await api("/api/admin/oplog", { cookie: adminCookie });
  const rows = oplog.json?.actions || [];
  check("oplog readable by admin", oplog.status === 200 && Array.isArray(rows));
  check("staff profile_setup logged", rows.some((r) => r.action === "profile_setup" && /zztest Alpha/.test(r.actor || "")));
  check("staff profile_update logged", rows.some((r) => r.action === "profile_update"));
  // ── admin EDIT of a name/phone must NOT be logged ─────────────────────────
  //
  // THIS CHECK USED TO ASSERT THE WRONG THING, AND WENT PERMANENTLY RED (T13, sweep #7, 2026-08-27).
  //
  // It read every row `/api/admin/oplog` returned and failed if ANY of their action names contained
  // the letters "edit":  `.filter((r) => /edit/i.test(r.action)).length === 0`.
  //
  // Three things were wrong with that, and together they made the guard unfailable-for-the-right-
  // reason and unpassable-for-the-wrong-one:
  //   1. `/api/admin/oplog` with no `restaurant_id` answers the last 30 rows for the WHOLE PLATFORM,
  //      newest first. So the assertion was "nothing anywhere on Aevidine has recently done anything
  //      with 'edit' in its name" — never a statement about the request this guard just made.
  //   2. The product legitimately grew three such actions after this check was written:
  //      `staff_profile_edit` and `staff_job_edit` (app/api/owner/staff/route.ts) and
  //      `rate_limit_edit` (app/api/admin/rate-limits/route.ts). Every one of them is a write the
  //      owner is SUPPOSED to see in Audit & logs.
  //   3. With several sweep lanes sharing one dev database, one of those rows landing in the last 30
  //      is close to certain — so this went red on clean code, which is how a suite stops being read.
  //   The `before` and `newRows` locals it computed were never used, which is the tell: the row-count
  //   comparison it was reaching for was written and then not finished.
  //
  // The claim it MEANS to make is narrow: the admin's own name/phone edit of ONE login writes no log
  // row about that login. `app/api/admin/users` bears this out by reading — it calls `logAction` for
  // create, set_job, set_permissions, reset_password, enable, disable, set_role, set_access, set_pin
  // and delete, and for nothing else. So assert exactly that: take the ids on record before, make the
  // edit, and fail only if a NEW row names THIS person. Platform noise cannot move it either way.
  const idsBefore = new Set(rows.map((r) => r.id));
  await api("/api/admin/users", { method: "PATCH", cookie: adminCookie, body: { id: beta.id, action: "edit", phone: "5550001111" } });
  const oplog2 = await api("/api/admin/oplog", { cookie: adminCookie });
  const namesThisPerson = (r) =>
    new RegExp(`${beta.id}|${beta.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i")
      .test(`${r.detail || ""} ${r.actor || ""}`);
  const all2 = oplog2.json?.actions || [];
  // PROVE THE DETECTOR CAN SEE ONE FIRST. A "no row names this person" check goes green just as
  // happily when the matcher is broken, which is the failure the old version of this check died of.
  // Creating this person IS logged (`user_create`, detail `created kitchen "zztest Beta" · id …`), so
  // the same matcher must find that row. If it cannot, the absence below means nothing.
  check("…and the check can see a row that DOES name them (its own detector, proved)",
    all2.some((r) => r.action === "user_create" && namesThisPerson(r)));
  const aboutBeta = all2.filter((r) => !idsBefore.has(r.id) && namesThisPerson(r));
  check("admin name/phone edit writes no log row about that person", aboutBeta.length === 0,
    aboutBeta.map((r) => `${r.action}: ${r.detail}`).join(" · "));

  // ── 10. CLEANUP ───────────────────────────────────────────────────────────
  let del = 0;
  for (const u of created) {
    const r = await api(`/api/admin/users?id=${encodeURIComponent(u.id)}`, { method: "DELETE", cookie: adminCookie });
    if (r.status === 200) del++;
  }
  check(`cleanup deleted all ${created.length} test users`, del === created.length, `deleted ${del}`);

  // ── 10b. CLEAR THE LIMIT ROWS THIS RUN CREATED ────────────────────────────
  // Section 7 deliberately sends 5 wrong passwords to prove the lockout works. That is the one
  // legitimate reason to reach a limit — but it writes rate_limit_events + a login_throttle row,
  // and an OPEN event shows up in the admin's Problems list and can ping the owner's PHONE about
  // a restaurant that is perfectly fine. Alerts only stay useful while every one of them is real,
  // so a test that trips a wall must sweep up after itself. Deleting the users above does NOT
  // remove these rows. Service-role only, scoped to the zztest subjects. (2026-07-30)
  const svcHeaders = {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
  };
  const sbUrl = env.NEXT_PUBLIC_SUPABASE_URL;
  let swept = 0;
  try {
    // The subject for a staff login is the username, so every row we made mentions "zztest".
    for (const tbl of ["rate_limit_events", "rate_limit_counters"]) {
      const r = await fetch(`${sbUrl}/rest/v1/${tbl}?subject=like.*zztest*`, { method: "DELETE", headers: svcHeaders });
      if (r.ok) swept++;
      const r2 = await fetch(`${sbUrl}/rest/v1/${tbl}?subject_label=like.*zztest*`, { method: "DELETE", headers: svcHeaders });
      if (r2.ok) swept++;
    }
    // and the per-account lockout counter itself
    await fetch(`${sbUrl}/rest/v1/login_throttle?key=like.*zztest*`, { method: "DELETE", headers: svcHeaders });
  } catch { /* never fail the suite on cleanup — but DO report it below */ }
  check("cleared the rate-limit rows the lockout test created (no phantom alert for the owner)", swept > 0, `swept ${swept}`);

  console.log(results.join("\n"));
  console.log(`\n${fail === 0 ? "✅ ALL PASS" : "❌ FAILURES"} — ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error("FATAL", e); process.exit(2); });
