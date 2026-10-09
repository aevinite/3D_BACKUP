// SWEEP #10 T17 ROUND 5 — part of verify:t17-signin (scripts/verify-t17-signin.mjs). HERMETIC: every row this suite
// touches — staff_users, staff_actions, rate_limit_events, login_throttle, fail_count, restaurants — lives in the in-memory
// stub (./sb.mjs) and is wiped by world() before each check, so no wrong password here ever reaches a database, a limit
// counter or the owner's phone (any fetch a check has not replaced is refused).
import { G, world, person, sign, req, t, save, quiet, RID_A, RID_B, ADMIN_PW, sha, randomUUID } from "./r5lib.mjs";
const ONLY = process.env.R5_ONLY || ""; const want = (f) => !ONLY || ONLY === f;
const PA = await import("@/lib/panelAccess.ts"); const UA = await import("@/lib/userAuth.ts");
const adminTok = await sha(ADMIN_PW);
const body = async (res) => { try { return await res.clone().json(); } catch { return null; } };
const logs = (a) => (G.FIX.staff_actions || []).filter((r) => !a || r.action === a);
const ck = (res, name) => (res.headers.getSetCookie?.() || []).find((c) => c.startsWith(name + "=")) || "";
const REST = (o = {}) => ({ id: RID_A, slug: "cr-" + Math.random().toString(36).slice(2, 8), name: "Aangan", active: true, deleted_at: null, ...o });
if (want("app/api/panel-login/route.ts")) { const f = "app/api/panel-login/route.ts"; const PL = await import("@/app/api/panel-login/route.ts");
  const call = (json, cookies = {}) => PL.POST(req("/api/panel-login", { method: "POST", json, cookies }));
  const m = await person({ username: "cl1", pw: "pw-1", name: "Cee Ell" });
  const trial = [
    ["an unknown name", { username: "nobody", password: "x" }, 'login failed · no active account named "nobody"'],
    ["a wrong password", { username: "cl1", password: "x" }, 'login failed · wrong password for "Cee Ell"'],
    ["an oversize input", { username: "cl1", password: "x".repeat(201) }, "login failed · oversized input rejected"],
  ];
  for (const [label, j, want2] of trial) { world({ staff_users: [m] }); await call(j); t(f, `the log line for ${label} reads exactly “${want2}”`, logs("login_failed")[0]?.detail === want2, logs("login_failed")[0]?.detail); }
  world({ staff_users: [{ ...m, locked_until: new Date(Date.now() + 60000).toISOString() }] }); await call({ username: "cl1", password: "pw-1" });
  t(f, "…for a locked account: 'login blocked · \"Cee Ell\" is locked out (too many wrong tries)'", logs("login_failed")[0]?.detail === 'login blocked · "Cee Ell" is locked out (too many wrong tries)');
  world({ staff_users: [{ ...m, active: false }] }); await call({ username: "cl1", password: "pw-1" });
  t(f, "…for a disabled account: 'login refused · \"Cee Ell\" is disabled'", logs("login_failed")[0]?.detail === 'login refused · "Cee Ell" is disabled');
  world({ staff_users: [m] }); await call({ username: "nobody", password: "x" });
  t(f, "an unknown name's line is filed under no restaurant and the 'admin' panel", logs("login_failed")[0]?.restaurant_id === null && logs("login_failed")[0]?.panel === "admin");
  world({ staff_users: [m] }); await call({ username: "cl1", password: "x" });
  t(f, "a wrong password's line is filed under the person's own restaurant and role", logs("login_failed")[0]?.restaurant_id === RID_A && logs("login_failed")[0]?.panel === "manager");
  const ow = await person({ role: "owner", username: "clo", pw: "pw-1", restaurant_id: RID_B, name: null });
  world({ staff_users: [ow], restaurant_owners: [] }); PA.forgetRestaurant("z", [ow.id]);
  const den = await call({ username: "clo", password: "pw-1" });
  t(f, "an owner with nothing live: the denial line reads '\"clo\" signed in but the owner panel is not enabled on any owned restaurant'", logs("login_denied")[0]?.detail === '"clo" signed in but the owner panel is not enabled on any owned restaurant' && den.status === 403);
  world({ staff_users: [ow], restaurant_owners: [] }); G.FAIL["restaurant_owners"] = "error"; PA.forgetRestaurant("z", [ow.id]);
  const oe = await quiet(() => call({ username: "clo", password: "pw-1" }));
  t(f, "an owner's restaurants unreadable at sign-in: 503 'Can't reach the server — try again in a moment.' and the server log says why", oe.v?.status === 503 && (await body(oe.v)).error === "Can't reach the server — try again in a moment." && oe.logs.some((l) => /couldn't read which restaurants this owner has/.test(l)));
  world({ staff_users: [ow], restaurant_owners: [{ user_id: ow.id, restaurant_id: RID_A }], restaurants: [{ id: RID_A, deleted_at: null }] }); PA.forgetRestaurant("z", [ow.id]);
  await call({ username: "clo", password: "pw-1" });
  t(f, "an owner's sign-in line has no 'username' note when they have no display name", logs("login")[0]?.detail === null && logs("login")[0]?.actor === "clo");
  world({ staff_users: [ow], restaurant_owners: [{ user_id: ow.id, restaurant_id: RID_A }], restaurants: [{ id: RID_A, deleted_at: null }] }); PA.forgetRestaurant("z", [ow.id]);
  await call({ username: "clo", password: "nope" });
  t(f, "an owner's wrong password is filed under a restaurant they own (not their stored home)", logs("login_failed")[0]?.restaurant_id === RID_A);
  world({ staff_users: [m] });
  const em = await PL.POST(req("/api/panel-login", { method: "POST", body: "", headers: { "content-type": "application/json" } }));
  t(f, "an EMPTY body is an empty sign-in (401 'Enter your username and password.')", em.status === 401 && (await body(em)).error === "Enter your username and password.");
  world({ staff_users: [m] }); G.FAIL["rpc:lfh_guest_restaurant"] = "throw";
  const tg = await quiet(() => call({ username: "cl1", password: "pw-1", restaurant: "cr-throw" }));
  t(f, "a restaurant lookup that throws a non-error value is still 503, logged", tg.v?.status === 503 && tg.logs.some((l) => /\[panel-login\] couldn't look the restaurant up/.test(l)));
  const keep = process.env.TURNSTILE_SECRET_KEY; process.env.TURNSTILE_SECRET_KEY = "r5-ts";
  world({ staff_users: [m] }); globalThis.fetch = async () => new Response(JSON.stringify({ success: true }), { status: 200 });
  const ts = await call({ username: "cl1", password: "pw-1", "cf-turnstile-response": "tok" });
  globalThis.fetch = async (u) => { throw new TypeError("r5: network refused"); };
  if (keep === undefined) delete process.env.TURNSTILE_SECRET_KEY; else process.env.TURNSTILE_SECRET_KEY = keep;
  t(f, "with the human check on and a PASSING token, the sign-in goes through", ts.status === 200);
}
if (want("app/api/panel-logout/route.ts")) { const f = "app/api/panel-logout/route.ts"; const LO = await import("@/app/api/panel-logout/route.ts");
  const m = await person({ name: null, username: "noname" }); world({ staff_users: [m] });
  await LO.POST(req("/api/panel-logout", { method: "POST", cookies: { lfh_user: sign(m) } }));
  t(f, "a person with no display name is logged out as their login name", logs("logout")[0]?.actor === "noname" && /\(no name\) logged out · user "noname"/.test(logs("logout")[0]?.detail || ""));
  world({ staff_users: [m] }); G.FAIL["staff_users"] = "throw";
  const t2 = await quiet(() => LO.POST(req("/api/panel-logout", { method: "POST", cookies: { lfh_user: sign(m) } })));
  t(f, "a pass check that THROWS still signs out (and logs nothing)", t2.v?.status === 303 && logs().length === 0);
  const o = await person({ role: "owner", username: "oo" });
  world({ staff_users: [o], restaurant_owners: [] }); G.FAIL_NTH["restaurant_owners:select"] = { at: 1, mode: "error" }; PA.forgetRestaurant("z", [o.id]);
  const t3 = await quiet(() => LO.POST(req("/api/panel-logout", { method: "POST", cookies: { lfh_user: sign(o) } })));
  t(f, "an owner's sign-out still happens when their restaurants cannot be read (line filed under no restaurant)", t3.v?.status === 303 && logs("logout")[0]?.restaurant_id === null);
}
if (want("app/api/staff-login/route.ts")) { const f = "app/api/staff-login/route.ts"; const SL = await import("@/app/api/staff-login/route.ts");
  const call = (form, ip, json = true) => SL.POST(req("/api/staff-login", { method: "POST", form, headers: { ...(json ? { accept: "application/json" } : {}), "x-forwarded-for": ip } }));
  world({ login_throttle: [] });
  const bot = await call({ password: ADMIN_PW, lfh_hp_ref: "x" }, "6.1.1.1");
  t(f, "a bot-trap refusal is logged 'admin login refused from 6.1.1.1 — automated submission (trap)'", logs("login_failed")[0]?.detail === "admin login refused from 6.1.1.1 — automated submission (trap)" && bot.status === 401);
  world({ login_throttle: [] });
  await call({ password: ADMIN_PW, lfh_hp_ms: "10" }, "6.1.1.2");
  t(f, "a form sent faster than a person types is refused as 'too_fast'", /automated submission \(too_fast\)/.test(logs("login_failed")[0]?.detail || ""));
  world({ login_throttle: [{ key: "admin:6.1.1.3", fail_count: 0, locked_until: new Date(Date.now() + 120000).toISOString() }] });
  const lk = await call({ password: ADMIN_PW }, "6.1.1.3");
  t(f, "a locked address is logged 'admin login refused — 6.1.1.3 is locked out (too many wrong tries)'", logs("login_blocked")[0]?.detail === "admin login refused — 6.1.1.3 is locked out (too many wrong tries)" && (await body(lk)).locked === true);
  world({ login_throttle: [{ key: "admin:6.1.1.4", fail_count: 0, locked_until: new Date(Date.now() + 200 * 365 * 864e5).toISOString() }] });
  await call({ password: ADMIN_PW }, "6.1.1.4");
  t(f, "a blocked address is logged '… 6.1.1.4 is blocked'", logs("login_blocked")[0]?.detail === "admin login refused — 6.1.1.4 is blocked");
  world({ login_throttle: [] });
  const r = await SL.POST(req("/api/staff-login", { method: "POST", form: { password: ADMIN_PW, next: "/aevinite/billing" }, headers: { "x-forwarded-for": "6.1.1.5" } }));
  t(f, "without JavaScript the right password lands on the asked-for console page (303)", r.status === 303 && new URL(r.headers.get("location")).pathname === "/aevinite/billing");
  world({ login_throttle: [] });
  const nf = await SL.POST(req("/api/staff-login", { method: "POST", headers: { accept: "application/json", "x-forwarded-for": "6.1.1.6", "content-type": "application/x-www-form-urlencoded" }, body: "" }));
  t(f, "an EMPTY form is a wrong password (401), counted", nf.status === 401 && G.RPCS.some((x) => x.name === "lfh_throttle_fail"));
}
if (want("app/r/[restaurant]/owner/route.ts")) { const f = "app/r/[restaurant]/owner/route.ts"; const OR = await import("@/app/r/[restaurant]/owner/route.ts");
  const go2 = (slug, cookies = {}) => OR.GET(req(`/r/${slug}/owner`, { cookies }), { params: Promise.resolve({ restaurant: slug }) });
  world({}); G.FAIL["rpc:lfh_guest_restaurant"] = "error";
  const e = await quiet(() => go2("cr-o-blip")); const html = await e.v.text();
  t(f, "the try-again page has a working 'Try again' link back to the same address", /<a href=""[^>]*>Try again<\/a>/.test(html));
  t(f, "…its title says 'Try again in a moment'", /<title>Try again in a moment<\/title>/.test(html));
  t(f, "…and it is a real HTML page (utf-8)", e.v.headers.get("content-type") === "text/html; charset=utf-8");
  world({ restaurants: [], slug_redirects: [] }); G.FAIL["rpc:lfh_slug_moved"] = "error";
  t(f, "an unknown address whose forward check fails is a plain 404 (never a crash)", (await go2("cr-o-none")).status === 404);
  const o = await person({ role: "owner", restaurant_id: RID_A });
  world({ restaurants: [REST({ slug: "cr-o-1" })], staff_users: [o] });
  const a = await go2("cr-o-1", { lfh_user: sign(o), lfh_staff_auth: adminTok });
  t(f, "an owner signed in on a device that also holds the admin cookie goes to THEIR cockpit (owner first)", new URL(a.headers.get("location")).pathname === "/owner" && !new URL(a.headers.get("location")).searchParams.has("rid"));
  const mg = await person({ role: "manager" });
  world({ restaurants: [REST({ slug: "cr-o-2" })], staff_users: [mg] });
  const b = await go2("cr-o-2", { lfh_user: sign(mg), lfh_staff_auth: adminTok });
  t(f, "a MANAGER's pass plus the admin cookie: the admin path is taken (act-as cookie set)", ck(b, "aevidine_admin_rid").startsWith("aevidine_admin_rid=" + RID_A));
}
save((process.env.T17_SAVE || "") + "/U-close-routes.json");
