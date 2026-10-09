// SWEEP #10 T17 ROUND 5 — part of verify:t17-signin (scripts/verify-t17-signin.mjs). HERMETIC: every row this suite
// touches — staff_users, staff_actions, rate_limit_events, login_throttle, fail_count, restaurants — lives in the in-memory
// stub (./sb.mjs) and is wiped by world() before each check, so no wrong password here ever reaches a database, a limit
// counter or the owner's phone (any fetch a check has not replaced is refused).
import { G, world, person, sign, req, t, save, quiet, RID_A, RID_B, ADMIN_PW, sha, randomUUID } from "./r5lib.mjs";
const ONLY = process.env.R5_ONLY || ""; const want = (f) => !ONLY || ONLY === f;
const PA = await import("@/lib/panelAccess.ts"); const PG = await import("@/lib/panelGate.ts");
const adminTok = await sha(ADMIN_PW);
const body = async (res) => { try { return await res.clone().json(); } catch { return null; } };
const logs = (a) => (G.FIX.staff_actions || []).filter((r) => !a || r.action === a);
const ck = (res, name) => (res.headers.getSetCookie?.() || []).find((c) => c.startsWith(name + "=")) || "";
const REST = (o = {}) => ({ id: RID_A, slug: "r5-" + Math.random().toString(36).slice(2, 8), name: "Aangan", active: true, deleted_at: null, ...o });
if (want("app/api/panel-login/route.ts")) { const f = "app/api/panel-login/route.ts"; const PL = await import("@/app/api/panel-login/route.ts");
  const call = (json, cookies = {}) => PL.POST(req("/api/panel-login", { method: "POST", json, cookies }));
  for (const role of ["manager", "kitchen", "tablet"]) {
    const u = await person({ role, username: "s" + role, pw: "pw-1", name: "S " + role });
    world({ staff_users: [u], restaurants: [REST({ active: false })] }); PA.forgetRestaurant(RID_A);
    const r = await call({ username: "s" + role, password: "pw-1" });
    t(f, `item 30: a suspended restaurant's ${role} with the right password: 403 with the 'switched off' sentence and NO pass`, r.status === 403 && (await body(r)).error === PG.DOOR_OFF && !ck(r, "lfh_user"));
    t(f, `item 30: …logged as login_denied 'switched off (suspended)' under that restaurant`, /restaurant is switched off \(suspended\)/.test(logs("login_denied")[0]?.detail || "") && logs("login_denied")[0]?.restaurant_id === RID_A && logs("login").length === 0);
  }
  PA.forgetRestaurant(RID_A);
  const s1 = await person({ username: "susp", pw: "pw-1" }); const slug = "r5-susp-door";
  world({ staff_users: [s1], restaurants: [REST({ slug, active: false })] }); PA.forgetRestaurant(RID_A);
  const r2 = await call({ username: "susp", password: "pw-1", restaurant: slug });
  t(f, "item 30: …the same at the restaurant's OWN door", r2.status === 403 && (await body(r2)).error === PG.DOOR_OFF);
  world({ staff_users: [s1], restaurants: [REST({ active: false })] }); PA.forgetRestaurant(RID_A);
  const wr = await call({ username: "susp", password: "wrong" });
  t(f, "item 30: a WRONG password for a suspended restaurant's staff is still just 'wrong name or password' (no hint about the restaurant)", wr.status === 401 && (await body(wr)).error === "Wrong name or password.");
  const own = await person({ role: "owner", username: "osusp", pw: "pw-1" });
  world({ staff_users: [own], restaurant_owners: [{ user_id: own.id, restaurant_id: RID_A }], restaurants: [REST({ active: false })] }); PA.forgetRestaurant(RID_A, [own.id]);
  t(f, "item 30: the OWNER of a suspended restaurant still signs in", (await call({ username: "osusp", password: "pw-1" })).status === 200);
  world({ staff_users: [s1], restaurants: [{ id: RID_A, deleted_at: "2026-10-01T00:00:00Z", active: false }] }); PA.forgetRestaurant(RID_A);
  t(f, "a binned restaurant's staff get 'no longer available' — the bin answer comes before the suspension one", (await body(await call({ username: "susp", password: "pw-1" }))).error === "This restaurant is no longer available. Contact your admin.");
  PA.forgetRestaurant(RID_A);
  const m = await person({ username: "plain", pw: "pw-1" }); world({ staff_users: [m], restaurants: [REST()] });
  const ok = await call({ username: "plain", password: "pw-1" });
  t(f, "a normal sign-in answers exactly { ok, role, needsProfile } — nothing else", JSON.stringify(Object.keys(await body(ok)).sort()) === '["needsProfile","ok","role"]');
  t(f, "…its log line carries the person's id for the activity trail", logs("login")[0]?.actor_id === m.id);
  world({ staff_users: [m] });
  const arr = await PL.POST(req("/api/panel-login", { method: "POST", json: [1, 2] }));
  t(f, "a body that is a list (not a form) is an empty sign-in, refused", arr.status === 401);
  world({ staff_users: [m] });
  t(f, "a username sent as a number is treated as text (never a crash)", [401, 200].includes((await call({ username: 12345, password: "x" })).status));
  world({ staff_users: [m] }); G.RPC_ANSWERS.lfh_rate_check = false;
  await call({ username: "x".repeat(90), password: "y", restaurant: undefined });
  t(f, "the limit-hit log names at most 60 characters of the typed name", (() => { const d = logs("rate_limited")[0]?.detail || ""; const q = d.match(/"([^"]*)"/); return q && q[1].length === 60; })());
}
if (want("app/api/panel-logout/route.ts")) { const f = "app/api/panel-logout/route.ts"; const LO = await import("@/app/api/panel-logout/route.ts");
  const m = await person({ name: "Ravi K", username: "ravik" }); world({ staff_users: [m] });
  const r = await LO.POST(req("/api/panel-logout", { method: "POST", cookies: { lfh_user: sign(m), lfh_panel_device: "dev-7" } }));
  t(f, "the sign-out line records the device it happened on", logs("logout")[0]?.device_id === "dev-7");
  t(f, "…and reads 'Ravi K logged out · user \"ravik\" · id <id>'", logs("logout")[0]?.detail === `Ravi K logged out · user "ravik" · id ${m.id}`);
  t(f, "the wiped pass cookie is for the whole site (Path=/), so no copy survives on a sub-page", /Path=\//.test(ck(r, "lfh_user")));
  t(f, "signing out goes to /login on the SAME site the request came to", new URL(r.headers.get("location")).origin === "http://r5.local");
  const forged = await LO.POST(req("/api/panel-logout", { method: "POST", cookies: { lfh_user: "forged.1.x" } }));
  t(f, "a forged pass signs out cleanly and logs nothing", forged.status === 303 && logs("logout").length === 1);
}
if (want("app/api/staff-login/route.ts")) { const f = "app/api/staff-login/route.ts"; const SL = await import("@/app/api/staff-login/route.ts");
  const call = (form, ip, json = true) => SL.POST(req("/api/staff-login", { method: "POST", form, headers: { ...(json ? { accept: "application/json" } : {}), "x-forwarded-for": ip } }));
  world({ login_throttle: [] });
  const seq = []; for (let i = 0; i < 10; i++) seq.push(await body(await call({ password: "w" }, "8.8.8.1")));
  t(f, "ten wrong admin passwords from one address: 9,8,…,1 tries left, then locked", seq.slice(0, 9).map((x) => x.attemptsLeft).join() === "9,8,7,6,5,4,3,2,1" && seq[9].locked === true);
  t(f, "…counted through the database counter with the 10-try / 5-minute rule", (() => { const c = G.RPCS.filter((x) => x.name === "lfh_throttle_fail").at(-1)?.args; return c?.p_max === 10 && c?.p_lock_ms === 300000 && c?.p_key === "admin:8.8.8.1"; })());
  t(f, "…alerts fire from the 3rd wrong try on (8 of the 10), never before", G.RPCS.filter((x) => x.name === "lfh_rate_alert").map((x) => x.args.p_hit).join() === "3,4,5,6,7,8,9,10");
  world({ login_throttle: [] });
  const jok = await call({ password: ADMIN_PW, next: "/aevinite/owners?tab=1" }, "8.8.8.2");
  t(f, "the 'next' page keeps its own query part", (await body(jok)).next === "/aevinite/owners?tab=1");
  world({ login_throttle: [] });
  const lk = await call({ password: "w" }, "8.8.8.3", false);
  t(f, "the no-JavaScript wrong-password return keeps the encoded 'next'", /\/staff-login\?bad=1&next=%2Faevinite$/.test(lk.headers.get("location") || ""));
  world({ login_throttle: [] }); const keep = process.env.NODE_ENV; process.env.NODE_ENV = "production";
  const sec = await call({ password: ADMIN_PW }, "8.8.8.4"); process.env.NODE_ENV = keep;
  t(f, "on the live site both admin cookies are Secure", /;\s*Secure/i.test(ck(sec, "lfh_staff_auth")) && /;\s*Secure/i.test(ck(sec, "lfh_is_staff")));
  world({ login_throttle: [] });
  const sp = await call({ password: " " + ADMIN_PW }, "8.8.8.5");
  t(f, "the admin password is exact — a leading space is wrong", (await body(sp)).ok === false);
}
if (want("app/api/staff-logout/route.ts")) { const f = "app/api/staff-logout/route.ts"; const SO = await import("@/app/api/staff-logout/route.ts");
  const r = await SO.POST(req("/api/staff-logout", { method: "POST" }));
  t(f, "the admin's sign-out wipes exactly four cookies, each for the whole site", (r.headers.getSetCookie?.() || []).length === 4 && (r.headers.getSetCookie?.() || []).every((c) => /Path=\//.test(c) && /Max-Age=0/.test(c)));
  t(f, "…and goes to /menu on the same site", new URL(r.headers.get("location")).origin === "http://r5.local");
}
if (want("app/r/[restaurant]/owner/route.ts")) { const f = "app/r/[restaurant]/owner/route.ts"; const OR = await import("@/app/r/[restaurant]/owner/route.ts");
  const go2 = (slug, cookies = {}) => OR.GET(req(`/r/${slug}/owner`, { cookies }), { params: Promise.resolve({ restaurant: slug }) });
  const own = await person({ role: "owner" });
  world({ restaurants: [REST({ slug: "r5-o-susp", active: false })], staff_users: [own] });
  t(f, "item 30: an owner of a SUSPENDED restaurant still goes into the cockpit from its owner entrance", new URL((await go2("r5-o-susp", { lfh_user: sign(own) })).headers.get("location")).pathname === "/owner");
  world({ restaurants: [REST({ slug: "r5-o-name" })] });
  const nm = await go2("r5-o-name");
  t(f, "a signed-out visitor's redirect is a plain 307 (the browser keeps the method for a GET anyway)", nm.status === 307);
  const elsewhere = { ...own, id: randomUUID(), restaurant_id: RID_B };
  world({ restaurants: [REST({ slug: "r5-o-co" })], staff_users: [elsewhere], restaurant_owners: [] }); G.FAIL["restaurant_owners"] = "error";
  const coe = await go2("r5-o-co", { lfh_user: sign(elsewhere) });
  t(f, "an owner of another restaurant, when the owners list cannot be read, is sent to sign-in (never let in on a blip)", new URL(coe.headers.get("location")).pathname === "/r/r5-o-co/login");
  world({ restaurants: [], slug_redirects: [{ old_slug: "r5-o-old", new_slug: "r5 o new" }] });
  const mv = await go2("r5-o-old");
  t(f, "an old address forwards to the new one; the new name is used as stored", mv.status === 307 && (mv.headers.get("location") || "").includes("/r/r5%20o%20new/owner"));
}
save((process.env.T17_SAVE || "") + "/U-routes.json");
