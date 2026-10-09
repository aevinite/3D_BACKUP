// SWEEP #10 T17 ROUND 5 — part of verify:t17-signin (scripts/verify-t17-signin.mjs). HERMETIC: every row this suite
// touches — staff_users, staff_actions, rate_limit_events, login_throttle, fail_count, restaurants — lives in the in-memory
// stub (./sb.mjs) and is wiped by world() before each check, so no wrong password here ever reaches a database, a limit
// counter or the owner's phone (any fetch a check has not replaced is refused).
import { G, world, person, sign, req, t, save, quiet, RID_A } from "./r5lib.mjs";
const f = "app/api/panel-profile/route.ts"; const PP = await import("@/app/api/panel-profile/route.ts"); const UA = await import("@/lib/userAuth.ts");
process.env.CREDENTIAL_VAULT_KEY = "r5-vault-key-0123456789abcdef";
const body = async (res) => { try { return await res.clone().json(); } catch { return null; } };
const logs = (a) => (G.FIX.staff_actions || []).filter((r) => !a || r.action === a);
const GET = (u) => PP.GET(req("/api/panel-profile", { cookies: { lfh_user: sign(u) } }));
const POST = (u, json, headers = {}) => PP.POST(req("/api/panel-profile", { method: "POST", json, headers, cookies: { lfh_user: sign(u) } }));
const ON = [{ restaurant_id: RID_A, payroll_allowed: true }];
const pw = await person({ username: "pw5", pw: "Old-Pass-1" });
for (const [np, st] of [["123456", 200], ["12345", 400], ["      ", 200]]) { world({ staff_users: [pw] }); t(f, `a new password of ${np.length} characters (${JSON.stringify(np)}) answers ${st}`, (await POST(pw, { currentPassword: "Old-Pass-1", newPassword: np })).status === st); }
world({ staff_users: [pw] }); await POST(pw, { currentPassword: "Old-Pass-1", newPassword: "New-Pass-2" });
t(f, "after a password change the SAME device's old pass stops working too (the person signs in again)", (await UA.userFromCookie(sign(pw))) === null);
world({ staff_users: [pw] }); await POST(pw, { currentPassword: "Old-Pass-1", newPassword: "New-Pass-2" });
t(f, "the change and its log line say nothing of either password", !JSON.stringify(G.FIX.staff_actions || []).includes("New-Pass-2") && !JSON.stringify(G.FIX.staff_actions || []).includes("Old-Pass-1"));
world({ staff_users: [pw] }); G.FAIL_NTH["staff_users:select"] = { at: 2, mode: "empty" };
t(f, "an account whose stored password row has vanished meanwhile: the current password is 'wrong' (nothing to match)", (await POST(pw, { currentPassword: "Old-Pass-1", newPassword: "New-Pass-2" })).status === 403);
world({ staff_users: [pw] }); G.FAIL_NTH["staff_users:select"] = { at: 2, mode: "throw" };
await quiet(() => POST(pw, { currentPassword: "Old-Pass-1", newPassword: "New-Pass-2" }));
t(f, "a stored-password read that THROWS (not just fails) does not change the password", G.FIX.staff_users[0].password_hash === pw.password_hash);
const pr = await person({ role: "tablet", username: "prof", profile: { notes: "N", id_verified: true } });
world({ staff_users: [pr], settings: ON }); G.FAIL_NTH["staff_users:select"] = { at: 2, mode: "error" };
const p1 = await quiet(() => POST(pr, { profile: { city: "Surat" } }));
t(f, "item 26: the busy answer to a failed details read says so in the server log", p1.logs.some((l) => /saved details read failed/.test(l)));
t(f, "item 26: …and writes nothing at all, not even a log line", !G.WRITES.some((w) => w.table === "staff_users") && logs().length === 0);
world({ staff_users: [{ ...pr, profile: null }], settings: ON });
const p2 = await POST({ ...pr, profile: null }, { profile: { city: "Surat" } });
t(f, "a person with NO saved details yet (a real empty profile) can save their first one", p2.status === 200 && G.FIX.staff_users[0].profile.city === "Surat");
world({ staff_users: [pr], settings: ON });
const p3 = await POST(pr, { profile: { city: "Surat", unknown_key: "x", notes: "mine" } });
t(f, "unknown fields and the owner's note are dropped from a person's own save", p3.status === 200 && !("unknown_key" in G.FIX.staff_users[0].profile) && G.FIX.staff_users[0].profile.notes === "N");
world({ staff_users: [pr], settings: ON });
await POST(pr, { profile: { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7, city: "x" } });
t(f, "the log line names at most six of the fields sent", (() => { const d = logs("profile_update")[0]?.detail || ""; const m = d.match(/\(([^)]*)\)/); return m && m[1].split(", ").length === 6; })());
world({ staff_users: [{ ...pr, profile: { city: "A" } }], settings: ON });
const cl = await POST(pr, { profile: { city: "B" } }, { "x-lfh-expect": JSON.stringify({ table: "staff_users", id: pr.id, fields: { "profile.city": "OLD" } }) });
t(f, "a details save made from a screen showing an OLD value of that one field is refused, not silently overwritten", cl.status === 409 && G.FIX.staff_users[0].profile.city === "A", `status ${cl.status}`);
const own = await person({ role: "owner", username: "ownp" }); world({ staff_users: [own], settings: ON });
const go = await body(await GET(own));
t(f, "an owner reads their own basic details (and the profile block follows the staff-profiles switch)", go.username === "ownp" && typeof go.profileModule === "boolean");
const pm = await person({ role: "manager", in_payroll: true });
const pays = Array.from({ length: 45 }, (_, i) => ({ id: "p" + i, staff_id: pm.id, restaurant_id: RID_A, amount: i, paid_on: `2026-09-${String((i % 28) + 1).padStart(2, "0")}` }));
world({ staff_users: [pm], settings: ON, staff_payments: pays }); G.RPC_ANSWERS.lfh_staff_pay_summary = [];
const g2 = await body(await GET(pm));
t(f, "a person's own payment list is capped at 40", g2.payments.length === 40);
t(f, "the month summary is asked from the 1st of this month (India time) to today", (() => { const a = G.RPCS.find((x) => x.name === "lfh_staff_pay_summary")?.args; return a && /^\d{4}-\d{2}-01$/.test(a.p_from) && a.p_from.slice(0, 7) === a.p_to.slice(0, 7) && a.p_restaurant === RID_A; })());
world({ staff_users: [{ ...pm, in_payroll: false, can_see_own_pay: true }], settings: ON });
t(f, "someone NOT on the pay list never triggers the pay reads", await (async () => { await GET({ ...pm, in_payroll: false }); return !G.READS.some((x) => x.table === "staff_payments") && !G.RPCS.some((x) => x.name === "lfh_staff_pay_summary"); })());
const nm = await person({ role: "tablet", username: "u1", name: "U1", phone: "1", profile_confirmed: true });
world({ staff_users: [nm] }); await POST(nm, { name: "Ünïcode Náme" });
t(f, "a name in other letters (accents) keeps them; the sign-in name is its lower-case", G.FIX.staff_users[0].name === "Ünïcode Náme" && G.FIX.staff_users[0].username === "ünïcode náme");
world({ staff_users: [nm] }); G.FAIL["staff_users:update"] = "error";
await quiet(() => POST(nm, { name: "New" }));
t(f, "a rename whose write fails changes nothing and logs no change", G.FIX.staff_users[0].name === "U1" && logs("profile_update").length === 0);
const mp = await person({ role: "manager", can_self_set_pin: true });
for (const [pin, st] of [["12345678", 200], ["1234", 200], ["0000", 200], ["١٢٣٤", 400]]) { world({ staff_users: [mp] }); t(f, `the PIN “${pin}” answers ${st}`, (await POST(mp, { pin })).status === st); }
const t1 = await person({ role: "tablet", name: "T", phone: null, profile_confirmed: false });
world({ staff_users: [t1] }); await POST(t1, { name: "T2" });
t(f, "a waiter with a name but NO phone has not finished first-time setup", G.FIX.staff_users[0].profile_confirmed !== true && logs("profile_setup").length === 0);
world({ staff_users: [t1] }); await POST(t1, { name: "T2", phone: "9" });
t(f, "…with both, setup is complete and logged once", G.FIX.staff_users[0].profile_confirmed === true && logs("profile_setup").length === 1);
world({ staff_users: [{ ...t1, profile_confirmed: true, phone: "9" }] }); await POST({ ...t1, profile_confirmed: true, phone: "9" }, { name: "T3" });
t(f, "an already set-up person renaming is a plain update, never a second 'completed setup'", logs("profile_setup").length === 0 && logs("profile_update").length === 1);
save((process.env.T17_SAVE || "") + "/U-profile.json");
