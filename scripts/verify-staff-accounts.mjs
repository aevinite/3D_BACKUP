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

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const parseEnv = (t) =>
  Object.fromEntries(t.split("\n").filter((l) => l.includes("=") && !l.trim().startsWith("#")).map((l) => {
    const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
  }));
const env = parseEnv(readFileSync(join(root, ".env.local"), "utf8"));
const BASE = "http://localhost:4000";
const ADMIN = env.ADMIN_PASSWORD;
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
async function createUser(name, role, { phone, password } = {}) {
  const r = await api("/api/admin/users", { method: "POST", cookie: adminCookie, body: { name, role, phone, password } });
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
  const stale = await api("/api/admin/users", { cookie: adminCookie });
  const staleZz = (stale.json?.users || stale.json || []).filter?.((u) => /^zztest/i.test(String(u.username || u.name || ""))) || [];
  for (const u of staleZz) await api(`/api/admin/users?id=${encodeURIComponent(u.id)}`, { method: "DELETE", cookie: adminCookie });
  if (staleZz.length) console.log(`   (pre-clean removed ${staleZz.length} leftover zztest account(s) from an earlier run)\n`);

  // ── 1. CREATE 10 users across roles, varied names ─────────────────────────
  const roles = ["manager", "kitchen", "tablet"];
  const names = [
    "zztest Alpha", "zztest Beta", "zztest Gamma", "zztest Delta", "zztest Echo",
    "zztest Foxtrot", "zztest Golf", "zztest Hotel", "zztest India", "zztest Juliet",
  ];
  for (let i = 0; i < names.length; i++) {
    const withPhone = i % 2 === 0;
    const r = await createUser(names[i], roles[i % 3], withPhone ? { phone: "555000" + i } : {});
    check(`create #${i + 1} "${names[i]}" (${roles[i % 3]})`, r.status === 200 && !!r.json?.id, `status ${r.status} ${JSON.stringify(r.json)}`);
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
  const save1 = await api("/api/panel-profile", { method: "POST", cookie: alphaCookie, body: { name: "zztest Alpha", phone: "5551234567" } });
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
  check("account locks after 5 wrong tries", locked.status === 401 && /minute|too many/i.test(locked.json?.error || ""), locked.json?.error);

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
  // admin EDIT of a user must NOT be logged
  const before = rows.length;
  await api("/api/admin/users", { method: "PATCH", cookie: adminCookie, body: { id: beta.id, action: "edit", phone: "5550001111" } });
  const oplog2 = await api("/api/admin/oplog", { cookie: adminCookie });
  const newRows = (oplog2.json?.actions || []).filter((r) => r.action === "profile_update" || r.action === "profile_setup");
  const adminEditRows = (oplog2.json?.actions || []).filter((r) => /edit/i.test(r.action));
  check("admin name/phone edit is NOT logged", adminEditRows.length === 0);

  // ── 10. CLEANUP ───────────────────────────────────────────────────────────
  let del = 0;
  for (const u of created) {
    const r = await api(`/api/admin/users?id=${encodeURIComponent(u.id)}`, { method: "DELETE", cookie: adminCookie });
    if (r.status === 200) del++;
  }
  check(`cleanup deleted all ${created.length} test users`, del === created.length, `deleted ${del}`);

  console.log(results.join("\n"));
  console.log(`\n${fail === 0 ? "✅ ALL PASS" : "❌ FAILURES"} — ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error("FATAL", e); process.exit(2); });
