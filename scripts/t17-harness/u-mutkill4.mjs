// SWEEP #10 T17 ROUND 6 — part of verify:t17-signin (scripts/verify-t17-signin.mjs). HERMETIC: every row this suite
// touches — staff_users, staff_actions, rate_limit_events, login_throttle, fail_count, restaurants — lives in the in-memory
// stub (./sb.mjs) and is wiped by world() before each check, so no wrong password here ever reaches a database, a limit
// counter or the owner's phone (any fetch a check has not replaced is refused).
//
// Checks written because a deliberate break SURVIVED round 6's mutation pass D. D#n = survivor n.
import { G, world, person, sign, req, t, save, RID_A, RID_B, refuseNet } from "./r5lib.mjs";
const ONLY = process.env.R5_ONLY || ""; const want = (f) => !ONLY || ONLY === f;
const sent = []; const capture = async (u, init) => { sent.push(String(init?.body ?? "")); return new Response("{}", { status: 200 }); };
const withAlerts = async (fn) => { const k = process.env.NTFY_TOPIC; process.env.NTFY_TOPIC = "r6-topic"; sent.length = 0; globalThis.fetch = capture; try { return await fn(); } finally { globalThis.fetch = refuseNet; if (k === undefined) delete process.env.NTFY_TOPIC; else process.env.NTFY_TOPIC = k; } };
if (want("lib/passwordVault.ts")) { const f = "lib/passwordVault.ts"; const PV = await import("@/lib/passwordVault.ts");
  process.env.CREDENTIAL_VAULT_KEY = "r6-vault-key-0123456789abcdef";
  const real = crypto.subtle.encrypt.bind(crypto.subtle); crypto.subtle.encrypt = async () => { throw new Error("r6: encrypt down"); };
  let a, b; try { a = await PV.sealPassword("x-pass"); b = await PV.passwordFields("x-pass-2"); } finally { crypto.subtle.encrypt = real; }
  t(f, "D#1: if sealing the readable copy FAILS, the answer is exactly null — so a password change clears the old copy", a === null && b.password_shown === null && b.password_hash.startsWith("pbkdf2$")); }
if (want("lib/rateLimit.ts")) { const f = "lib/rateLimit.ts"; const RL = await import("@/lib/rateLimit.ts");
  await withAlerts(async () => { world({}); await RL.recordAlert("admin_login", "9.9.9.9", "Admin panel · 9.9.9.9", 3); });
  t(f, "D#2: the admin-door alert reads 'Tries: 3' — never 'in undefined sec'", /Tries: 3(\n|$)/.test(sent.join("\n")) && !/undefined/.test(sent.join("\n")), sent.join(" | ").slice(0, 140));
  world({}); G.RPC_ANSWERS.lfh_rate_check = false; await RL.rateAllowed("staff_login", "*:q");
  t(f, "D#3: a refusal with no restaurant does not look a restaurant name up", !G.READS.some((r) => r.table === "restaurants"));
  await withAlerts(async () => { world({ rate_limit_events: [{ key: "guest_order", subject: "ip:x", status: "open", last_at: new Date().toISOString(), restaurant_id: RID_B, hit_count: 9, max_count: 3, window_seconds: 60 }] }); await RL.pingLatestGuestLimit("guest_order", RID_A); });
  t(f, "D#6: the guest-limit ping for ONE restaurant never reports another restaurant's event", sent.length === 0);
  world({}); G.FAIL["rpc:lfh_rate_check"] = "error";
  t(f, "D#12: a limiter that answers with an ERROR (not a throw) lets the person through", (await RL.rateAllowed("staff_login", "x")) === true); }
if (want("app/api/panel-profile/route.ts")) { const f = "app/api/panel-profile/route.ts"; const PP = await import("@/app/api/panel-profile/route.ts");
  process.env.CREDENTIAL_VAULT_KEY = "r6-vault-key-0123456789abcdef";
  const GET = (u) => PP.GET(req("/api/panel-profile", { cookies: { lfh_user: sign(u) } }));
  const POST = (u, json) => PP.POST(req("/api/panel-profile", { method: "POST", json, cookies: { lfh_user: sign(u) } }));
  const ON = [{ restaurant_id: RID_A, payroll_allowed: true }];
  const k = await person({ role: "kitchen" }); world({ staff_users: [k], settings: ON }); await GET(k);
  t(f, "D#13: the kitchen's profile read never reads the staff-profile settings (it has no profile)", !G.READS.some((r) => r.table === "settings"));
  const pr = await person({ role: "manager", profile: { address: "12 MG Road" }, in_payroll: true, can_see_own_pay: true, pay_type: "monthly", pay_amount: 0 });
  world({ staff_users: [pr], settings: ON, staff_payments: [] }); G.RPC_ANSWERS.lfh_staff_pay_summary = [];
  const g = await (await GET(pr)).json();
  t(f, "D#17: a person reads their SAVED details back (not an empty profile)", g.profile?.address === "12 MG Road");
  t(f, "D#15/#20: a pay amount of 0 is shown as 0, not as 'no amount'", g.pay?.pay_amount === 0);
  const pw = await person({ username: "d16", pw: "Old-1-pass" }); world({ staff_users: [pw] }); G.FAIL_NTH["staff_users:update"] = { at: 1, mode: "empty" };
  t(f, "D#16: a password change whose account vanished answers exactly 409", (await POST(pw, { currentPassword: "Old-1-pass", newPassword: "New-2-pass" })).status === 409);
  const n = await person({ role: "tablet" }); world({ staff_users: [n] }); G.FAIL_NTH["staff_users:update"] = { at: 1, mode: "empty" };
  t(f, "D#18: a details save whose account vanished answers exactly 409", (await POST(n, { phone: "1" })).status === 409); }
save((process.env.T17_SAVE || "") + "/U-mutkill4.json");
