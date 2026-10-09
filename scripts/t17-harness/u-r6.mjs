// SWEEP #10 T17 ROUND 6 — part of verify:t17-signin (scripts/verify-t17-signin.mjs). HERMETIC: every row this suite
// touches — staff_users, staff_actions, rate_limit_events, login_throttle, fail_count, restaurants — lives in the in-memory
// stub (./sb.mjs) and is wiped by world() before each check, so no wrong password here ever reaches a database, a limit
// counter or the owner's phone (any fetch a check has not replaced is refused).
import { G, world, person, sign, req, t, save, quiet, RID_A, ADMIN_PW, sha, R, go } from "./r5lib.mjs";
const ONLY = process.env.R5_ONLY || ""; const want = (f) => !ONLY || ONLY === f;
const PA = await import("@/lib/panelAccess.ts"); const UA = await import("@/lib/userAuth.ts");
const adminTok = await sha(ADMIN_PW);
if (want("app/r/[restaurant]/login/page.tsx")) { const f = "app/r/[restaurant]/login/page.tsx"; const RP = await import("@/app/r/[restaurant]/login/page.tsx");
  const m = await person({ role: "manager" });
  world({ restaurants: [{ id: RID_A, slug: "r6-p", name: "A", active: true, deleted_at: null }], staff_users: [m] }); G.FAIL["staff_users"] = "error"; R.cookies = { lfh_user: sign(m) };
  const a = await quiet(() => go(() => RP.default({ params: Promise.resolve({ restaurant: "r6-p" }), searchParams: Promise.resolve({}) })));
  t(f, "a database blip while checking who is signed in shows the sign-in card (not a crash), and says so in the server log", !!a.v?.v && a.logs.some((l) => /\[r\/login\] couldn't check for an existing session/.test(l)));
  world({ restaurants: [{ id: RID_A, slug: "r6-p2", name: "A", active: true, deleted_at: null }], staff_users: [m] }); G.FAIL["staff_users"] = "throw";
  const b = await quiet(() => go(() => RP.default({ params: Promise.resolve({ restaurant: "r6-p2" }), searchParams: Promise.resolve({}) })));
  t(f, "…but a real bug (not a database blip) is NOT hidden behind the card", !!b.v?.err);
  world({ restaurants: [{ id: RID_A, slug: "r6-p3", name: "A", active: true, deleted_at: null }], staff_users: [m] }); R.cookies = { lfh_user: sign(m) };
  t(f, "item 40: a live restaurant's signed-in manager goes straight in — no panel switch is asked any more", (await go(() => RP.default({ params: Promise.resolve({ restaurant: "r6-p3" }), searchParams: Promise.resolve({}) }))).redirect === "/r/r6-p3/manager");
  R.cookies = {}; }
if (want("app/r/[restaurant]/owner/route.ts")) { const f = "app/r/[restaurant]/owner/route.ts"; const OR = await import("@/app/r/[restaurant]/owner/route.ts");
  const o = await person({ role: "owner" }); world({ restaurants: [{ id: RID_A, slug: "r6-o", name: "A", active: true, deleted_at: null }], staff_users: [o] }); G.FAIL["staff_users"] = "throw";
  const r = await OR.GET(req("/r/r6-o/owner", { cookies: { lfh_user: sign(o) } }), { params: Promise.resolve({ restaurant: "r6-o" }) });
  t(f, "even a THROWN pass check at the owner entrance falls through to that restaurant's sign-in (never a crash)", new URL(r.headers.get("location")).pathname === "/r/r6-o/login"); }
if (want("lib/panelGate.ts")) { const f = "lib/panelGate.ts"; const PG = await import("@/lib/panelGate.ts");
  world({}); R.cookies = {};
  t(f, "panelAdminRid for nobody at all is neither the admin nor staff", JSON.stringify((await go(() => PG.panelAdminRid("kitchen", RID_A))).v) === JSON.stringify({ adminRid: null, selfRid: null }));
  const k = await person({ role: "kitchen" }); world({ staff_users: [k], restaurants: [{ id: RID_A, deleted_at: null, active: true }] }); PA.forgetRestaurant(RID_A); R.cookies = { lfh_user: sign(k) };
  await go(() => PG.requirePanel("kitchen", "/kitchen"));
  t(f, "item 40: letting a live restaurant's kitchen in costs ONE restaurant read and no settings read", G.READS.filter((x) => x.table === "restaurants").length === 1 && !G.READS.some((x) => x.table === "settings"));
  R.cookies = {}; PA.forgetRestaurant(RID_A); }
if (want("lib/publicCap.ts")) { const f = "lib/publicCap.ts"; const PC = await import("@/lib/publicCap.ts");
  world({}); G.FAIL["staff_actions"] = "throw";
  t(f, "a counter read that THROWS counts 0 (a real report is never blocked by a broken counter)", (await PC.recentActionCount("d", "a", 60000, 5)) === 0);
  for (let i = 0; i < 5001; i++) PC.withinMemoryCap("r6-old-" + i, 1, 5);
  await new Promise((r) => setTimeout(r, 5));
  t(f, "past 5,000 tracked callers, the ones whose window has ended are swept out and a new caller is counted fresh", PC.withinMemoryCap("r6-new-" + Math.random(), 60000, 1) === true && PC.withinMemoryCap("r6-new2-" + Math.random(), 60000, 1) === true); }
if (want("lib/userAuth.ts")) { const f = "lib/userAuth.ts";
  const keep = { S: process.env.SESSION_SECRET, A: process.env.ADMIN_PASSWORD, N: process.env.NODE_ENV }; delete process.env.SESSION_SECRET; delete process.env.ADMIN_PASSWORD; process.env.NODE_ENV = "development";
  const p = await person({ username: "dv", pw: "pw-1" }); world({ staff_users: [p] });
  const r = await quiet(() => UA.loginUser("dv", "pw-1"));
  t(f, "on a developer machine with no secret at all, sign-in still works (signed with the fixed dev secret)", r.v?.ok === true && (await UA.userFromCookie(sign(p, Date.now(), "lfh-dev-secret")))?.id === p.id);
  Object.assign(process.env, { SESSION_SECRET: keep.S, ADMIN_PASSWORD: keep.A, NODE_ENV: keep.N });
  world({ staff_users: [{ id: "x", role: "manager", name: "X", username: "x", restaurant_id: RID_A, active: true, deleted_at: null }], restaurants: [] }); G.FAIL["restaurants"] = "throw";
  t(f, "the limit-alert wording gives up quietly (null) if a name read throws — it never breaks a sign-in", (await UA.describeLoginTarget("x")) === null); }
if (want("app/api/admin/restaurants/route.ts")) { const f = "app/api/admin/restaurants/route.ts"; const AR = await import("@/app/api/admin/restaurants/route.ts");
  const k = await person({ role: "kitchen" });
  world({ restaurants: [{ id: RID_A, name: "Aangan", active: true, deleted_at: null }], staff_users: [k], restaurant_owners: [] }); PA.forgetRestaurant(RID_A);
  const rq = { cookies: { get: (n) => (n === "lfh_user" ? { value: sign(k) } : undefined) }, headers: { get: () => null } };
  const before = await UA.requireRole(rq, "kitchen");
  const res = await quiet(() => AR.POST(req("/api/admin/restaurants", { method: "POST", json: { action: "set_restaurant_active", restaurant_id: RID_A, active: false }, cookies: { lfh_staff_auth: adminTok } })));
  const after = await UA.requireRole(rq, "kitchen");
  t(f, "item 38: the admin suspends a restaurant through the console's own route — its kitchen is refused on the VERY NEXT call (no 30-second wait)", before.ok === true && res.v?.status === 200 && after.ok === false, `${before.ok} → ${res.v?.status} → ${after.ok}`);
  await quiet(() => AR.POST(req("/api/admin/restaurants", { method: "POST", json: { action: "set_restaurant_active", restaurant_id: RID_A, active: true }, cookies: { lfh_staff_auth: adminTok } })));
  t(f, "item 38: …and reactivating lets it straight back in", (await UA.requireRole(rq, "kitchen")).ok === true);
  t(f, "item 38: the suspension is logged as 'Aangan suspended' and the reactivation as 'Aangan reactivated'", (G.FIX.staff_actions || []).some((x) => x.action === "restaurant_suspend" && x.detail === "Aangan suspended") && (G.FIX.staff_actions || []).some((x) => x.action === "restaurant_reactivate" && x.detail === "Aangan reactivated"));
  PA.forgetRestaurant(RID_A); }
if (want("app/owner/SignInBounce.tsx")) { const f = "app/owner/SignInBounce.tsx";
  const { renderToString } = await import("react-dom/server"); const { createElement: h } = await import("react");
  const SB = (await import("@/app/owner/SignInBounce.tsx")).default; const html = renderToString(h(SB));
  t(f, "item 37: the sign-in step shows 'Opening sign-in…' with a plain Sign in link while it moves on", /Opening sign-in…/.test(html) && /<a href="\/login\?next=%2Fowner"/.test(html));
  t(f, "…and carries a no-JavaScript refresh to the sign-in card", /<noscript><meta http-equiv="refresh" content="0;url=\/login\?next=%2Fowner"\/?><\/noscript>/.test(html)); }
save((process.env.T17_SAVE || "") + "/U-r6.json");
