// SWEEP #10 T17 ROUND 6 — part of verify:t17-signin (scripts/verify-t17-signin.mjs). HERMETIC: every row this suite
// touches — staff_users, staff_actions, rate_limit_events, login_throttle, fail_count, restaurants — lives in the in-memory
// stub (./sb.mjs) and is wiped by world() before each check, so no wrong password here ever reaches a database, a limit
// counter or the owner's phone (any fetch a check has not replaced is refused).
//
// Checks written because a deliberate break SURVIVED round 6's mutation pass C (235 never-tried breaks). C#n = survivor n.
import { G, world, person, sign, req, t, save, quiet, RID_A, RID_B, randomUUID, refuseNet, rootFile } from "./r5lib.mjs";
import { createHash } from "node:crypto";
const ONLY = process.env.R5_ONLY || ""; const want = (f) => !ONLY || ONLY === f;
const sent = []; const capture = async (u, init) => { sent.push(String(init?.body ?? "")); return new Response("{}", { status: 200 }); };
const withAlerts = async (fn) => { const k = process.env.NTFY_TOPIC; process.env.NTFY_TOPIC = "r6-topic"; sent.length = 0; globalThis.fetch = capture; try { return await fn(); } finally { globalThis.fetch = refuseNet; if (k === undefined) delete process.env.NTFY_TOPIC; else process.env.NTFY_TOPIC = k; } };
if (want("lib/revealGate.ts")) { const f = "lib/revealGate.ts"; const RG = await import("@/lib/revealGate.ts"); delete process.env.REVEAL_PASSWORD;
  t(f, "C#2: an unlock cookie that is not text (a number, an object) is LOCKED — an error inside the check never counts as unlocked", (await RG.revealUnlocked(12345)) === false && (await RG.revealUnlocked({})) === false && (await RG.revealUnlockedUntil(12345)) === null);
  const keep = process.env.ADMIN_PASSWORD; delete process.env.ADMIN_PASSWORD;
  const exp = Date.now() + 60000; const key = createHash("sha256").update("aevidine.reveal.v1$").digest("hex"); const forged = `${exp}.${createHash("sha256").update(`${key}$${exp}`).digest("hex")}`;
  t(f, "C#3: with NO password configured, an unlock signed with the empty password is still locked", (await RG.revealUnlocked(forged)) === false);
  process.env.ADMIN_PASSWORD = keep; }
if (want("lib/passwordVault.ts")) { const f = "lib/passwordVault.ts"; const PV = await import("@/lib/passwordVault.ts"); const k = { C: process.env.CREDENTIAL_VAULT_KEY, S: process.env.SUPABASE_SERVICE_ROLE_KEY };
  process.env.CREDENTIAL_VAULT_KEY = "r6-vault-key-0123456789abcdef";
  t(f, "C#6: sealing an empty password answers exactly null", (await PV.sealPassword("")) === null);
  t(f, "C#7b: a stored copy so damaged it cannot even be decoded answers exactly null (never undefined, never an error)", (await PV.openPassword("v2$***$***")) === null && (await PV.openPassword("v1$%%%$%%%")) === null);
  delete process.env.CREDENTIAL_VAULT_KEY; delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  const pf = await PV.passwordFields("New-Pass-9");
  t(f, "C#7: with no vault key at all, the readable copy is exactly null — so a password change CLEARS the old copy instead of leaving it on the handover sheet", pf.password_shown === null && pf.password_hash.startsWith("pbkdf2$"));
  if (k.C === undefined) delete process.env.CREDENTIAL_VAULT_KEY; else process.env.CREDENTIAL_VAULT_KEY = k.C; if (k.S === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = k.S; }
if (want("lib/rateLimit.ts")) { const f = "lib/rateLimit.ts"; const RL = await import("@/lib/rateLimit.ts");
  await withAlerts(async () => { world({ restaurants: [{ id: RID_A, name: "Aangan" }] }); G.RPC_ANSWERS.lfh_rate_check = false; await RL.rateAllowed("staff_login", "*:w", { restaurantId: RID_A, label: "someone" }); });
  t(f, "C#14/#22: a limit alert names WHERE it happened ('Where: Aangan') when the who-line does not", /Where: Aangan/.test(sent.join("\n")), sent.join(" | ").slice(0, 160));
  const long = "s".repeat(250);
  world({ rate_limit_events: [{ id: "e1", key: "staff_login", subject: long.slice(0, 200), status: "open", restaurant_id: "00000000-0000-0000-0000-000000000000" }] }); G.RPC_ANSWERS.lfh_rate_check = false;
  await RL.rateAllowed("staff_login", long, { describe: async () => "the wording" });
  t(f, "C#15: a refused 250-character subject still finds its open event (both cut at 200) and writes the wording onto it", G.FIX.rate_limit_events[0].subject_label === "the wording");
  await withAlerts(async () => { world({ rate_limit_events: [{ key: "guest_order", subject: "ip:9", status: "open", last_at: new Date().toISOString(), restaurant_id: RID_B, hit_count: 4, max_count: 3, window_seconds: 60 }] }); await RL.pingLatestGuestLimit("guest_order", null); });
  t(f, "C#17: the guest-limit ping with no restaurant named finds the latest event from ANY restaurant", sent.length === 1 && /Tries: 4 in 1 min \(limit 3\)/.test(sent[0]), sent.join(" | ").slice(0, 120)); }
if (want("lib/userAuth.ts")) { const f = "lib/userAuth.ts"; const UA = await import("@/lib/userAuth.ts");
  world({ staff_users: [{ id: "x", role: "manager", name: "X", username: "x", restaurant_id: RID_A, active: true, deleted_at: null }] }); G.FAIL["staff_users"] = "error";
  t(f, "C#29: the limit-alert wording answers exactly null when its read fails", (await UA.describeLoginTarget("x")) === null);
  const keep = { S: process.env.SESSION_SECRET, A: process.env.ADMIN_PASSWORD, N: process.env.NODE_ENV }; delete process.env.SESSION_SECRET; delete process.env.ADMIN_PASSWORD; process.env.NODE_ENV = "production";
  const fresh = await import(rootFile("lib/userAuth.ts") + "?c32=" + Date.now()); world({ staff_users: [] });
  const a = await quiet(() => fresh.loginUser("a", "b")); const b = await quiet(() => fresh.loginUser("a", "b"));
  Object.assign(process.env, { SESSION_SECRET: keep.S, ADMIN_PASSWORD: keep.A, NODE_ENV: keep.N });
  t(f, "C#32: a live site with no secret says 'staff sign-in is OFF' in its log on the FIRST try, and not again on the next", a.logs.some((l) => /staff sign-in is OFF/.test(l)) && !b.logs.some((l) => /staff sign-in is OFF/.test(l)));
  const u = await person({}); world({ staff_users: [u] });
  t(f, "C#34: a pass whose time part is not a number is refused WITHOUT a database read", (await UA.userFromCookie(`${u.id}.notatime.sig`)) === null && G.READS.length === 0); }
if (want("app/api/panel-login/route.ts")) { const f = "app/api/panel-login/route.ts"; const PL = await import("@/app/api/panel-login/route.ts"); const PA = await import("@/lib/panelAccess.ts");
  const own = await person({ role: "owner", username: "c42", pw: "pw-1", restaurant_id: RID_A });
  world({ staff_users: [own], restaurant_owners: [{ user_id: own.id, restaurant_id: RID_B }], restaurants: [{ id: RID_B, deleted_at: null }] }); PA.forgetRestaurant("z", [own.id]);
  await PL.POST(req("/api/panel-login", { method: "POST", json: { username: "c42", password: "pw-1" } }));
  t(f, "C#42: an owner's SUCCESSFUL sign-in is filed under a restaurant they really own, not their stored home", (G.FIX.staff_actions || []).find((x) => x.action === "login")?.restaurant_id === RID_B); }
if (want("app/api/panel-profile/route.ts")) { const f = "app/api/panel-profile/route.ts"; const PP = await import("@/app/api/panel-profile/route.ts");
  process.env.CREDENTIAL_VAULT_KEY = "r6-vault-key-0123456789abcdef";
  const GET = (u) => PP.GET(req("/api/panel-profile", { cookies: { lfh_user: sign(u) } }));
  const POST = (u, json) => PP.POST(req("/api/panel-profile", { method: "POST", json, cookies: { lfh_user: sign(u) } }));
  const pm = await person({ role: "manager", in_payroll: true }); world({ staff_users: [pm], settings: [{ restaurant_id: RID_A, payroll_allowed: true }], staff_payments: [] }); G.RPC_ANSWERS.lfh_staff_pay_summary = [];
  t(f, "C#47: someone on the pay list is told so (onPayList true)", (await (await GET(pm)).json()).onPayList === true);
  const np = await person({ role: "manager", in_payroll: false }); world({ staff_users: [np], settings: [{ restaurant_id: RID_A, payroll_allowed: true }] });
  t(f, "C#47: …and someone not on it, not (onPayList false)", (await (await GET(np)).json()).onPayList === false);
  const k = await person({ role: "kitchen" }); world({ staff_users: [k], settings: [{ restaurant_id: RID_A, payroll_allowed: true }] });
  await GET(k);
  t(f, "C#49: the kitchen's profile read costs ONE staff_users read (the pass check) — never the profile columns it does not have", G.READS.filter((x) => x.table === "staff_users").length === 1);
  const n = await person({ role: "tablet", username: "c52a" }); world({ staff_users: [n, { ...n, id: randomUUID(), username: "taken52" }] });
  t(f, "C#52: a name already taken answers exactly 409", (await POST(n, { name: "taken52" })).status === 409);
  const mp = await person({ role: "manager", can_self_set_pin: true, pin_hash: null, name: null, phone: null, profile_confirmed: false }); world({ staff_users: [mp] });
  await POST(mp, { name: "Mo", phone: "9", pin: "2468" });
  t(f, "C#55: a manager who sets name, phone AND their first PIN in one save has finished setup", G.FIX.staff_users[0].profile_confirmed === true && (G.FIX.staff_actions || []).some((x) => x.action === "profile_setup")); }
save((process.env.T17_SAVE || "") + "/U-mutkill3.json");
